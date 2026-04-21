from decimal import Decimal, InvalidOperation

from rest_framework import serializers


def as_decimal(value, field_name="value"):
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError) as exc:
        raise serializers.ValidationError({field_name: "Enter a valid number."}) from exc


def get_rate_to_base(user, currency, explicit_rate=None, field_name="fx_rate_to_base"):
    base_currency = getattr(user, "currency", "ZAR")
    if currency == base_currency:
        return Decimal("1")
    if explicit_rate not in [None, ""]:
        rate = as_decimal(explicit_rate, field_name)
        if rate <= 0:
            raise serializers.ValidationError({field_name: "Rate must be greater than zero."})
        return rate
    rates = getattr(user, "exchange_rates", {}) or {}
    stored = rates.get(currency)
    if stored in [None, ""]:
        raise serializers.ValidationError({field_name: f"No saved exchange rate found for {currency}."})
    rate = as_decimal(stored, field_name)
    if rate <= 0:
        raise serializers.ValidationError({field_name: "Rate must be greater than zero."})
    return rate


def normalize_allocations(user, allocations, default_amount, default_currency, default_rate, field_name="payment_allocations"):
    rows = allocations or []
    if not rows:
        rows = [{"currency": default_currency, "amount": str(default_amount), "fx_rate_to_base": str(default_rate)}]

    normalized = []
    total_base = Decimal("0")
    for idx, row in enumerate(rows):
        currency = (row.get("currency") or default_currency or "").strip().upper()
        if not currency:
            raise serializers.ValidationError({field_name: f"Allocation {idx + 1} is missing a currency."})
        amount = as_decimal(row.get("amount", 0), field_name)
        if amount <= 0:
            raise serializers.ValidationError({field_name: f"Allocation {idx + 1} amount must be greater than zero."})
        rate = get_rate_to_base(user, currency, row.get("fx_rate_to_base"), field_name)
        amount_base = (amount * rate).quantize(Decimal("0.01"))
        normalized.append({
            "currency": currency,
            "amount": str(amount.quantize(Decimal('0.01'))),
            "fx_rate_to_base": str(rate.quantize(Decimal('0.000001'))),
            "amount_base": str(amount_base),
        })
        total_base += amount_base
    return normalized, total_base.quantize(Decimal("0.01"))
