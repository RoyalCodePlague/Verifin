import hashlib

from django.conf import settings
from django.db import models
from decimal import Decimal

from core.models import TimeStampedSoftDeleteModel


def default_automation_rules():
    return {
        "low_stock": True,
        "no_sales_today": True,
        "high_discrepancies": False,
        "high_expenses": False,
    }


class AutomationPreferences(TimeStampedSoftDeleteModel):
    SEVERITY_CHOICES = [("info", "info"), ("warning", "warning"), ("critical", "critical")]
    CHANNEL_CHOICES = [("in_app", "in_app"), ("email", "email"), ("whatsapp", "whatsapp")]

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="automation_preferences")
    enabled_rules = models.JSONField(default=default_automation_rules)
    severity = models.CharField(max_length=20, choices=SEVERITY_CHOICES, default="warning")
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES, default="in_app")

    class Meta:
        db_table = "reports_automationpreferences"


class AutomationEmailDispatch(TimeStampedSoftDeleteModel):
    PENDING = "pending"
    SENDING = "sending"
    SENT = "sent"
    STATUS_CHOICES = [(PENDING, PENDING), (SENDING, SENDING), (SENT, SENT)]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="automation_email_dispatches",
    )
    delivery_date = models.DateField()
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default=PENDING)
    attempts = models.PositiveSmallIntegerField(default=0)
    sent_at = models.DateTimeField(blank=True, null=True)
    last_error = models.CharField(max_length=80, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "delivery_date"],
                condition=models.Q(is_deleted=False),
                name="unique_active_automation_email_per_day",
            )
        ]


class CustomReport(TimeStampedSoftDeleteModel):
    METRIC_CHOICES = [("sales", "sales"), ("profit", "profit"), ("transactions", "transactions")]
    GROUP_CHOICES = [("day", "day"), ("month", "month"), ("year", "year")]
    BRANCH_FILTER_CHOICES = [("all", "all"), ("unassigned", "unassigned"), ("branch", "branch")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="custom_reports")
    name = models.CharField(max_length=120)
    metric = models.CharField(max_length=20, choices=METRIC_CHOICES)
    group_by = models.CharField(max_length=20, choices=GROUP_CHOICES)
    start_date = models.DateField(blank=True, null=True)
    end_date = models.DateField(blank=True, null=True)
    branch_filter = models.CharField(max_length=20, choices=BRANCH_FILTER_CHOICES, default="all")
    branch = models.ForeignKey(
        "inventory.Branch", on_delete=models.SET_NULL, blank=True, null=True, related_name="custom_reports"
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"],
                condition=models.Q(is_deleted=False),
                name="unique_active_custom_report_name_per_user",
            )
        ]
        ordering = ["name", "id"]


class BankAccount(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bank_accounts")
    name = models.CharField(max_length=120)
    currency = models.CharField(max_length=10)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"],
                condition=models.Q(is_deleted=False),
                name="unique_active_bank_account_name_per_user",
            )
        ]
        ordering = ["name", "id"]


class BankStatementLine(TimeStampedSoftDeleteModel):
    account = models.ForeignKey(BankAccount, on_delete=models.CASCADE, related_name="statement_lines")
    transaction_date = models.DateField()
    description = models.CharField(max_length=255)
    reference = models.CharField(max_length=120, blank=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    fingerprint = models.CharField(max_length=64)
    matched_sale = models.OneToOneField(
        "sales.Sale", on_delete=models.SET_NULL, blank=True, null=True, related_name="bank_statement_match"
    )
    matched_expense = models.OneToOneField(
        "expenses.Expense", on_delete=models.SET_NULL, blank=True, null=True, related_name="bank_statement_match"
    )
    matched_supplier_payment = models.OneToOneField(
        "inventory.SupplierPayment",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="bank_statement_match",
    )
    matched_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["account", "fingerprint"], name="unique_statement_line_per_account"),
        ]
        indexes = [models.Index(fields=["account", "transaction_date"])]
        ordering = ["-transaction_date", "-id"]

    def save(self, *args, **kwargs):
        self.amount = self.amount.quantize(Decimal("0.01"))
        if not self.fingerprint:
            fingerprint_text = "|".join(
                [
                    self.transaction_date.isoformat(),
                    self.description.strip().casefold(),
                    self.reference.strip().casefold(),
                    str(self.amount),
                ]
            )
            self.fingerprint = hashlib.sha256(fingerprint_text.encode("utf-8")).hexdigest()
        super().save(*args, **kwargs)
