from rest_framework import serializers
from .models import Audit, Discrepancy, StockCount


class AuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = Audit
        fields = "__all__"
        read_only_fields = ["conductor", "completed_at"]


class DiscrepancySerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = Discrepancy
        fields = [
            "id",
            "audit",
            "product",
            "product_name",
            "expected_stock",
            "actual_stock",
            "difference",
            "status",
            "resolved_by",
            "resolved_at",
            "created_at",
            "updated_at",
            "is_deleted",
        ]


class StockCountSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockCount
        fields = "__all__"
        read_only_fields = ["counted_by"]
