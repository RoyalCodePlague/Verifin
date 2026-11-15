from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class ExpenseCategory(TimeStampedSoftDeleteModel):
    name = models.CharField(max_length=100)
    parent = models.ForeignKey(
        "self",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="subcategories",
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["name"],
                condition=models.Q(parent__isnull=True, is_deleted=False),
                name="unique_root_expense_category_name",
            ),
            models.UniqueConstraint(
                fields=["parent", "name"],
                condition=models.Q(parent__isnull=False, is_deleted=False),
                name="unique_expense_subcategory_name",
            ),
        ]


class Expense(TimeStampedSoftDeleteModel):
    TYPE_CHOICES = [("operating", "Operating expense"), ("other", "Other expense")]
    APPROVAL_STATUS_CHOICES = [("pending", "Pending approval"), ("approved", "Approved"), ("rejected", "Rejected")]

    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default="operating")
    currency = models.CharField(max_length=10, default="ZAR")
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    amount_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_allocations = models.JSONField(default=list, blank=True)
    account_posting_key = models.CharField(max_length=120, blank=True)
    approval_status = models.CharField(max_length=12, choices=APPROVAL_STATUS_CHOICES, default="approved")
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="reviewed_expenses",
    )
    reviewed_at = models.DateTimeField(blank=True, null=True)
    approval_note = models.TextField(blank=True)
    created_by_staff = models.ForeignKey(
        "accounts.Staff",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="recorded_expenses",
    )
    branch = models.ForeignKey(
        "inventory.Branch",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="expenses",
    )
    category = models.ForeignKey(ExpenseCategory, on_delete=models.SET_NULL, null=True, related_name="expenses")
    recurring_schedule = models.ForeignKey(
        "RecurringExpense",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="occurrences",
    )
    recurrence_date = models.DateField(blank=True, null=True)
    date = models.DateField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="expenses")
    receipt_image = models.ImageField(upload_to="receipts/", blank=True, null=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["recurring_schedule", "recurrence_date"],
                condition=models.Q(recurring_schedule__isnull=False, recurrence_date__isnull=False),
                name="unique_recurring_expense_occurrence",
            ),
        ]


class RecurringExpense(TimeStampedSoftDeleteModel):
    FREQUENCY_CHOICES = [
        ("weekly", "Weekly"),
        ("monthly", "Monthly"),
        ("quarterly", "Quarterly"),
        ("yearly", "Yearly"),
    ]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="recurring_expenses")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_recurring_expenses")
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    expense_type = models.CharField(max_length=20, choices=Expense.TYPE_CHOICES, default="operating")
    currency = models.CharField(max_length=10, default="ZAR")
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    amount_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_allocations = models.JSONField(default=list, blank=True)
    branch = models.ForeignKey(
        "inventory.Branch",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="recurring_expenses",
    )
    category = models.ForeignKey(ExpenseCategory, on_delete=models.SET_NULL, blank=True, null=True, related_name="recurring_expenses")
    frequency = models.CharField(max_length=12, choices=FREQUENCY_CHOICES)
    first_due_date = models.DateField()
    next_due_date = models.DateField()
    end_date = models.DateField(blank=True, null=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["next_due_date", "id"]
        indexes = [models.Index(fields=["user", "is_active", "next_due_date"])]


class ExpenseBudget(TimeStampedSoftDeleteModel):
    EXPENSE_TYPE_CHOICES = [("all", "All expenses"), *Expense.TYPE_CHOICES]

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="expense_budgets")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="created_expense_budgets")
    category = models.ForeignKey(ExpenseCategory, on_delete=models.SET_NULL, blank=True, null=True, related_name="budgets")
    branch = models.ForeignKey(
        "inventory.Branch",
        on_delete=models.PROTECT,
        blank=True,
        null=True,
        related_name="expense_budgets",
    )
    expense_type = models.CharField(max_length=20, choices=EXPENSE_TYPE_CHOICES, default="operating")
    period_start = models.DateField()
    period_end = models.DateField()
    amount_base = models.DecimalField(max_digits=12, decimal_places=2)
    note = models.CharField(max_length=255, blank=True)
    scope_key = models.CharField(max_length=120, editable=False, default="")

    class Meta:
        ordering = ["-period_start", "category__name", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["user", "scope_key"],
                condition=models.Q(is_deleted=False),
                name="unique_expense_budget_scope",
            ),
            models.CheckConstraint(condition=models.Q(amount_base__gt=0), name="expense_budget_amount_positive"),
            models.CheckConstraint(condition=models.Q(period_end__gte=models.F("period_start")), name="expense_budget_period_valid"),
        ]

    def save(self, *args, **kwargs):
        self.scope_key = "|".join([
            str(self.branch_id or "all"),
            str(self.category_id or "all"),
            self.expense_type,
            self.period_start.isoformat() if self.period_start else "",
            self.period_end.isoformat() if self.period_end else "",
        ])
        super().save(*args, **kwargs)


class OtherIncome(TimeStampedSoftDeleteModel):
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    currency = models.CharField(max_length=10, default="ZAR")
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    amount_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_allocations = models.JSONField(default=list, blank=True)
    account_posting_key = models.CharField(max_length=120, blank=True)
    branch = models.ForeignKey(
        "inventory.Branch",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
        related_name="other_income",
    )
    date = models.DateField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="other_income")
