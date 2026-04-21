from decimal import Decimal

from rest_framework import serializers
from core.currency import get_rate_to_base, normalize_allocations
from .models import Expense, ExpenseCategory


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = "__all__"


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True)
    currency = serializers.CharField(required=False)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False)
    amount_base = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_allocations = serializers.JSONField(required=False)

    class Meta:
        model = Expense
        fields = [
            "id",
            "description",
            "amount",
            "currency",
            "fx_rate_to_base",
            "amount_base",
            "payment_allocations",
            "category",
            "category_name",
            "date",
            "created_by",
            "receipt_image",
            "created_at",
            "updated_at",
            "is_deleted",
        ]
        read_only_fields = ["created_by"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return attrs

        currency = (attrs.get("currency") or getattr(self.instance, "currency", user.currency) or user.currency).strip().upper()
        attrs["currency"] = currency
        amount = attrs.get("amount", getattr(self.instance, "amount", Decimal("0")))
        rate = get_rate_to_base(user, currency, attrs.get("fx_rate_to_base", getattr(self.instance, "fx_rate_to_base", None)))
        attrs["fx_rate_to_base"] = rate
        attrs["amount_base"] = (Decimal(str(amount)) * rate).quantize(Decimal("0.01"))
        allocations, allocations_total = normalize_allocations(
            user,
            attrs.get("payment_allocations", getattr(self.instance, "payment_allocations", [])),
            amount,
            currency,
            rate,
        )
        attrs["payment_allocations"] = allocations
        if allocations_total != attrs["amount_base"]:
            raise serializers.ValidationError({
                "payment_allocations": "Split payments must add up to the converted expense total."
            })
        return attrs
