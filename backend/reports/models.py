import hashlib

from django.conf import settings
from django.db import models
from django.utils import timezone
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
    SORT_CHOICES = [("asc", "asc"), ("desc", "desc")]
    BRANCH_FILTER_CHOICES = [("all", "all"), ("unassigned", "unassigned"), ("branch", "branch")]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="custom_reports")
    name = models.CharField(max_length=120)
    metric = models.CharField(max_length=20, choices=METRIC_CHOICES)
    metrics = models.JSONField(default=list, blank=True)
    group_by = models.CharField(max_length=20, choices=GROUP_CHOICES)
    sort_order = models.CharField(max_length=4, choices=SORT_CHOICES, default="asc")
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


class AutomationRule(TimeStampedSoftDeleteModel):
    TRIGGER_CHOICES = [
        ("stock_below_minimum", "Stock below minimum"),
        ("customer_overdue", "Customer account overdue"),
        ("expense_exceeds_limit", "Expense exceeds limit"),
        ("purchase_order_approved", "Purchase order approved"),
        ("till_session_closed", "Till session closed"),
    ]
    ACTION_CHOICES = [
        ("create_notification", "Create notification"),
        ("create_follow_up", "Create customer follow-up reminder"),
        ("require_manager_approval", "Require manager approval"),
        ("create_reconciliation_summary", "Create reconciliation summary"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="automation_rules")
    name = models.CharField(max_length=120)
    trigger = models.CharField(max_length=40, choices=TRIGGER_CHOICES)
    conditions = models.JSONField(default=dict, blank=True)
    action = models.CharField(max_length=40, choices=ACTION_CHOICES)
    enabled = models.BooleanField(default=True)

    class Meta:
        ordering = ["name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "name"],
                condition=models.Q(is_deleted=False),
                name="unique_active_automation_rule_name_per_user",
            )
        ]


class AutomationExecution(models.Model):
    STATUS_CHOICES = [("running", "Running"), ("succeeded", "Succeeded"), ("failed", "Failed")]

    rule = models.ForeignKey(AutomationRule, on_delete=models.CASCADE, related_name="executions")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="automation_executions")
    event_key = models.CharField(max_length=180)
    object_type = models.CharField(max_length=40)
    object_id = models.CharField(max_length=80)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="running")
    attempts = models.PositiveSmallIntegerField(default=1)
    message = models.TextField(blank=True)
    last_error = models.CharField(max_length=500, blank=True)
    started_at = models.DateTimeField(default=timezone.now)
    completed_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(fields=["rule", "event_key"], name="unique_automation_rule_event_execution")
        ]
        indexes = [models.Index(fields=["user", "created_at"]), models.Index(fields=["status", "created_at"])]


class BusinessInsight(models.Model):
    STATUS_CHOICES = [
        ("active", "Active"),
        ("acknowledged", "Acknowledged"),
        ("dismissed", "Dismissed"),
        ("resolved", "Resolved"),
    ]
    SEVERITY_CHOICES = [
        ("critical", "Critical"),
        ("high", "High"),
        ("medium", "Medium"),
        ("info", "Information"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="business_insights")
    rule_key = models.CharField(max_length=180)
    title = models.CharField(max_length=180)
    explanation = models.TextField()
    supporting_figures = models.JSONField(default=dict, blank=True)
    period_start = models.DateField()
    period_end = models.DateField()
    period_label = models.CharField(max_length=255)
    severity = models.CharField(max_length=12, choices=SEVERITY_CHOICES, default="info")
    recommended_action = models.TextField(blank=True)
    link = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="active")
    generated_at = models.DateTimeField(default=timezone.now)
    acknowledged_at = models.DateTimeField(blank=True, null=True)
    dismissed_at = models.DateTimeField(blank=True, null=True)
    resolved_at = models.DateTimeField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "rule_key", "period_start", "period_end"],
                name="unique_business_insight_period",
            )
        ]
        indexes = [
            models.Index(fields=["user", "status", "period_end"]),
        ]
        ordering = ["-generated_at", "-id"]


class BankAccount(TimeStampedSoftDeleteModel):
    ACCOUNT_TYPE_CHOICES = [
        ("cash", "Cash"),
        ("bank", "Bank account"),
        ("ecocash", "EcoCash"),
        ("innbucks", "InnBucks"),
        ("mobile_money", "Other mobile money"),
        ("custom", "Custom"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="bank_accounts")
    name = models.CharField(max_length=120)
    account_type = models.CharField(max_length=20, choices=ACCOUNT_TYPE_CHOICES, default="bank")
    provider_name = models.CharField(max_length=120, blank=True)
    currency = models.CharField(max_length=10)
    opening_balance = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    opening_fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    opening_date = models.DateField(default=timezone.localdate)
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


class AccountTransfer(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="account_transfers")
    from_account = models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name="outgoing_transfers")
    to_account = models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name="incoming_transfers")
    amount_from = models.DecimalField(max_digits=14, decimal_places=2)
    amount_to = models.DecimalField(max_digits=14, decimal_places=2)
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    amount_base = models.DecimalField(max_digits=14, decimal_places=2)
    transaction_date = models.DateField()
    description = models.CharField(max_length=255, blank=True)
    reference = models.CharField(max_length=120, blank=True)
    idempotency_key = models.CharField(max_length=120, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_account_transfers")

    class Meta:
        ordering = ["-transaction_date", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_account_transfer_key_per_user",
            )
        ]


class AccountTransaction(TimeStampedSoftDeleteModel):
    DIRECTION_CHOICES = [("in", "Money received"), ("out", "Money paid out")]
    ENTRY_TYPE_CHOICES = [
        ("manual", "Manual"),
        ("transfer_in", "Transfer in"),
        ("transfer_out", "Transfer out"),
        ("sale_receipt", "Sale receipt"),
        ("sale_refund", "Sale refund"),
        ("expense_payment", "Expense payment"),
        ("income_receipt", "Other income"),
        ("supplier_payment", "Supplier payment"),
        ("customer_collection", "Customer collection"),
        ("adjustment", "Reconciliation adjustment"),
        ("reversal", "Reversal"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="account_transactions")
    account = models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name="transactions")
    transfer = models.ForeignKey(AccountTransfer, on_delete=models.PROTECT, blank=True, null=True, related_name="transactions")
    reversal_of = models.OneToOneField(
        "self",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="reversal_transaction",
    )
    direction = models.CharField(max_length=3, choices=DIRECTION_CHOICES)
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES, default="manual")
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    amount_base = models.DecimalField(max_digits=14, decimal_places=2)
    transaction_date = models.DateField()
    description = models.CharField(max_length=255)
    reference = models.CharField(max_length=120, blank=True)
    idempotency_key = models.CharField(max_length=120, blank=True)
    is_reconciled = models.BooleanField(default=False)
    reconciled_at = models.DateTimeField(blank=True, null=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_account_transactions")

    class Meta:
        ordering = ["-transaction_date", "-id"]
        indexes = [models.Index(fields=["account", "transaction_date"])]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                condition=~models.Q(idempotency_key=""),
                name="unique_account_transaction_key_per_user",
            )
        ]


class AccountReconciliationEvent(models.Model):
    transaction = models.ForeignKey(AccountTransaction, on_delete=models.PROTECT, related_name="reconciliation_events")
    reconciled = models.BooleanField()
    note = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="account_reconciliation_events")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class AccountBalanceReconciliation(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="account_balance_reconciliations")
    account = models.ForeignKey(BankAccount, on_delete=models.PROTECT, related_name="balance_reconciliations")
    as_of = models.DateField()
    expected_balance = models.DecimalField(max_digits=14, decimal_places=2)
    actual_balance = models.DecimalField(max_digits=14, decimal_places=2)
    difference = models.DecimalField(max_digits=14, decimal_places=2)
    note = models.CharField(max_length=255, blank=True)
    idempotency_key = models.CharField(max_length=120)
    adjustment_requested = models.BooleanField(default=False)
    adjustment_transaction = models.OneToOneField(
        AccountTransaction,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="balance_reconciliation",
    )
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_balance_reconciliations")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-as_of", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "idempotency_key"],
                name="unique_balance_reconciliation_key_per_user",
            ),
        ]


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
