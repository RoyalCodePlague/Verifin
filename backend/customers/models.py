import uuid
from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class Customer(TimeStampedSoftDeleteModel):
    BADGE_CHOICES = [("bronze", "bronze"), ("silver", "silver"), ("gold", "gold"), ("platinum", "platinum")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="customers")
    branch = models.ForeignKey(
        "inventory.Branch",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="customers",
    )
    name = models.CharField(max_length=255)
    phone = models.CharField(max_length=30, blank=True)
    total_spent = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    visits = models.PositiveIntegerField(default=0)
    loyalty_points = models.IntegerField(default=0)
    qr_code = models.CharField(max_length=64, unique=True, default=uuid.uuid4)
    credits = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    debt_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    credit_limit = models.DecimalField(max_digits=12, decimal_places=2, blank=True, null=True)
    debt_started_at = models.DateTimeField(blank=True, null=True)
    debt_updated_at = models.DateTimeField(blank=True, null=True)
    debt_due_date = models.DateField(blank=True, null=True)
    debt_notes = models.TextField(blank=True)
    last_visit = models.DateTimeField(blank=True, null=True)
    badge = models.CharField(max_length=20, choices=BADGE_CHOICES, default="bronze")


class LoyaltyTransaction(TimeStampedSoftDeleteModel):
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="loyalty_transactions")
    points_change = models.IntegerField()
    reason = models.CharField(max_length=255, blank=True)


class CreditTransaction(TimeStampedSoftDeleteModel):
    TYPE_CHOICES = [("add", "add"), ("redeem", "redeem"), ("debt", "debt"), ("payment", "payment"), ("writeoff", "writeoff")]
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="credit_transactions")
    sale = models.ForeignKey(
        "sales.Sale",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="credit_transactions",
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    settled_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    due_date = models.DateField(blank=True, null=True)
    type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    reason = models.CharField(max_length=255, blank=True)
    idempotency_key = models.CharField(max_length=120, blank=True)
    payment_allocations = models.JSONField(default=list, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["customer", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_credit_transaction_key_per_customer",
            )
        ]
