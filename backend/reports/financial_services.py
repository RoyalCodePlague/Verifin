from datetime import date
from decimal import Decimal

from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.exceptions import ValidationError


CENT = Decimal("0.01")


def calculate_account_balance(account, as_of: date | None = None) -> dict[str, Decimal]:
    as_of = as_of or timezone.localdate()
    if as_of < account.opening_date:
        return {"balance": Decimal("0.00"), "balance_base": Decimal("0.00")}
    transactions = account.transactions.filter(is_deleted=False)
    transactions = transactions.filter(transaction_date__lte=as_of)

    totals = transactions.aggregate(
        money_in=Sum("amount", filter=Q(direction="in")),
        money_out=Sum("amount", filter=Q(direction="out")),
        base_in=Sum("amount_base", filter=Q(direction="in")),
        base_out=Sum("amount_base", filter=Q(direction="out")),
    )
    opening = account.opening_balance
    opening_base = (opening * account.opening_fx_rate_to_base).quantize(CENT)
    return {
        "balance": (opening + (totals["money_in"] or Decimal("0")) - (totals["money_out"] or Decimal("0"))).quantize(CENT),
        "balance_base": (opening_base + (totals["base_in"] or Decimal("0")) - (totals["base_out"] or Decimal("0"))).quantize(CENT),
    }


def post_allocations_to_accounts(
    *,
    user,
    allocations: list[dict],
    direction: str,
    entry_type: str,
    transaction_date: date,
    description: str,
    source_key: str,
    created_by=None,
    reference: str = "",
):
    """Post normalized payment allocations into the selected account ledgers."""
    from .models import AccountTransaction, BankAccount

    selected = [(index, row) for index, row in enumerate(allocations or []) if row.get("account")]
    if not selected:
        return []
    account_ids = sorted({int(row["account"]) for _, row in selected})
    accounts = {
        account.pk: account
        for account in BankAccount.objects.select_for_update().filter(
            pk__in=account_ids,
            user=user,
            is_deleted=False,
        ).order_by("pk")
    }
    if len(accounts) != len(account_ids):
        raise ValidationError({"payment_allocations": "A selected financial account is unavailable."})

    posted = []
    for index, allocation in selected:
        account = accounts[int(allocation["account"])]
        if not account.is_active:
            raise ValidationError({"payment_allocations": f"Activate {account.name} before posting this payment."})
        if account.currency.upper() != allocation["currency"].upper():
            raise ValidationError({"payment_allocations": f"Payment currency no longer matches {account.name}."})
        if transaction_date < account.opening_date:
            raise ValidationError({"payment_allocations": f"Transaction date is before {account.name}'s opening date."})

        key = f"{source_key}:{index}"
        if len(key) > 120:
            raise ValidationError({"payment_allocations": "The account transaction reference is too long."})
        amount = Decimal(str(allocation["amount"]))
        fx_rate = Decimal(str(allocation["fx_rate_to_base"]))
        amount_base = Decimal(str(allocation["amount_base"]))
        existing = AccountTransaction.objects.filter(user=user, idempotency_key=key).first()
        if existing:
            matches = (
                existing.account_id == account.pk
                and existing.direction == direction
                and existing.entry_type == entry_type
                and existing.amount == amount
                and existing.fx_rate_to_base == fx_rate
                and existing.amount_base == amount_base
                and existing.transaction_date == transaction_date
                and existing.description == description[:255]
                and existing.reference == reference[:120]
            )
            if matches:
                posted.append(existing)
                continue
            raise ValidationError({"payment_allocations": "This payment already has a different account posting."})

        posted.append(AccountTransaction.objects.create(
            user=user,
            account=account,
            direction=direction,
            entry_type=entry_type,
            amount=amount,
            fx_rate_to_base=fx_rate,
            amount_base=amount_base,
            transaction_date=transaction_date,
            description=description[:255],
            reference=reference[:120],
            idempotency_key=key,
            created_by=created_by or user,
        ))
    return posted


def reverse_source_account_postings(
    *,
    user,
    source_key: str,
    reversal_key: str,
    transaction_date: date,
    reason: str,
    created_by=None,
):
    """Post one traceable opposite entry for each account allocation on a source record."""
    from .models import AccountTransaction

    originals = AccountTransaction.objects.select_for_update().filter(
        user=user,
        idempotency_key__startswith=f"{source_key}:",
        reversal_of__isnull=True,
    ).order_by("id")
    reversals = []
    for original in originals:
        reversal_idempotency_key = f"{reversal_key}:{original.pk}"
        existing = AccountTransaction.objects.filter(
            user=user,
            idempotency_key=reversal_idempotency_key,
        ).first()
        if existing:
            if existing.reversal_of_id == original.pk:
                reversals.append(existing)
                continue
            raise ValidationError({"detail": "A reversal reference is already in use."})
        if AccountTransaction.objects.filter(reversal_of=original).exists():
            reversals.append(original.reversal_transaction)
            continue
        reversals.append(AccountTransaction.objects.create(
            user=user,
            account=original.account,
            reversal_of=original,
            direction="out" if original.direction == "in" else "in",
            entry_type="reversal",
            amount=original.amount,
            fx_rate_to_base=original.fx_rate_to_base,
            amount_base=original.amount_base,
            transaction_date=transaction_date,
            description=f"Reversal of {original.description}: {reason}"[:255],
            reference=original.reference,
            idempotency_key=reversal_idempotency_key[:120],
            created_by=created_by or user,
        ))
    return reversals
