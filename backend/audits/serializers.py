from rest_framework import serializers
from .models import Audit, Discrepancy, StockCount


class AuditSerializer(serializers.ModelSerializer):
    class Meta:
        model = Audit
        fields = "__all__"
        read_only_fields = ["conductor", "completed_at"]

    def validate(self, attrs):
        if attrs.get("status") == "completed" and self.instance is None:
            raise serializers.ValidationError({"status": "Create an audit and record counts before completing it."})
        if self.instance and self.instance.status == "completed":
            if any(key in attrs for key in ("status", "items_counted", "discrepancies_found")):
                raise serializers.ValidationError("Completed audit results cannot be edited.")
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and user.is_authenticated:
            for count in attrs.get("stock_counts", []):
                product = count.get("product")
                if product and product.user_id != user.id:
                    raise serializers.ValidationError({"product": "Product does not belong to this account."})
        return attrs


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
        read_only_fields = ["resolved_by", "resolved_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if user and user.is_authenticated:
            audit = attrs.get("audit")
            product = attrs.get("product")
            if audit and audit.conductor_id != user.id:
                raise serializers.ValidationError({"audit": "Audit does not belong to this account."})
            if product and product.user_id != user.id:
                raise serializers.ValidationError({"product": "Product does not belong to this account."})
        return attrs


class StockCountSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockCount
        fields = "__all__"
        read_only_fields = ["counted_by"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if attrs.get("counted_quantity", 0) < 0:
            raise serializers.ValidationError({"counted_quantity": "Count cannot be negative."})
        audit = attrs.get("audit", getattr(self.instance, "audit", None))
        if audit and audit.status == "completed":
            raise serializers.ValidationError({"audit": "Completed audit counts cannot be edited."})
        if user and user.is_authenticated:
            audit = attrs.get("audit")
            product = attrs.get("product")
            if audit and audit.conductor_id != user.id:
                raise serializers.ValidationError({"audit": "Audit does not belong to this account."})
            if product and product.user_id != user.id:
                raise serializers.ValidationError({"product": "Product does not belong to this account."})
        return attrs
