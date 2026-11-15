from decimal import Decimal

from django.db.models import F, Min

from .models import CreditTransaction


def apply_customer_payment(customer, amount):
    """Apply a collection to the oldest open invoices, then older manual debt."""
    from sales.models import Sale

    remaining = Decimal(amount)
    sales = Sale.objects.select_for_update().filter(
        created_by=customer.user,
        customer=customer,
        is_deleted=False,
        balance_due__gt=0,
    ).order_by("date", "id")
    for sale in sales:
        applied = min(remaining, sale.balance_due)
        if applied <= 0:
            continue
        sale.balance_due -= applied
        sale.amount_paid_base += applied
        sale.save(update_fields=["balance_due", "amount_paid_base", "updated_at"])
        debt_entry = CreditTransaction.objects.select_for_update().filter(
            customer=customer,
            sale=sale,
            type="debt",
            is_deleted=False,
        ).first()
        if debt_entry:
            debt_entry.settled_amount = min(debt_entry.amount, debt_entry.settled_amount + applied)
            debt_entry.save(update_fields=["settled_amount", "updated_at"])
        remaining -= applied
        if remaining == 0:
            break

    if remaining > 0:
        manual_debts = CreditTransaction.objects.select_for_update().filter(
            customer=customer,
            sale__isnull=True,
            type="debt",
            is_deleted=False,
            settled_amount__lt=F("amount"),
        ).order_by("created_at", "id")
        for debt_entry in manual_debts:
            outstanding = debt_entry.amount - debt_entry.settled_amount
            applied = min(remaining, outstanding)
            if applied <= 0:
                continue
            debt_entry.settled_amount += applied
            debt_entry.save(update_fields=["settled_amount", "updated_at"])
            remaining -= applied
            if remaining == 0:
                break
    return remaining


def refresh_customer_debt_due_date(customer):
    """Keep the account summary date aligned to debt that is still outstanding."""
    from sales.models import Sale

    if customer.debt_amount <= 0:
        next_due_date = None
    else:
        invoice_due = Sale.objects.filter(
            created_by=customer.user,
            customer=customer,
            is_deleted=False,
            balance_due__gt=0,
            due_date__isnull=False,
        ).aggregate(value=Min("due_date"))["value"]
        manual_due = CreditTransaction.objects.filter(
            customer=customer,
            sale__isnull=True,
            type="debt",
            is_deleted=False,
            settled_amount__lt=F("amount"),
            due_date__isnull=False,
        ).aggregate(value=Min("due_date"))["value"]
        dates = [value for value in (invoice_due, manual_due) if value]
        next_due_date = min(dates) if dates else None

    if customer.debt_due_date != next_due_date:
        customer.debt_due_date = next_due_date
        customer.save(update_fields=["debt_due_date", "updated_at"])
    return next_due_date
