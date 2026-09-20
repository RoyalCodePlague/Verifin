from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Payment, Plan, RegionPrice, Subscription, SubscriptionEvent
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
        # Payment verification is not integrated yet. Never grant paid access from a public test action.
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
