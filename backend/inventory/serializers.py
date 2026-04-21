from decimal import Decimal
from rest_framework import serializers
from core.currency import get_rate_to_base
from .models import Branch, Category, Product, PurchaseOrder, PurchaseOrderItem, StockMovement, StockTransfer, Supplier


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = "__all__"
        read_only_fields = ["user", "created_at", "updated_at"]


class BranchSerializer(serializers.ModelSerializer):
    class Meta:
        model = Branch
        fields = "__all__"
        read_only_fields = ["user", "created_at", "updated_at"]


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = "__all__"
        read_only_fields = ["user", "created_at", "updated_at"]


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
    supplier_name = serializers.CharField(source="preferred_supplier.name", read_only=True, allow_null=True)
    inventory_value = serializers.SerializerMethodField()
    inventory_cost = serializers.SerializerMethodField()
    potential_profit = serializers.SerializerMethodField()
    margin_percent = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = "__all__"
        read_only_fields = ["user", "status", "created_at", "updated_at"]

    def get_inventory_value(self, obj):
        return obj.stock * obj.price

    def get_inventory_cost(self, obj):
        return obj.stock * obj.cost_price

    def get_potential_profit(self, obj):
        return obj.stock * (obj.price - obj.cost_price)

    def get_margin_percent(self, obj):
        if not obj.price:
            return Decimal("0")
        return ((obj.price - obj.cost_price) / obj.price) * 100

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        branch = attrs.get("branch")
        category = attrs.get("category")
        if user and user.is_authenticated:
            if branch and branch.user_id != user.id:
                raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
            if category and category.user_id != user.id:
                raise serializers.ValidationError({"category": "Category does not belong to this account."})
            supplier = attrs.get("preferred_supplier")
            if supplier and supplier.user_id != user.id:
                raise serializers.ValidationError({"preferred_supplier": "Supplier does not belong to this account."})
        return attrs


class StockMovementSerializer(serializers.ModelSerializer):
    class Meta:
        model = StockMovement
        fields = "__all__"
        read_only_fields = ["created_by", "created_at", "updated_at"]


class StockTransferSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    from_branch_name = serializers.CharField(source="from_branch.name", read_only=True)
    to_branch_name = serializers.CharField(source="to_branch.name", read_only=True)

    class Meta:
        model = StockTransfer
        fields = "__all__"
        read_only_fields = ["created_by", "created_at", "updated_at"]


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    sku = serializers.CharField(source="product.sku", read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = "__all__"
        read_only_fields = ["line_total", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        product = attrs.get("product")
        if user and user.is_authenticated and product and product.user_id != user.id:
            raise serializers.ValidationError({"product": "Product does not belong to this account."})
        return attrs


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
    currency = serializers.CharField(required=False)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False)

    class Meta:
        model = PurchaseOrder
        fields = "__all__"
        read_only_fields = ["user", "order_number", "total_cost", "total_cost_base", "created_at", "updated_at"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        supplier = attrs.get("supplier")
        branch = attrs.get("branch")
        if user and user.is_authenticated:
            if supplier and supplier.user_id != user.id:
                raise serializers.ValidationError({"supplier": "Supplier does not belong to this account."})
            if branch and branch.user_id != user.id:
                raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
            currency = (attrs.get("currency") or getattr(self.instance, "currency", user.currency) or user.currency).strip().upper()
            attrs["currency"] = currency
            attrs["fx_rate_to_base"] = get_rate_to_base(user, currency, attrs.get("fx_rate_to_base", getattr(self.instance, "fx_rate_to_base", None)))
        return attrs

    def create(self, validated_data):
        items = validated_data.pop("items", [])
        order = PurchaseOrder.objects.create(**validated_data)
        total = Decimal("0")
        total_base = Decimal("0")
        for item in items:
            line_total = item["unit_cost"] * item["quantity_ordered"]
            line_total_base = (line_total * order.fx_rate_to_base).quantize(Decimal("0.01"))
            unit_cost_base = (item["unit_cost"] * order.fx_rate_to_base).quantize(Decimal("0.01"))
            PurchaseOrderItem.objects.create(
                purchase_order=order,
                line_total=line_total,
                line_total_base=line_total_base,
                unit_cost_base=unit_cost_base,
                **item,
            )
            total += line_total
            total_base += line_total_base
        order.total_cost = total
        order.total_cost_base = total_base
        order.save()
        return order

    def update(self, instance, validated_data):
        items = validated_data.pop("items", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        if items is not None:
            instance.items.all().delete()
            total = Decimal("0")
            total_base = Decimal("0")
            for item in items:
                line_total = item["unit_cost"] * item["quantity_ordered"]
                line_total_base = (line_total * instance.fx_rate_to_base).quantize(Decimal("0.01"))
                unit_cost_base = (item["unit_cost"] * instance.fx_rate_to_base).quantize(Decimal("0.01"))
                PurchaseOrderItem.objects.create(
                    purchase_order=instance,
                    line_total=line_total,
                    line_total_base=line_total_base,
                    unit_cost_base=unit_cost_base,
                    **item,
                )
                total += line_total
                total_base += line_total_base
            instance.total_cost = total
            instance.total_cost_base = total_base
            instance.save()
        return instance
