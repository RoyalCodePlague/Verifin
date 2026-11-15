from django.contrib import admin

from .models import Expense, ExpenseBudget, ExpenseCategory, OtherIncome, RecurringExpense


@admin.register(ExpenseCategory)
class ExpenseCategoryAdmin(admin.ModelAdmin):
    search_fields = ["name"]
    list_display = ["name", "is_deleted", "updated_at"]


@admin.register(Expense)
class ExpenseAdmin(admin.ModelAdmin):
    list_display = ["description", "amount_base", "expense_type", "date", "created_by", "branch"]
    list_filter = ["expense_type", "date", "branch", "category"]
    search_fields = ["description", "created_by__email"]
    readonly_fields = ["amount_base", "fx_rate_to_base", "recurring_schedule", "recurrence_date"]


@admin.register(RecurringExpense)
class RecurringExpenseAdmin(admin.ModelAdmin):
    list_display = ["description", "amount_base", "frequency", "next_due_date", "is_active", "user"]
    list_filter = ["frequency", "is_active", "expense_type"]
    search_fields = ["description", "user__email"]


@admin.register(ExpenseBudget)
class ExpenseBudgetAdmin(admin.ModelAdmin):
    list_display = ["user", "category", "branch", "expense_type", "period_start", "period_end", "amount_base"]
    list_filter = ["expense_type", "branch", "category"]


@admin.register(OtherIncome)
class OtherIncomeAdmin(admin.ModelAdmin):
    list_display = ["description", "amount_base", "date", "created_by", "branch"]
    list_filter = ["date", "branch"]
    search_fields = ["description", "created_by__email"]
