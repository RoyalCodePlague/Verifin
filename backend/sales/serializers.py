from django.db import transaction
from rest_framework import serializers
from customers.models import Customer, LoyaltyTransaction
from inventory.models import Product
from .models import Sale, SaleItem


class SaleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = ["id", "product", "quantity", "unit_price", "subtotal"]


class SaleItemReadSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)

    class Meta:
        model = SaleItem
        fields = ["id", "product", "product_name", "quantity", "unit_price", "subtotal"]


class SaleSerializer(serializers.ModelSerializer):
    sale_items = SaleItemSerializer(many=True, write_only=True, required=False)
    line_items = SaleItemReadSerializer(source="sale_items", many=True, read_only=True)

    class Meta:
        model = Sale
        fields = [
            "id",
            "items",
            "total",
            "payment_method",
            "customer",
            "created_by",
            "date",
            "time",
            "created_at",
            "updated_at",
            "sale_items",
            "line_items",
        ]
        read_only_fields = ["created_by", "date", "time", "created_at", "updated_at", "items", "total"]

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("sale_items", [])
        sale = Sale.objects.create(**validated_data)
        total = 0
        item_labels = []
        for item in items:
            product = item["product"]
            qty = item["quantity"]
            if product.stock < qty:
                raise serializers.ValidationError(f"Insufficient stock for {product.name}")
            unit_price = item["unit_price"]
            subtotal = item.get("subtotal") or (unit_price * qty)
            
            # Create SaleItem without spreading item dict since it contains subtotal
            SaleItem.objects.create(
                sale=sale,
                product=product,
                quantity=qty,
                unit_price=unit_price,
                subtotal=subtotal
            )
            
            product.stock -= qty
            product.save()
            total += subtotal
            item_labels.append(f"{qty}x {product.name}")
        
        sale.total = total
        sale.items = ", ".join(item_labels) if item_labels else ""
        sale.save()
        
        customer = sale.customer
        if customer:
            customer.visits += 1
            customer.total_spent += total
            points = int(total // 10)
            customer.loyalty_points += points
            customer.save()
            LoyaltyTransaction.objects.create(customer=customer, points_change=points, reason="Sale purchase")
        
        return sale
