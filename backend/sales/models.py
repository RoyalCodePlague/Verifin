from django.conf import settings
from django.db import models
from django.utils import timezone
from core.models import TimeStampedSoftDeleteModel
from customers.models import Customer
from inventory.models import Branch, Product


class Sale(TimeStampedSoftDeleteModel):
    PAYMENT_CHOICES = [("Cash", "Cash"), ("EFT", "EFT"), ("Card", "Card"), ("Credit", "Credit")]
    items = models.TextField(blank=True)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    gross_profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_CHOICES, default="Cash")
    payment_currency = models.CharField(max_length=10, default="ZAR")
    payment_allocations = models.JSONField(default=list, blank=True)
    amount_paid_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    balance_due = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    due_date = models.DateField(blank=True, null=True)
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="sales")
    till_session = models.ForeignKey("TillSession", on_delete=models.SET_NULL, blank=True, null=True, related_name="sales")
    receipt_number = models.CharField(max_length=40, blank=True)
    integration_id = models.CharField(max_length=120, blank=True)
    invoice_number = models.CharField(max_length=40, blank=True)
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, blank=True, null=True, related_name="sales")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sales")
    # Keep sale dates aligned with Django's configured business timezone. DateField's
    # auto_now_add uses the operating system's local date, which can differ from
    # timezone.localdate() for deployments configured to run in UTC.
    date = models.DateField(default=timezone.localdate, editable=False)
    time = models.TimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["created_by", "integration_id"], condition=~models.Q(integration_id=""), name="unique_sale_integration_id_per_user"),
        ]

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        generated_fields = {}
        if not self.receipt_number and self.created_by_id:
            self.receipt_number = f"R-{self.pk:06d}"
            generated_fields["receipt_number"] = self.receipt_number
        if not self.invoice_number and self.customer_id:
            self.invoice_number = f"INV-{self.pk:06d}"
            generated_fields["invoice_number"] = self.invoice_number
        if generated_fields:
            Sale.objects.filter(pk=self.pk).update(**generated_fields)


class SaleItem(TimeStampedSoftDeleteModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="sale_items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="sale_items")
    quantity = models.IntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    cost_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)


class SaleReturn(TimeStampedSoftDeleteModel):
    REFUND_METHOD_CHOICES = [("Cash", "Cash"), ("EFT", "EFT"), ("Card", "Card"), ("Credit", "Apply to customer balance")]

    sale_item = models.ForeignKey(SaleItem, on_delete=models.PROTECT, related_name="returns")
    quantity = models.PositiveIntegerField()
    refund_amount = models.DecimalField(max_digits=12, decimal_places=2)
    payment_allocations = models.JSONField(default=list, blank=True)
    cost_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    refund_method = models.CharField(max_length=20, choices=REFUND_METHOD_CHOICES, default="Cash")
    return_date = models.DateField(default=timezone.localdate)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sale_returns")


class TillSession(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("open", "open"), ("closed", "closed")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="till_sessions")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="till_sessions")
    opened_by_staff = models.ForeignKey(
        "accounts.Staff",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="opened_till_sessions",
    )
    cashier_name = models.CharField(max_length=120, blank=True)
    opening_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    closing_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    expected_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_variance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    card_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    eft_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True)
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="reviewed_till_sessions",
    )
    reviewed_by_staff = models.ForeignKey(
        "accounts.Staff",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="reviewed_till_sessions",
    )
    reviewed_at = models.DateTimeField(blank=True, null=True)
    review_note = models.CharField(max_length=255, blank=True)


class TillCashMovement(TimeStampedSoftDeleteModel):
    TYPE_CASH_EXPENSE = "cash_expense"
    TYPE_WITHDRAWAL = "withdrawal"
    TYPE_DEPOSIT = "deposit"
    TYPE_CHOICES = [
        (TYPE_CASH_EXPENSE, "Cash expense"),
        (TYPE_WITHDRAWAL, "Cash withdrawal"),
        (TYPE_DEPOSIT, "Cash added"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="till_cash_movements")
    till_session = models.ForeignKey(TillSession, on_delete=models.PROTECT, related_name="cash_movements")
    movement_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense = models.ForeignKey(
        "expenses.Expense",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="till_cash_movements",
    )
    note = models.CharField(max_length=255, blank=True)
    idempotency_key = models.CharField(max_length=120, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recorded_till_cash_movements")

    class Meta:
        ordering = ["created_at", "id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gt=0), name="till_cash_movement_amount_positive"),
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_till_cash_movement_key_per_user",
            ),
            models.UniqueConstraint(
                fields=["expense"],
                condition=models.Q(expense__isnull=False, is_deleted=False),
                name="unique_live_till_cash_expense_link",
            ),
        ]
