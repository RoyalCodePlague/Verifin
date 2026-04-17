from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class Subscription(TimeStampedSoftDeleteModel):
    PLAN_CHOICES = [("Starter", "Starter"), ("Growth", "Growth"), ("Business", "Business")]
    STATUS_CHOICES = [("active", "active"), ("trial", "trial"), ("cancelled", "cancelled")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="subscriptions")
    plan = models.CharField(max_length=20, choices=PLAN_CHOICES, default="Starter")
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="trial")
    trial_end = models.DateTimeField(blank=True, null=True)
    current_period_end = models.DateTimeField(blank=True, null=True)


class Payment(TimeStampedSoftDeleteModel):
    subscription = models.ForeignKey(Subscription, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10, default="ZAR")
    status = models.CharField(max_length=20)
    stripe_payment_id = models.CharField(max_length=255, blank=True)
