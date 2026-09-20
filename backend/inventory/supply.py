from decimal import Decimal
from uuid import uuid4
from django.db import transaction
from django.contrib.auth import get_user_model
from rest_framework import serializers, viewsets, mixins
from rest_framework.permissions import IsAuthenticated
from core.currency import get_rate_to_base
from .models import SupplyEntry, Product, StockMovement


class SupplyEntrySerializer(serializers.ModelSerializer):
    id = serializers.CharField(read_only=True)
    requestId = serializers.CharField(source="request_id", max_length=100)
    productId = serializers.PrimaryKeyRelatedField(source="product", queryset=Product.objects.filter(is_deleted=False))
    productName = serializers.CharField(source="product.name", read_only=True)
    paymentStatus = serializers.ChoiceField(source="payment_status", choices=["pending", "partial", "paid"])
    partnerName = serializers.CharField(source="partner_name", max_length=255)
    partnerCategory = serializers.ChoiceField(source="partner_category", choices=["supplier", "customer", "shop", "company", "other"])
    unitPrice = serializers.DecimalField(source="unit_price", max_digits=12, decimal_places=2, min_value=0, coerce_to_string=False)
    unitCost = serializers.DecimalField(source="unit_cost", max_digits=12, decimal_places=2, min_value=0, coerce_to_string=False)
    fxRateToBase = serializers.DecimalField(source="fx_rate_to_base", max_digits=18, decimal_places=6, required=False, coerce_to_string=False)
    movementDate = serializers.DateField(source="movement_date")
    movementTime = serializers.TimeField(source="movement_time")
    recordedAt = serializers.DateTimeField(source="created_at", read_only=True)
    invoiceNumber = serializers.CharField(source="invoice_number", read_only=True)
    quantity = serializers.IntegerField(min_value=1)

    class Meta:
        model = SupplyEntry
        fields = ["id", "requestId", "productId", "productName", "direction", "paymentStatus", "partnerName", "partnerCategory", "quantity", "unitPrice", "unitCost", "currency", "fxRateToBase", "movementDate", "movementTime", "recordedAt", "invoiceNumber", "notes"]
        validators = []

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["productId"] = str(data["productId"])
        return data

    def validate(self, attrs):
        user = self.context["request"].user
        if self.instance:
            if set(attrs) - {"payment_status", "notes"}:
                raise serializers.ValidationError("Only payment status and notes can be edited after stock is recorded.")
            return attrs
        if attrs["product"].user_id != user.id:
            raise serializers.ValidationError({"productId": "Product does not belong to this account."})
        attrs["currency"] = attrs["currency"].upper()
        attrs["fx_rate_to_base"] = get_rate_to_base(user, attrs["currency"], attrs.get("fx_rate_to_base"))
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = validated_data.pop("user", self.context["request"].user)
        # Serialize retries for this account so a lost response cannot apply stock twice.
        get_user_model().objects.select_for_update().get(pk=user.pk)
        existing = SupplyEntry.objects.filter(user=user, request_id=validated_data["request_id"]).first()
        if existing:
            return existing
        product = Product.objects.select_for_update().get(pk=validated_data["product"].pk, user=user, is_deleted=False)
        quantity = validated_data["quantity"]
        incoming = validated_data["direction"] == "incoming"
        if not incoming and product.stock < quantity:
            raise serializers.ValidationError({"quantity": "Insufficient stock."})
        product.stock += quantity if incoming else -quantity
        if incoming:
            product.cost_price = (validated_data["unit_cost"] * validated_data["fx_rate_to_base"]).quantize(Decimal("0.01"))
            product.cost_currency = validated_data["currency"]
            product.cost_fx_rate_to_base = validated_data["fx_rate_to_base"]
        product.save()
        entry = SupplyEntry.objects.create(user=user, invoice_number=f"SUP-{uuid4().hex[:16].upper()}", **validated_data)
        StockMovement.objects.create(product=product, quantity=quantity, movement_type="in" if incoming else "out", created_by=user, reason=entry.invoice_number)
        return entry


class SupplyEntryViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SupplyEntrySerializer
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return SupplyEntry.objects.filter(user=self.request.user, is_deleted=False).select_related("product")
