from decimal import Decimal
from django.db import transaction
from django.db.models import DecimalField, ExpressionWrapper, F, Sum
from rest_framework import serializers
from core.currency import get_rate_to_base
from .models import Branch, Category, Product, ProductBatch, PurchaseOrder, PurchaseOrderItem, StockMovement, StockTransfer, Supplier, SupplierPayment


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
        if self.instance and "stock" in attrs:
            tracked_stock = self.instance.batches.filter(is_deleted=False).aggregate(
                total=Sum("quantity_remaining")
            )["total"] or 0
            if attrs["stock"] < tracked_stock:
                raise serializers.ValidationError({"stock": "Product stock cannot be lower than the quantity in tracked batches."})
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

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        product = attrs.get("product")
        if user and user.is_authenticated and product and product.user_id != user.id:
            raise serializers.ValidationError({"product": "Product does not belong to this account."})
        batch = attrs.get("batch")
        if batch and batch.product_id != product.id:
            raise serializers.ValidationError({"batch": "Batch does not belong to this product."})
        return attrs


class ProductBatchSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    sku = serializers.CharField(source="product.sku", read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True, allow_null=True)

    class Meta:
        model = ProductBatch
        fields = "__all__"
        read_only_fields = ["quantity_remaining", "received_at", "created_at", "updated_at"]
        extra_kwargs = {
            "product": {"required": True},
            "batch_number": {"required": True},
            "quantity_received": {"required": True, "min_value": 1},
        }

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        product = attrs.get("product")
        supplier = attrs.get("supplier")
        if user and user.is_authenticated:
            if not product or product.user_id != user.id:
                raise serializers.ValidationError({"product": "Product does not belong to this account."})
            if supplier and supplier.user_id != user.id:
                raise serializers.ValidationError({"supplier": "Supplier does not belong to this account."})
        if self.instance and attrs.get("quantity_received", self.instance.quantity_received) < self.instance.quantity_remaining:
            raise serializers.ValidationError({"quantity_received": "Received quantity cannot be lower than remaining stock."})
        return attrs


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
        read_only_fields = [
            "purchase_order",
            "quantity_received",
            "unit_cost_base",
            "line_total",
            "line_total_base",
            "created_at",
            "updated_at",
        ]

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


class SupplierPaymentSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    order_number = serializers.CharField(source="purchase_order.order_number", read_only=True)

    class Meta:
        model = SupplierPayment
        fields = "__all__"
        read_only_fields = ["user", "created_by", "fx_rate_to_base", "amount_base", "created_at", "updated_at"]
        extra_kwargs = {"amount": {"min_value": Decimal("0.01")}}

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        supplier = attrs.get("supplier")
        order = attrs.get("purchase_order")
        if not user or not user.is_authenticated:
            return attrs
        if not supplier or supplier.user_id != user.id:
            raise serializers.ValidationError({"supplier": "Supplier does not belong to this account."})
        if not order or order.user_id != user.id or order.supplier_id != supplier.id:
            raise serializers.ValidationError({"purchase_order": "Choose a purchase order for this supplier."})
        if order.status not in {"partially_received", "received"}:
            raise serializers.ValidationError({"purchase_order": "Only received purchase orders can be paid."})
        currency = (attrs.get("currency") or user.currency).strip().upper()
        fx_rate = get_rate_to_base(user, currency, attrs.get("fx_rate_to_base"))
        amount_base = (attrs["amount"] * fx_rate).quantize(Decimal("0.01"))
        attrs["currency"] = currency
        attrs["fx_rate_to_base"] = fx_rate
        attrs["amount_base"] = amount_base
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        request = self.context["request"]
        order = PurchaseOrder.objects.select_for_update().get(
            pk=validated_data["purchase_order"].pk,
            user=request.user,
            supplier=validated_data["supplier"],
        )
        received_total = order.items.aggregate(
            total=Sum(ExpressionWrapper(
                F("unit_cost_base") * F("quantity_received"),
                output_field=DecimalField(max_digits=18, decimal_places=2),
            ))
        )["total"] or Decimal("0")
        paid_total = order.payments.filter(is_deleted=False).aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
        outstanding = received_total - paid_total
        if validated_data["amount_base"] > outstanding:
            raise serializers.ValidationError({
                "amount": f"Payment exceeds the outstanding order balance of {outstanding:.2f} {request.user.currency}."
            })
        return SupplierPayment.objects.create(
            user=request.user,
            created_by=request.user,
            **validated_data,
        )
