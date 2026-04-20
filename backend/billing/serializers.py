from rest_framework import serializers

from .models import BillingCycle, FeatureLimit, Payment, Plan, RegionPrice, Subscription, SubscriptionEvent, TrialPeriod, UsageTracking


class FeatureLimitSerializer(serializers.ModelSerializer):
    class Meta:
        model = FeatureLimit
        fields = ["key", "label", "enabled", "limit", "unit"]


class PlanSerializer(serializers.ModelSerializer):
    limits = FeatureLimitSerializer(many=True, read_only=True)

    class Meta:
        model = Plan
        fields = ["id", "code", "name", "description", "monthly_price", "yearly_price", "currency", "sort_order", "limits"]


class RegionPriceSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)

    class Meta:
        model = RegionPrice
        fields = ["id", "plan", "country_code", "country_name", "currency", "currency_symbol", "monthly_price", "yearly_price", "is_default"]


class PricingContextPriceSerializer(serializers.Serializer):
    plan = PlanSerializer()
    country_code = serializers.CharField()
    country_name = serializers.CharField()
    currency = serializers.CharField()
    currency_symbol = serializers.CharField()
    monthly_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    yearly_price = serializers.DecimalField(max_digits=12, decimal_places=2)


class PricingContextSerializer(serializers.Serializer):
    country_code = serializers.CharField()
    country_name = serializers.CharField()
    currency = serializers.CharField()
    currency_symbol = serializers.CharField()
    detected_by = serializers.CharField()
    prices = PricingContextPriceSerializer(many=True)
    available_countries = serializers.ListField()


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
            "billing_country_code",
            "billing_currency",
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
    features = serializers.ListField()
    events = SubscriptionEventSerializer(many=True)
    cycles = BillingCycleSerializer(many=True)
    available_actions = serializers.ListField(child=serializers.CharField())
