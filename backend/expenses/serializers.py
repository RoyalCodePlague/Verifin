from rest_framework import serializers
from .models import Expense, ExpenseCategory


class ExpenseCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ExpenseCategory
        fields = "__all__"


class ExpenseSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True)

    class Meta:
        model = Expense
        fields = [
            "id",
            "description",
            "amount",
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
