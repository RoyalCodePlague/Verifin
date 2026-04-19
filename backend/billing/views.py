from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Payment, Plan, Subscription, SubscriptionEvent
from .serializers import BillingOverviewSerializer, PaymentSerializer, PlanSerializer, SubscriptionEventSerializer, SubscriptionSerializer
from .services import (
    activate_plan,
    cancel_subscription,
    change_plan,
    expire_subscription,
    get_or_create_subscription,
    record_event,
    renew_subscription,
    resume_subscription,
    subscription_payload,
    sync_plan_catalog,
)


class PlanViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PlanSerializer
    permission_classes = [AllowAny]

    def get_queryset(self):
        return sync_plan_catalog().filter(is_public=True).order_by("sort_order").prefetch_related("limits")


class SubscriptionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SubscriptionSerializer
    permission_classes = [IsAuthenticated]

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

    @action(detail=False, methods=["post"], url_path="mock-checkout")
    def mock_checkout(self, request):
        subscription = activate_plan(
            request.user,
            request.data.get("plan", "starter"),
            request.data.get("billing_period", "monthly"),
            trial_days=int(request.data.get("trial_days", 0) or 0),
            actor=request.user,
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
