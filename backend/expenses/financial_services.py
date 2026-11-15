from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

from .models import Expense, RecurringExpense


def _next_occurrence(schedule: RecurringExpense, current: date) -> date:
    if schedule.frequency == "weekly":
        return current + timedelta(days=7)

    months = {"monthly": 1, "quarterly": 3}.get(schedule.frequency)
    if months:
        month_index = current.month - 1 + months
        year = current.year + month_index // 12
        month = month_index % 12 + 1
        anchor_day = schedule.first_due_date.day
        return date(year, month, min(anchor_day, monthrange(year, month)[1]))

    year = current.year + 1
    month = schedule.first_due_date.month
    day = min(schedule.first_due_date.day, monthrange(year, month)[1])
    return date(year, month, day)


@transaction.atomic
def generate_due_expenses(*, user=None, through_date: date | None = None) -> dict:
    """Post every due occurrence once, preserving the schedule's recorded FX rate."""
    through_date = through_date or timezone.localdate()
    schedules = RecurringExpense.objects.select_for_update().select_related("category__parent").filter(
        is_deleted=False,
        is_active=True,
        next_due_date__lte=through_date,
    ).order_by("user_id", "id")
    if user is not None:
        schedules = schedules.filter(user=user)

    created = []
    for schedule in schedules:
        due_date = schedule.next_due_date
        while due_date <= through_date and (schedule.end_date is None or due_date <= schedule.end_date):
            expense, was_created = Expense.objects.get_or_create(
                recurring_schedule=schedule,
                recurrence_date=due_date,
                defaults={
                    "created_by_id": schedule.created_by_id,
                    "description": schedule.description,
                    "amount": schedule.amount,
                    "expense_type": schedule.expense_type,
                    "currency": schedule.currency,
                    "fx_rate_to_base": schedule.fx_rate_to_base,
                    "amount_base": schedule.amount_base,
                    "payment_allocations": schedule.payment_allocations,
                    "branch_id": schedule.branch_id,
                    "category_id": schedule.category_id,
                    "date": due_date,
                },
            )
            if was_created:
                from reports.financial_services import post_allocations_to_accounts

                source_key = f"expense:{expense.pk}:payment"
                post_allocations_to_accounts(
                    user=schedule.user,
                    allocations=expense.payment_allocations,
                    direction="out",
                    entry_type="expense_payment",
                    transaction_date=expense.date,
                    description=f"Expense: {expense.description}",
                    source_key=source_key,
                    created_by=schedule.created_by,
                )
                expense.account_posting_key = source_key
                expense.save(update_fields=["account_posting_key", "updated_at"])
                created.append({
                    "expense_id": expense.pk,
                    "schedule_id": schedule.pk,
                    "date": due_date,
                    "description": expense.description,
                    "amount": expense.amount,
                    "amount_base": expense.amount_base,
                    "currency": expense.currency,
                    "expense_type": expense.expense_type,
                    "category": expense.category_id,
                    "category_name": expense.category.name if expense.category_id else None,
                    "category_label": (
                        f"{expense.category.parent.name} / {expense.category.name}"
                        if expense.category_id and expense.category.parent_id
                        else expense.category.name if expense.category_id else None
                    ),
                    "branch": expense.branch_id,
                    "payment_allocations": expense.payment_allocations,
                })
            due_date = _next_occurrence(schedule, due_date)

        schedule.next_due_date = due_date
        if schedule.end_date is not None and due_date > schedule.end_date:
            schedule.is_active = False
        schedule.save(update_fields=["next_due_date", "is_active", "updated_at"])

    return {"created_count": len(created), "created": created, "through_date": through_date}


def get_budget_actual(budget, *, through_date: date | None = None) -> Decimal:
    expenses = Expense.objects.filter(
        created_by=budget.user,
        is_deleted=False,
        approval_status="approved",
        date__gte=budget.period_start,
        date__lte=budget.period_end,
    )
    if through_date is not None:
        expenses = expenses.filter(date__lte=through_date)
    if budget.branch_id:
        expenses = expenses.filter(branch_id=budget.branch_id)
    if budget.category_id:
        expenses = expenses.filter(category_id=budget.category_id)
    if budget.expense_type != "all":
        expenses = expenses.filter(expense_type=budget.expense_type)
    return expenses.aggregate(total=Sum("amount_base"))["total"] or Decimal("0.00")
