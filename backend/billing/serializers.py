from rest_framework import serializers

from .models import BillingCycle, FeatureLimit, Payment, Plan, Subscription, SubscriptionEvent, TrialPeriod, UsageTracking


class FeatureLimitSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeatureLimit
        fields = ["key", "label", "enabled", "limit", "unit"]


class PlanSerializer(serializers.ModelSerializer):
    limits = FeatureLimitSerializer(many=True, read_only=True)

    class Meta:
        model = Plan
        fields = ["id", "code", "name", "description", "monthly_price", "yearly_price", "currency", "sort_order", "limits"]


class SubscriptionSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)

    class Meta:
        model = Subscription
        fields = [
            "id",
            "plan",
            "status",
            "billing_period",
            "provider",
            "current_period_start",
            "current_period_end",
            "trial_ends_at",
            "grace_period_ends_at",
            "cancel_at_period_end",
            "cancelled_at",
            "ended_at",
        ]


class BillingCycleSerializer(serializers.ModelSerializer):
    class Meta:
        model = BillingCycle
        fields = ["id", "period_start", "period_end", "amount", "currency", "paid_at", "status", "provider_invoice_id"]


class UsageTrackingSerializer(serializers.ModelSerializer):
    class Meta:
        model = UsageTracking
        fields = ["id", "key", "used", "period_start", "period_end"]


class TrialPeriodSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)

    class Meta:
        model = TrialPeriod
        fields = ["id", "plan", "started_at", "ends_at", "converted_at", "expired_at"]


class SubscriptionEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionEvent
        fields = ["id", "event_type", "provider", "provider_event_id", "metadata", "created_at"]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ["id", "amount", "currency", "status", "provider_payment_id", "provider", "created_at"]


class BillingOverviewSerializer(serializers.Serializer):
    subscription = SubscriptionSerializer()
    plan = PlanSerializer()
    limits = serializers.ListField()
    locked_features = serializers.ListField()
    events = SubscriptionEventSerializer(many=True)
    cycles = BillingCycleSerializer(many=True)
    available_actions = serializers.ListField(child=serializers.CharField())
