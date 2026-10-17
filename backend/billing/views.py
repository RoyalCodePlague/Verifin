from django.conf import settings
import secrets
from decimal import Decimal, InvalidOperation
from rest_framework.exceptions import PermissionDenied
from django.utils import timezone
from django.db import transaction
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Payment, Plan, RegionPrice, Subscription, SubscriptionEvent
from .paynow import PaynowError, poll_status, verify_hash
from .providers import get_checkout_provider, get_provider_status
from .serializers import BillingOverviewSerializer, PaymentSerializer, PlanSerializer, PricingContextSerializer, ReferralProgressSerializer, RegionPriceSerializer, SubscriptionEventSerializer, SubscriptionSerializer
from .services import (
    activate_plan,
    cancel_subscription,
    change_plan,
    expire_subscription,
    get_or_create_subscription,
    record_event,
    renew_subscription,
    resume_subscription,
    feature_access_payload,
    pricing_context,
    redeem_referral_reward,
    referral_progress,
    subscription_payload,
    sync_plan_catalog,
)


class PlanViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PlanSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return sync_plan_catalog().filter(is_public=True).order_by("sort_order").prefetch_related("limits")


class RegionPriceViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = RegionPriceSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        sync_plan_catalog()
        return RegionPrice.objects.filter(is_deleted=False).select_related("plan").order_by("country_name", "plan__sort_order")


class PricingContextViewSet(viewsets.ViewSet):
    permission_classes = [AllowAny]

    def list(self, request):
        return Response(PricingContextSerializer(pricing_context(request)).data)


class SubscriptionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SubscriptionSerializer
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        # Keep old, unfinished providers/actions closed in production.
        if self.action == "pesepay_checkout":
            raise PermissionDenied("Paid upgrades are coming soon. No payment has been taken.")
        if self.action in {"mock_checkout", "mock_trial", "renew", "upgrade", "resume", "expire", "cancel"} and not settings.BILLING_TEST_MODE:
            raise PermissionDenied("Test billing is disabled. Paid upgrades are coming soon.")
        if self.action == "downgrade" and request.data.get("plan", "starter") != "starter" and not settings.BILLING_TEST_MODE:
            raise PermissionDenied("Only the free Starter plan is available without payment.")

    def get_queryset(self):
        if not self.request.user.is_authenticated:
            return Subscription.objects.none()
        get_or_create_subscription(self.request.user)
        return Subscription.objects.filter(user=self.request.user, is_deleted=False)

    def list(self, request, *args, **kwargs):
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["get"], url_path="current")
    def current(self, request):
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["get"], url_path="features")
    def features(self, request):
        return Response({"features": feature_access_payload(request.user)})

    @action(detail=False, methods=["post"], url_path="mock-checkout")
    def mock_checkout(self, request):
        subscription = activate_plan(
            request.user,
            request.data.get("plan", "starter"),
            request.data.get("billing_period", "monthly"),
            trial_days=int(request.data.get("trial_days", 0) or 0),
            actor=request.user,
            country_code=request.data.get("country_code"),
        )
        return Response(
            {
                "detail": "Mock checkout completed. No real payment was taken.",
                "subscription": SubscriptionSerializer(subscription).data,
                "billing": BillingOverviewSerializer(subscription_payload(request.user)).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"], url_path="mock-trial")
    def mock_trial(self, request):
        subscription = activate_plan(
            request.user,
            request.data.get("plan", "growth"),
            request.data.get("billing_period", "monthly"),
            trial_days=int(request.data.get("trial_days", 14) or 14),
            actor=request.user,
        )
        return Response(BillingOverviewSerializer(subscription_payload(subscription.user)).data)

    @action(detail=False, methods=["get"], url_path="providers")
    def provider_status(self, request):
        return Response({"providers": get_provider_status()})

    @action(detail=False, methods=["post"], url_path="paynow-checkout")
    def paynow_checkout(self, request):
        provider = get_checkout_provider("paynow")
        if not provider.enabled or not provider.ready:
            return Response({"detail": provider.status().detail}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        plan_code = request.data.get("plan", "")
        billing_period = request.data.get("billing_period", Subscription.MONTHLY)
        country_code = request.data.get("country_code") or "ZW"
        if billing_period not in (Subscription.MONTHLY, Subscription.YEARLY):
            return Response({"detail": "Use monthly or yearly billing."}, status=status.HTTP_400_BAD_REQUEST)
        if plan_code == Plan.STARTER:
            return Response({"detail": "Starter is free and does not need checkout."}, status=status.HTTP_400_BAD_REQUEST)
        plan = Plan.objects.filter(code=plan_code, is_deleted=False).first()
        if not plan:
            return Response({"detail": "Plan not found."}, status=status.HTTP_400_BAD_REQUEST)
        from .services import region_price_for

        price = region_price_for(plan, country_code)
        amount = price.yearly_price if billing_period == Subscription.YEARLY else price.monthly_price
        if price.currency != "USD" or amount <= 0:
            return Response({"detail": "Paynow checkout currently supports paid USD plans only."}, status=status.HTTP_400_BAD_REQUEST)

        subscription = get_or_create_subscription(request.user)
        reference = f"verifin-{secrets.token_hex(12)}"
        payment = Payment.objects.create(
            subscription=subscription,
            amount=amount,
            currency=price.currency,
            status=Payment.PENDING,
            provider_payment_id=reference,
            provider="paynow",
            plan_code=plan.code,
            billing_period=billing_period,
            country_code=price.country_code,
        )
        result_url = request.build_absolute_uri("/api/v1/billing/subscriptions/paynow-result/")
        return_url = f"{settings.FRONTEND_URL}/billing?payment_reference={reference}"
        try:
            payload = provider.initiate_checkout(
                reference=reference,
                amount=amount,
                description=f"Verifin {plan.name} {billing_period} subscription",
                return_url=return_url,
                result_url=result_url,
            )
        except (PaynowError, RuntimeError) as exc:
            payment.status = Payment.FAILED
            payment.save(update_fields=["status", "updated_at"])
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        payment.provider_poll_url = payload["pollurl"]
        payment.save(update_fields=["provider_poll_url", "updated_at"])
        return Response({"reference": reference, "redirect_url": payload["browserurl"], "status": "pending"})

    @action(detail=False, methods=["post"], url_path="paynow-mobile-checkout")
    def paynow_mobile_checkout(self, request):
        provider = get_checkout_provider("paynow")
        if not provider.enabled or not provider.ready:
            return Response({"detail": provider.status().detail}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        plan_code = request.data.get("plan", "")
        billing_period = request.data.get("billing_period", Subscription.MONTHLY)
        country_code = request.data.get("country_code") or "ZW"
        method = str(request.data.get("method", "")).lower().strip()
        phone = str(request.data.get("phone", "")).strip().replace(" ", "").replace("-", "")
        if billing_period not in (Subscription.MONTHLY, Subscription.YEARLY):
            return Response({"detail": "Use monthly or yearly billing."}, status=status.HTTP_400_BAD_REQUEST)
        if method not in {"ecocash", "onemoney"}:
            return Response({"detail": "Choose EcoCash or OneMoney."}, status=status.HTTP_400_BAD_REQUEST)
        if phone.startswith("+263"):
            phone = "0" + phone[4:]
        elif phone.startswith("263"):
            phone = "0" + phone[3:]
        if len(phone) != 10 or not phone.isdigit() or not phone.startswith("07"):
            return Response({"detail": "Enter a Zimbabwe mobile number, such as 0771234567."}, status=status.HTTP_400_BAD_REQUEST)
        if plan_code == Plan.STARTER:
            return Response({"detail": "Starter is free and does not need checkout."}, status=status.HTTP_400_BAD_REQUEST)
        plan = Plan.objects.filter(code=plan_code, is_deleted=False).first()
        if not plan:
            return Response({"detail": "Plan not found."}, status=status.HTTP_400_BAD_REQUEST)
        from .services import region_price_for

        price = region_price_for(plan, country_code)
        amount = price.yearly_price if billing_period == Subscription.YEARLY else price.monthly_price
        if price.currency != "USD" or amount <= 0:
            return Response({"detail": "Paynow checkout currently supports paid USD plans only."}, status=status.HTTP_400_BAD_REQUEST)
        auth_email = request.user.email
        if getattr(settings, "PAYNOW_ENV", "sandbox") in {"sandbox", "test", "testing"}:
            auth_email = getattr(settings, "PAYNOW_TEST_EMAIL", "")
            if not auth_email:
                return Response({"detail": "Set PAYNOW_TEST_EMAIL to the email address of the Paynow integration owner to test mobile checkout."}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        if not auth_email:
            return Response({"detail": "Add an email address to your account before starting checkout."}, status=status.HTTP_400_BAD_REQUEST)

        subscription = get_or_create_subscription(request.user)
        reference = f"verifin-{secrets.token_hex(12)}"
        payment = Payment.objects.create(
            subscription=subscription,
            amount=amount,
            currency=price.currency,
            status=Payment.PENDING,
            provider_payment_id=reference,
            provider="paynow",
            plan_code=plan.code,
            billing_period=billing_period,
            country_code=price.country_code,
        )
        result_url = request.build_absolute_uri("/api/v1/billing/subscriptions/paynow-result/")
        return_url = f"{settings.FRONTEND_URL}/billing?payment_reference={reference}"
        try:
            payload = provider.initiate_mobile_checkout(
                reference=reference,
                amount=amount,
                description=f"Verifin {plan.name} {billing_period} subscription",
                return_url=return_url,
                result_url=result_url,
                method=method,
                phone=phone,
                auth_email=auth_email,
            )
        except (PaynowError, RuntimeError) as exc:
            payment.status = Payment.FAILED
            payment.save(update_fields=["status", "updated_at"])
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        payment.provider_poll_url = payload["pollurl"]
        payment.save(update_fields=["provider_poll_url", "updated_at"])
        return Response({"reference": reference, "status": "pending", "method": method, "phone": phone})

    @action(detail=False, methods=["post"], permission_classes=[AllowAny], authentication_classes=[], url_path="paynow-result")
    def paynow_result(self, request):
        fields = {str(key).lower(): str(request.data.get(key, "")) for key in request.data.keys()}
        if not verify_hash(fields):
            return Response({"detail": "Invalid Paynow signature."}, status=status.HTTP_400_BAD_REQUEST)
        reference = fields.get("reference", "")
        payment = Payment.objects.filter(provider="paynow", provider_payment_id=reference, is_deleted=False).select_related("subscription").first()
        if not payment:
            return Response({"detail": "Payment reference not found."}, status=status.HTTP_404_NOT_FOUND)
        if payment.status == Payment.PAID:
            return Response({"detail": "Payment already processed."})
        try:
            callback_amount = Decimal(fields.get("amount", "0"))
        except InvalidOperation:
            return Response({"detail": "Invalid payment amount."}, status=status.HTTP_400_BAD_REQUEST)
        if callback_amount != payment.amount or not payment.provider_poll_url:
            return Response({"detail": "Payment details do not match."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            result = poll_status(payment.provider_poll_url)
        except PaynowError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
        self._apply_paynow_result(payment, result)
        return Response({"detail": "Payment status received."})

    @action(detail=False, methods=["get"], url_path="paynow-status")
    def paynow_status(self, request):
        reference = request.query_params.get("reference", "")
        payment = Payment.objects.filter(provider="paynow", provider_payment_id=reference, subscription__user=request.user, is_deleted=False).select_related("subscription").first()
        if not payment:
            return Response({"detail": "Payment reference not found."}, status=status.HTTP_404_NOT_FOUND)
        if payment.status == Payment.PENDING and payment.provider_poll_url:
            try:
                result = poll_status(payment.provider_poll_url)
            except PaynowError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_502_BAD_GATEWAY)
            self._apply_paynow_result(payment, result)
            payment.refresh_from_db()
        return Response({"reference": reference, "status": payment.status})

    @staticmethod
    @transaction.atomic
    def _apply_paynow_result(payment, result):
        payment = Payment.objects.select_for_update().select_related("subscription__user").get(pk=payment.pk)
        if payment.status != Payment.PENDING or result.get("reference") != payment.provider_payment_id:
            return
        try:
            amount = Decimal(result.get("amount", "0"))
        except InvalidOperation:
            return
        if amount != payment.amount:
            return
        provider_status = result.get("status", "").strip().lower()
        if provider_status == "paid" and payment.status == Payment.PENDING:
            activate_plan(
                payment.subscription.user,
                payment.plan_code,
                payment.billing_period,
                actor=payment.subscription.user,
                country_code=payment.country_code,
                provider="paynow",
                payment_record=payment,
            )
        elif provider_status in {"cancelled", "failed"} and payment.status == Payment.PENDING:
            payment.status = Payment.FAILED
            payment.save(update_fields=["status", "updated_at"])

    @action(detail=False, methods=["post"], url_path="pesepay-checkout")
    def pesepay_checkout(self, request):
        provider = get_checkout_provider("pesepay")
        plan_code = request.data.get("plan", "growth")
        billing_period = request.data.get("billing_period", "monthly")
        country_code = request.data.get("country_code") or "ZA"
        amount = float(request.data.get("amount") or 0)
        if amount <= 0:
            plan = Plan.objects.filter(code=plan_code, is_deleted=False).first()
            if plan is None:
                return Response({"detail": "Plan not found."}, status=status.HTTP_400_BAD_REQUEST)
            amount = float(plan.monthly_price if billing_period == "monthly" else plan.yearly_price)

        plan_name = Plan.objects.filter(code=plan_code, is_deleted=False).first()
        return_url = request.data.get("return_url") or getattr(request, "META", {}).get("HTTP_REFERER") or "http://localhost:8080/billing"
        result_url = request.data.get("result_url") or "http://localhost:8080/billing"
        payload = provider.initiate_checkout(
            plan_name=(plan_name.name if plan_name else plan_code),
            amount=amount,
            currency="ZAR",
            reference=f"verifin-{request.user.id}-{plan_code}-{billing_period}-{timezone.now().strftime('%Y%m%d%H%M%S')}",
            return_url=return_url,
            result_url=result_url,
            customer_email=getattr(request.user, "email", None),
            customer_name=getattr(request.user, "business_name", None) or getattr(request.user, "username", None),
            phone_number=getattr(request.user, "phone", None),
        )

        if payload.get("mode") in {"demo", "disabled", "unconfigured"}:
            if payload.get("mode") == "demo":
                activate_plan(
                    request.user,
                    plan_code,
                    billing_period,
                    actor=request.user,
                    country_code=country_code,
                )
            return Response(
                {
                    "detail": payload.get("message") or "Checkout was not started.",
                    "provider": payload.get("provider", "pesepay"),
                    "reference": payload.get("reference"),
                    "redirect_url": payload.get("redirect_url"),
                    "status": payload.get("status", "disabled"),
                    "transaction_status": payload.get("status", "disabled"),
                    "billing": BillingOverviewSerializer(subscription_payload(request.user)).data,
                },
                status=status.HTTP_200_OK,
            )

        return Response(
            {
                "detail": payload.get("message") or "Pesepay checkout available.",
                "provider": payload.get("provider", "pesepay"),
                "reference": payload.get("reference"),
                "redirect_url": payload.get("redirect_url"),
                "status": payload.get("status"),
                "transaction_status": payload.get("transaction_status"),
                "billing": BillingOverviewSerializer(subscription_payload(request.user)).data,
            },
            status=status.HTTP_200_OK,
        )

    @action(detail=False, methods=["post"])
    def renew(self, request):
        renew_subscription(request.user, actor=request.user)
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["post"])
    def upgrade(self, request):
        change_plan(request.user, request.data.get("plan", "growth"), request.data.get("billing_period", "monthly"), actor=request.user)
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["post"])
    def downgrade(self, request):
        change_plan(request.user, request.data.get("plan", "starter"), request.data.get("billing_period", "monthly"), actor=request.user)
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["post"])
    def cancel(self, request):
        cancel_subscription(request.user, at_period_end=bool(request.data.get("at_period_end", True)), actor=request.user)
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["post"])
    def resume(self, request):
        resume_subscription(request.user, actor=request.user)
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["post"])
    def expire(self, request):
        expire_subscription(request.user, actor=request.user)
        return Response(BillingOverviewSerializer(subscription_payload(request.user)).data)

    @action(detail=False, methods=["post"], permission_classes=[AllowAny], url_path="webhook")
    def webhook(self, request):
        subscription_id = request.data.get("subscription_id")
        event_type = request.data.get("type", "provider.event.received")
        subscription = None
        if subscription_id:
            subscription = get_or_create_subscription(request.user) if request.user.is_authenticated else None
        if subscription:
            record_event(subscription, event_type, request.data, provider=request.data.get("provider", "mock"), provider_event_id=request.data.get("id", ""))
        return Response({"detail": "Webhook received. Provider adapter can process this event later."})


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PaymentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Payment.objects.filter(subscription__user=self.request.user, is_deleted=False)


class SubscriptionEventViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SubscriptionEventSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return SubscriptionEvent.objects.filter(subscription__user=self.request.user, is_deleted=False)


class ReferralViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        return Response(ReferralProgressSerializer(referral_progress(request.user)).data)

    @action(detail=False, methods=["post"])
    def redeem(self, request):
        subscription, token = redeem_referral_reward(request.user, request.data.get("token", ""))
        return Response(
            {
                "detail": f"Growth unlocked for {token.reward_days} days.",
                "billing": BillingOverviewSerializer(subscription_payload(subscription.user)).data,
                "referrals": ReferralProgressSerializer(referral_progress(request.user)).data,
            },
            status=status.HTTP_200_OK,
        )
