from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import TimeStampedSoftDeleteModel


class Plan(TimeStampedSoftDeleteModel):
    STARTER = "starter"
    GROWTH = "growth"
    BUSINESS = "business"
    PLAN_CHOICES = [(STARTER, "Starter"), (GROWTH, "Growth"), (BUSINESS, "Business")]

    code = models.CharField(max_length=30, choices=PLAN_CHOICES, unique=True)
    name = models.CharField(max_length=60)
    description = models.CharField(max_length=255, blank=True)
    monthly_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    yearly_price = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default="ZAR")
    is_public = models.BooleanField(default=True)
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order", "monthly_price"]

    def __str__(self):
        return self.name


class FeatureLimit(TimeStampedSoftDeleteModel):
    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name="limits")
    key = models.CharField(max_length=80)
    label = models.CharField(max_length=120)
    enabled = models.BooleanField(default=True)
    limit = models.IntegerField(blank=True, null=True)
    unit = models.CharField(max_length=40, blank=True)

    class Meta:
        unique_together = ("plan", "key")
        ordering = ["plan__sort_order", "key"]

    def __str__(self):
        if not self.enabled:
            return f"{self.plan}: {self.label} locked"
        return f"{self.plan}: {self.label} {self.limit if self.limit is not None else 'unlimited'}"


class RegionPrice(TimeStampedSoftDeleteModel):
    plan = models.ForeignKey(Plan, on_delete=models.CASCADE, related_name="region_prices")
    country_code = models.CharField(max_length=2)
    country_name = models.CharField(max_length=80)
    currency = models.CharField(max_length=10)
    currency_symbol = models.CharField(max_length=10)
    monthly_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    yearly_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    is_default = models.BooleanField(default=False)

    class Meta:
        unique_together = ("plan", "country_code")
        ordering = ["country_name", "plan__sort_order"]

    def __str__(self):
        return f"{self.country_code} {self.plan.name} {self.currency} {self.monthly_price}"


class Subscription(TimeStampedSoftDeleteModel):
    ACTIVE = "active"
    TRIALING = "trialing"
    PAST_DUE = "past_due"
    CANCELLED = "cancelled"
    EXPIRED = "expired"
    STATUS_CHOICES = [
        (ACTIVE, "active"),
        (TRIALING, "trialing"),
        (PAST_DUE, "past_due"),
        (CANCELLED, "cancelled"),
        (EXPIRED, "expired"),
    ]
    MONTHLY = "monthly"
    YEARLY = "yearly"
    PERIOD_CHOICES = [(MONTHLY, "monthly"), (YEARLY, "yearly")]
    PROVIDER_MOCK = "mock"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscription")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=ACTIVE)
    billing_period = models.CharField(max_length=20, choices=PERIOD_CHOICES, default=MONTHLY)
    provider = models.CharField(max_length=30, default=PROVIDER_MOCK)
    provider_customer_id = models.CharField(max_length=255, blank=True)
    provider_subscription_id = models.CharField(max_length=255, blank=True)
    billing_country_code = models.CharField(max_length=2, default="ZA")
    billing_currency = models.CharField(max_length=10, default="ZAR")
    current_period_start = models.DateTimeField(default=timezone.now)
    current_period_end = models.DateTimeField(blank=True, null=True)
    trial_ends_at = models.DateTimeField(blank=True, null=True)
    grace_period_ends_at = models.DateTimeField(blank=True, null=True)
    cancel_at_period_end = models.BooleanField(default=False)
    cancelled_at = models.DateTimeField(blank=True, null=True)
    ended_at = models.DateTimeField(blank=True, null=True)

    @property
    def is_entitled(self):
        now = timezone.now()
        if self.status in [self.ACTIVE, self.TRIALING]:
            return not self.current_period_end or now <= self.current_period_end
        if self.status == self.PAST_DUE and self.grace_period_ends_at:
            return now <= self.grace_period_ends_at
        return False

    def __str__(self):
        return f"{self.user} - {self.plan.name} ({self.status})"


class BillingCycle(TimeStampedSoftDeleteModel):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="cycles")
    period_start = models.DateTimeField()
    period_end = models.DateTimeField()
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    currency = models.CharField(max_length=10, default="ZAR")
    provider_invoice_id = models.CharField(max_length=255, blank=True)
    paid_at = models.DateTimeField(blank=True, null=True)
    status = models.CharField(max_length=30, default="paid")

    class Meta:
        ordering = ["-period_start"]


class UsageTracking(TimeStampedSoftDeleteModel):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="usage")
    key = models.CharField(max_length=80)
    used = models.PositiveIntegerField(default=0)
    period_start = models.DateTimeField(default=timezone.now)
    period_end = models.DateTimeField(blank=True, null=True)

    class Meta:
        unique_together = ("subscription", "key", "period_start")


class TrialPeriod(TimeStampedSoftDeleteModel):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="trials")
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name="trials")
    started_at = models.DateTimeField(default=timezone.now)
    ends_at = models.DateTimeField()
    converted_at = models.DateTimeField(blank=True, null=True)
    expired_at = models.DateTimeField(blank=True, null=True)


class SubscriptionEvent(TimeStampedSoftDeleteModel):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="events")
    event_type = models.CharField(max_length=80)
    provider = models.CharField(max_length=30, default=Subscription.PROVIDER_MOCK)
    provider_event_id = models.CharField(max_length=255, blank=True)
    metadata = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, blank=True, null=True, related_name="billing_events")

    class Meta:
        ordering = ["-created_at"]


class Payment(TimeStampedSoftDeleteModel):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal("0"))
    currency = models.CharField(max_length=10, default="ZAR")
    status = models.CharField(max_length=20, default="paid")
    provider_payment_id = models.CharField(max_length=255, blank=True)
    provider = models.CharField(max_length=30, default=Subscription.PROVIDER_MOCK)
