import hashlib

from django.conf import settings
from django.db import models
from decimal import Decimal

from core.models import TimeStampedSoftDeleteModel


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
