from decimal import Decimal
from rest_framework import serializers
from .models import Branch, Category, Product, StockMovement, StockTransfer


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


class ProductSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
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
