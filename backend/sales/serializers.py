from django.db import transaction
from decimal import Decimal
from django.utils import timezone
from rest_framework import serializers
from customers.models import Customer, LoyaltyTransaction
from inventory.models import Product, StockMovement
from core.currency import normalize_allocations, get_rate_to_base
from .models import Sale, SaleItem, TillSession


class SaleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = ["id", "product", "quantity", "unit_price", "subtotal"]
        extra_kwargs = {"subtotal": {"required": False}}


class SaleItemReadSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = SaleItem
        fields = ["id", "product", "product_name", "quantity", "unit_cost", "unit_price", "subtotal", "cost_total", "profit"]


class SaleSerializer(serializers.ModelSerializer):
    sale_items = SaleItemSerializer(many=True, write_only=True, required=False)
    line_items = SaleItemReadSerializer(source="sale_items", many=True, read_only=True)
    payment_currency = serializers.CharField(required=False)
    payment_allocations = serializers.JSONField(required=False)

    class Meta:
        model = Sale
        fields = [
            "id",
            "items",
            "total",
            "total_cost",
            "gross_profit",
            "payment_method",
            "payment_currency",
            "payment_allocations",
            "branch",
            "till_session",
            "receipt_number",
            "invoice_number",
            "customer",
            "created_by",
            "date",
            "time",
            "created_at",
            "updated_at",
            "sale_items",
            "line_items",
        ]
        read_only_fields = ["created_by", "date", "time", "created_at", "updated_at", "items", "total", "total_cost", "gross_profit", "receipt_number", "invoice_number"]

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        branch = attrs.get("branch")
        items = attrs.get("sale_items", [])
        payment_currency = (attrs.get("payment_currency") or getattr(self.instance, "payment_currency", getattr(user, "currency", "ZAR"))).strip().upper()
        attrs["payment_currency"] = payment_currency
        if user and user.is_authenticated:
            if branch and branch.user_id != user.id:
                raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
            till_session = attrs.get("till_session")
            if till_session and (till_session.is_deleted or till_session.status != "open"):
                raise serializers.ValidationError({"till_session": "Till session must be open."})
            if till_session and till_session.user_id != user.id:
                raise serializers.ValidationError({"till_session": "Till session does not belong to this account."})
            customer = attrs.get("customer")
            if customer and customer.user_id != user.id:
                raise serializers.ValidationError({"customer": "Customer does not belong to this account."})
            for item in items:
                product = item.get("product")
                if item.get("quantity", 0) <= 0:
                    raise serializers.ValidationError({"sale_items": "Quantities must be greater than zero."})
                if item.get("unit_price", 0) < 0:
                    raise serializers.ValidationError({"sale_items": "Selling prices cannot be negative."})
                if product and product.is_deleted:
                    raise serializers.ValidationError({"sale_items": "Product has been deleted."})
                if product and product.user_id != user.id:
                    raise serializers.ValidationError({"sale_items": f"{product.name} does not belong to this account."})
                if branch and product and product.branch_id and product.branch_id != branch.id:
                    raise serializers.ValidationError({"sale_items": f"{product.name} belongs to another branch."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("sale_items", [])
        payment_currency = validated_data.pop("payment_currency", "")
        submitted_allocations = validated_data.pop("payment_allocations", [])
        if not items:
            raise serializers.ValidationError({"sale_items": "Add at least one sale item."})
        sale = Sale.objects.create(**validated_data)
        total = 0
        total_cost = 0
        item_labels = []
        for item in items:
            product = Product.objects.select_for_update().get(pk=item["product"].pk)
            qty = item["quantity"]
            if product.stock < qty:
                raise serializers.ValidationError(f"Insufficient stock for {product.name}")
            unit_price = item["unit_price"]
            subtotal = unit_price * qty
            unit_cost = product.cost_price
            cost_total = unit_cost * qty
            profit = subtotal - cost_total
            
            # Create SaleItem without spreading item dict since it contains subtotal
            SaleItem.objects.create(
                sale=sale,
                product=product,
                quantity=qty,
                unit_cost=unit_cost,
                unit_price=unit_price,
                subtotal=subtotal,
                cost_total=cost_total,
                profit=profit,
            )
            
            product.stock -= qty
            product.save()
            StockMovement.objects.create(product=product, quantity=qty, movement_type="out", created_by=sale.created_by, reason=sale.receipt_number)
            total += subtotal
            total_cost += cost_total
            item_labels.append(f"{qty}x {product.name}")
        
        sale.total = total
        sale.total_cost = total_cost
        sale.gross_profit = total - total_cost
        sale.items = ", ".join(item_labels) if item_labels else ""
        rate = get_rate_to_base(sale.created_by, payment_currency or sale.created_by.currency) if not submitted_allocations else Decimal("1")
        allocations, allocations_total = normalize_allocations(
            sale.created_by,
            submitted_allocations,
            (Decimal(total) / rate).quantize(Decimal("0.01")),
            payment_currency or sale.created_by.currency,
            rate,
            field_name="payment_allocations",
        )
        total_amount = Decimal(str(total)).quantize(Decimal("0.01"))
        if allocations_total != total_amount:
            raise serializers.ValidationError({
                "payment_allocations": "Split payments must add up to the converted sale total."
            })
        sale.payment_allocations = allocations
        sale.payment_currency = allocations[0]["currency"] if len(allocations) == 1 else "MIXED"
        sale.save()
        
        customer = Customer.objects.select_for_update().get(pk=sale.customer_id) if sale.customer_id else None
        if customer:
            customer.last_visit = timezone.now()
            customer.visits += 1
            customer.total_spent += total
            points = int(total // 10)
            customer.loyalty_points += points
            customer.save()
            LoyaltyTransaction.objects.create(customer=customer, points_change=points, reason="Sale purchase")
        
        return sale


class TillSessionSerializer(serializers.ModelSerializer):
    sales_total = serializers.SerializerMethodField()
    cash_sales = serializers.SerializerMethodField()

    class Meta:
        model = TillSession
        fields = "__all__"
        read_only_fields = ["user", "expected_cash", "cash_variance", "card_total", "eft_total", "opened_at", "closed_at", "created_at", "updated_at"]

    def get_sales_total(self, obj):
        return sum(sale.total for sale in obj.sales.filter(is_deleted=False))

    def get_cash_sales(self, obj):
        return sum(sale.total for sale in obj.sales.filter(is_deleted=False, payment_method="Cash"))

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        branch = attrs.get("branch")
        if user and user.is_authenticated and branch and branch.user_id != user.id:
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        return attrs

    def close(self, instance, closing_cash, notes=""):
        closing_cash = Decimal(str(closing_cash or 0))
        cash_sales = sum(sale.total for sale in instance.sales.filter(is_deleted=False, payment_method="Cash"))
        instance.closing_cash = closing_cash
        instance.expected_cash = instance.opening_cash + cash_sales
        instance.cash_variance = closing_cash - instance.expected_cash
        instance.card_total = sum(sale.total for sale in instance.sales.filter(is_deleted=False, payment_method="Card"))
        instance.eft_total = sum(sale.total for sale in instance.sales.filter(is_deleted=False, payment_method="EFT"))
        instance.notes = notes
        instance.status = "closed"
        instance.closed_at = timezone.now()
        instance.save()
        return instance
