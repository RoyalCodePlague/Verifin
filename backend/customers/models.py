import uuid
from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class Customer(TimeStampedSoftDeleteModel):
    BADGE_CHOICES = [("bronze", "bronze"), ("silver", "silver"), ("gold", "gold"), ("platinum", "platinum")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="customers")
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=30, blank=True)
    total_spent = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    visits = models.PositiveIntegerField(default=0)
    loyalty_points = models.IntegerField(default=0)
    qr_code = models.CharField(max_length=64, unique=True, default=uuid.uuid4)
    credits = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    last_visit = models.DateTimeField(blank=True, null=True)
    badge = models.CharField(max_length=20, choices=BADGE_CHOICES, default="bronze")


class LoyaltyTransaction(TimeStampedSoftDeleteModel):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="loyalty_transactions")
    points_change = models.IntegerField()
    reason = models.CharField(max_length=255, blank=True)


class CreditTransaction(TimeStampedSoftDeleteModel):
    TYPE_CHOICES = [("add", "add"), ("redeem", "redeem")]
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="credit_transactions")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    reason = models.CharField(max_length=255, blank=True)
