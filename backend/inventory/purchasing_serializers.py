from decimal import Decimal
from pathlib import Path

from django.contrib.auth import get_user_model
from django.core.validators import FileExtensionValidator
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers

from accounts.branch_access import get_staff_member, require_staff_branch
from accounts.approvals import require_approval_if_over_threshold
from core.currency import get_rate_to_base
from reports.models import BankAccount

from .models import (
    GoodsReceivedNote,
    GoodsReceivedNoteAttachment,
    GoodsReceivedNoteItem,
    Product,
    ProductBatch,
    PurchaseCostHistory,
    PurchaseOrder,
    PurchaseOrderEvent,
    PurchaseOrderItem,
    StockMovement,
    SupplierPayment,
    SupplierReturn,
    SupplierReturnItem,
)


CENT = Decimal("0.01")
MAX_MONEY = Decimal("9999999999.99")


class PurchaseOrderItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    sku = serializers.CharField(source="product.sku", read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = [
            "id", "purchase_order", "product", "product_name", "sku", "quantity_ordered",
            "quantity_received", "unit_cost", "unit_cost_base", "line_total", "line_total_base",
        ]
        read_only_fields = [
            "id", "purchase_order", "quantity_received", "unit_cost_base", "line_total",
            "line_total_base",
        ]
        extra_kwargs = {
            "quantity_ordered": {"min_value": 1},
            "unit_cost": {"min_value": Decimal("0")},
        }

    def validate_product(self, product):
        user = self.context["request"].user
        if product.user_id != user.id or product.is_deleted:
            raise serializers.ValidationError("Product does not belong to this account.")
        require_staff_branch(self.context["request"], product.branch_id)
        return product


class PurchaseOrderEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchaseOrderEvent
        fields = ["from_status", "to_status", "note", "created_by", "created_at"]
        read_only_fields = fields


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = PurchaseOrderItemSerializer(many=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
    events = PurchaseOrderEventSerializer(many=True, read_only=True)
    currency = serializers.CharField(required=False)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "supplier", "supplier_name", "branch", "branch_name", "order_number", "status",
            "currency", "fx_rate_to_base", "expected_date", "supplier_invoice_number", "invoice_date",
            "due_date", "notes", "discount_amount", "additional_charges", "total_cost",
            "total_cost_base", "submitted_at", "approved_at", "approved_by", "completed_at",
            "items", "events", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "order_number", "status", "total_cost", "total_cost_base", "submitted_at",
            "approved_at", "approved_by", "completed_at", "events", "created_at", "updated_at",
        ]

    def validate(self, attrs):
        request = self.context["request"]
        user = request.user
        supplier = attrs.get("supplier", getattr(self.instance, "supplier", None))
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        if supplier and (supplier.user_id != user.id or supplier.is_deleted):
            raise serializers.ValidationError({"supplier": "Supplier does not belong to this account."})
        if branch and (branch.user_id != user.id or branch.is_deleted):
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        staff = get_staff_member(self.context["request"])
        if staff:
            if not staff.branch_id:
                raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
            if branch is None:
                from .models import Branch
                branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                attrs["branch"] = branch
            require_staff_branch(self.context["request"], branch.id)

        items = attrs.get("items")
        if self.instance and items is None:
            items = list(self.instance.items.select_related("product").filter(is_deleted=False))
        if not items:
            raise serializers.ValidationError({"items": "Add at least one product to the purchase order."})
        for item in items:
            product = item.get("product") if isinstance(item, dict) else item.product
            if product.user_id != user.id or product.is_deleted:
                raise serializers.ValidationError({"items": f"{product.name} is not available in this account."})
            if branch and product.branch_id and product.branch_id != branch.id:
                raise serializers.ValidationError({"items": f"{product.name} belongs to a different branch."})
            require_staff_branch(self.context["request"], product.branch_id)

        discount = attrs.get("discount_amount", getattr(self.instance, "discount_amount", Decimal("0")))
        charges = attrs.get("additional_charges", getattr(self.instance, "additional_charges", Decimal("0")))
        if discount < 0:
            raise serializers.ValidationError({"discount_amount": "Discount cannot be negative."})
        if charges < 0:
            raise serializers.ValidationError({"additional_charges": "Additional charges cannot be negative."})

        currency = (attrs.get("currency") or getattr(self.instance, "currency", user.currency)).strip().upper()
        rate = get_rate_to_base(
            user,
            currency,
            attrs.get("fx_rate_to_base", getattr(self.instance, "fx_rate_to_base", None)),
        )
        attrs["currency"] = currency
        attrs["fx_rate_to_base"] = rate
        gross = sum(
            (item.get("unit_cost", Decimal("0")) * item.get("quantity_ordered", 0))
            if isinstance(item, dict)
            else item.unit_cost * item.quantity_ordered
            for item in items
        )
        if discount > gross:
            raise serializers.ValidationError({"discount_amount": "Discount cannot exceed the product subtotal."})
        if gross - discount + charges > MAX_MONEY:
            raise serializers.ValidationError({"additional_charges": "The purchase order total is too large to record."})
        invoice_date = attrs.get("invoice_date", getattr(self.instance, "invoice_date", None))
        due_date = attrs.get("due_date", getattr(self.instance, "due_date", None))
        if invoice_date and due_date and due_date < invoice_date:
            raise serializers.ValidationError({"due_date": "Due date must be on or after the invoice date."})
        return attrs

    @staticmethod
    def _save_items(order, items):
        gross = Decimal("0")
        for item in items:
            line_total = item["unit_cost"] * item["quantity_ordered"]
            line_total_base = (line_total * order.fx_rate_to_base).quantize(CENT)
            unit_cost_base = (item["unit_cost"] * order.fx_rate_to_base).quantize(CENT)
            PurchaseOrderItem.objects.create(
                purchase_order=order,
                line_total=line_total,
                line_total_base=line_total_base,
                unit_cost_base=unit_cost_base,
                **item,
            )
            gross += line_total
        order.total_cost = gross - order.discount_amount + order.additional_charges
        order.total_cost_base = (order.total_cost * order.fx_rate_to_base).quantize(CENT)
        order.save(update_fields=["total_cost", "total_cost_base", "updated_at"])

    @transaction.atomic
    def create(self, validated_data):
        items = validated_data.pop("items")
        order = PurchaseOrder.objects.create(**validated_data)
        self._save_items(order, items)
        PurchaseOrderEvent.objects.create(
            purchase_order=order,
            from_status="",
            to_status=PurchaseOrder.STATUS_DRAFT,
            created_by=self.context["request"].user,
        )
        return order

    @transaction.atomic
    def update(self, instance, validated_data):
        instance = PurchaseOrder.objects.select_for_update().get(pk=instance.pk, user=self.context["request"].user)
        if instance.status != PurchaseOrder.STATUS_DRAFT:
            raise serializers.ValidationError("Only draft purchase orders can be edited.")
        items = validated_data.pop("items", None)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        if items is not None:
            instance.items.filter(is_deleted=False).delete()
            self._save_items(instance, items)
        return instance


class GoodsReceivedNoteItemInputSerializer(serializers.Serializer):
    purchase_order_item = serializers.PrimaryKeyRelatedField(queryset=PurchaseOrderItem.objects.all())
    quantity_delivered = serializers.IntegerField(min_value=0)
    quantity_damaged = serializers.IntegerField(min_value=0, required=False, default=0)
    quantity_missing = serializers.IntegerField(min_value=0, required=False, default=0)
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"), required=False)
    batch_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    expiry_date = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        item = attrs["purchase_order_item"]
        order = self.context["purchase_order"]
        if item.purchase_order_id != order.id or item.is_deleted:
            raise serializers.ValidationError({"purchase_order_item": "Choose an item from this purchase order."})
        damaged = attrs["quantity_damaged"]
        delivered = attrs["quantity_delivered"]
        missing = attrs["quantity_missing"]
        if damaged > delivered:
            raise serializers.ValidationError({"quantity_damaged": "Damaged quantity cannot exceed delivered quantity."})
        if delivered == 0 and missing == 0:
            raise serializers.ValidationError("Record delivered, damaged, or missing units.")
        attrs["unit_cost"] = attrs.get("unit_cost", item.unit_cost)
        return attrs


class GoodsReceivedNoteItemSerializer(serializers.ModelSerializer):
    product = serializers.IntegerField(source="purchase_order_item.product_id", read_only=True)
    product_name = serializers.CharField(source="purchase_order_item.product.name", read_only=True)
    sku = serializers.CharField(source="purchase_order_item.product.sku", read_only=True)
    quantity_accepted = serializers.IntegerField(read_only=True)

    class Meta:
        model = GoodsReceivedNoteItem
        fields = [
            "id", "purchase_order_item", "product", "product_name", "sku", "quantity_delivered",
            "quantity_damaged", "quantity_missing", "quantity_accepted", "unit_cost", "unit_cost_base",
            "discount_amount_base", "additional_charges_base", "total_cost_base", "batch_number",
            "expiry_date", "batch", "stock_movement",
        ]
        read_only_fields = fields


class GoodsReceivedNoteAttachmentSerializer(serializers.ModelSerializer):
    file = serializers.FileField(
        validators=[FileExtensionValidator(allowed_extensions=["pdf", "jpg", "jpeg", "png"])]
    )

    class Meta:
        model = GoodsReceivedNoteAttachment
        fields = ["id", "file", "file_name", "created_at"]
        read_only_fields = ["id", "file_name", "created_at"]

    def validate_file(self, file):
        if file.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("Delivery documents must be 10 MB or smaller.")
        extension = Path(file.name).suffix.lower()
        try:
            if extension == ".pdf":
                file.seek(0)
                valid = file.read(5) == b"%PDF-"
            else:
                from PIL import Image

                file.seek(0)
                image = Image.open(file)
                valid = (extension in {".jpg", ".jpeg"} and image.format == "JPEG") or (
                    extension == ".png" and image.format == "PNG"
                )
                image.verify()
            file.seek(0)
        except Exception as exc:
            file.seek(0)
            raise serializers.ValidationError("Upload a valid PDF, JPG, or PNG document.") from exc
        if not valid:
            raise serializers.ValidationError("The file contents do not match its PDF, JPG, or PNG extension.")
        return file

    def create(self, validated_data):
        request = self.context["request"]
        note = self.context["goods_received_note"]
        return GoodsReceivedNoteAttachment.objects.create(
            goods_received_note=note,
            uploaded_by=request.user,
            file_name=Path(validated_data["file"].name).name[:255],
            **validated_data,
        )


class GoodsReceivedNoteSerializer(serializers.ModelSerializer):
    purchase_order_number = serializers.CharField(source="purchase_order.order_number", read_only=True)
    items = GoodsReceivedNoteItemSerializer(many=True, read_only=True)
    attachments = GoodsReceivedNoteAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = GoodsReceivedNote
        fields = [
            "id", "purchase_order", "purchase_order_number", "grn_number", "status", "delivery_date",
            "notes", "items", "attachments", "confirmed_at", "confirmed_by", "created_at",
        ]
        read_only_fields = fields


class GoodsReceivedNoteCreateSerializer(serializers.Serializer):
    delivery_date = serializers.DateField(required=False)
    notes = serializers.CharField(required=False, allow_blank=True)
    idempotency_key = serializers.CharField(required=False, allow_blank=True, max_length=120)
    items = GoodsReceivedNoteItemInputSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        order = self.context["purchase_order"]
        key = attrs.get("idempotency_key", "")
        existing = GoodsReceivedNote.objects.filter(
            user=self.context["request"].user, idempotency_key=key
        ).first() if key else None
        if existing:
            current_items = list(existing.items.order_by("purchase_order_item_id", "id").values_list(
                "purchase_order_item_id", "quantity_delivered", "quantity_damaged", "quantity_missing",
                "unit_cost", "batch_number", "expiry_date",
            ))
            requested_items = sorted(
                (
                    row["purchase_order_item"].pk,
                    row["quantity_delivered"],
                    row["quantity_damaged"],
                    row["quantity_missing"],
                    row["unit_cost"],
                    row.get("batch_number", ""),
                    row.get("expiry_date"),
                )
                for row in attrs["items"]
            )
            if (
                existing.purchase_order_id == order.id
                and current_items == requested_items
                and ("delivery_date" not in attrs or existing.delivery_date == attrs["delivery_date"])
                and existing.notes == attrs.get("notes", "")
            ):
                attrs["_existing_note"] = existing
                return attrs
            raise serializers.ValidationError({"idempotency_key": "This key was already used for a different receipt."})
        if order.status not in {PurchaseOrder.STATUS_APPROVED, PurchaseOrder.STATUS_PARTIALLY_RECEIVED}:
            raise serializers.ValidationError("Only approved or partially received purchase orders can receive goods.")
        quantities = {}
        for row in attrs["items"]:
            item = row["purchase_order_item"]
            quantities[item.pk] = quantities.get(item.pk, 0) + row["quantity_delivered"]
        for item_id, new_quantity in quantities.items():
            item = next(row["purchase_order_item"] for row in attrs["items"] if row["purchase_order_item"].pk == item_id)
            remaining = item.quantity_ordered - item.quantity_received
            if new_quantity > remaining:
                raise serializers.ValidationError({
                    "items": f"Receipt quantity exceeds the {remaining} remaining unit(s) for {item.product.name}."
                })
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        request = self.context["request"]
        existing = validated_data.pop("_existing_note", None)
        if existing:
            return existing
        order = PurchaseOrder.objects.select_for_update().get(pk=self.context["purchase_order"].pk, user=request.user)
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        key = validated_data.get("idempotency_key", "")
        if key:
            existing = GoodsReceivedNote.objects.filter(user=request.user, idempotency_key=key).first()
            if existing:
                existing_items = list(existing.items.order_by("purchase_order_item_id", "id").values_list(
                    "purchase_order_item_id", "quantity_delivered", "quantity_damaged", "quantity_missing",
                    "unit_cost", "batch_number", "expiry_date",
                ))
                requested_items = sorted(
                    (
                        row["purchase_order_item"].pk,
                        row["quantity_delivered"],
                        row["quantity_damaged"],
                        row["quantity_missing"],
                        row["unit_cost"],
                        row.get("batch_number", ""),
                        row.get("expiry_date"),
                    )
                    for row in validated_data["items"]
                )
                if (
                    existing.purchase_order_id == order.id
                    and existing_items == requested_items
                    and (
                        "delivery_date" not in validated_data
                        or existing.delivery_date == validated_data["delivery_date"]
                    )
                    and existing.notes == validated_data.get("notes", "")
                ):
                    return existing
                raise serializers.ValidationError({"idempotency_key": "This key was already used for a different receipt."})
        note = GoodsReceivedNote.objects.create(
            user=request.user,
            purchase_order=order,
            delivery_date=validated_data.get("delivery_date") or timezone.localdate(),
            notes=validated_data.get("notes", ""),
            idempotency_key=key,
        )
        for row in validated_data["items"]:
            GoodsReceivedNoteItem.objects.create(goods_received_note=note, **row)
        return note


class SupplierReturnItemInputSerializer(serializers.Serializer):
    goods_received_note_item = serializers.PrimaryKeyRelatedField(queryset=GoodsReceivedNoteItem.objects.all())
    quantity = serializers.IntegerField(min_value=0, required=False, default=0)
    quantity_damaged = serializers.IntegerField(min_value=0, required=False, default=0)

    def validate(self, attrs):
        if attrs["quantity"] == 0 and attrs["quantity_damaged"] == 0:
            raise serializers.ValidationError("Return at least one accepted or damaged unit.")
        return attrs


class SupplierReturnItemSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="goods_received_note_item.purchase_order_item.product.name", read_only=True)
    sku = serializers.CharField(source="goods_received_note_item.purchase_order_item.product.sku", read_only=True)
    grn_number = serializers.CharField(source="goods_received_note_item.goods_received_note.grn_number", read_only=True)

    class Meta:
        model = SupplierReturnItem
        fields = [
            "id", "goods_received_note_item", "grn_number", "product_name", "sku",
            "quantity", "quantity_damaged", "unit_cost_base", "total_amount_base", "stock_movement",
        ]
        read_only_fields = fields


class SupplierReturnSerializer(serializers.ModelSerializer):
    items = SupplierReturnItemSerializer(many=True, read_only=True)

    class Meta:
        model = SupplierReturn
        fields = [
            "id", "supplier", "purchase_order", "reason", "return_date", "reference",
            "idempotency_key", "notes", "total_amount_base", "created_by", "items", "created_at",
        ]
        read_only_fields = fields


class SupplierReturnCreateSerializer(serializers.Serializer):
    purchase_order = serializers.PrimaryKeyRelatedField(queryset=PurchaseOrder.objects.all())
    reason = serializers.ChoiceField(choices=SupplierReturn.REASON_CHOICES)
    return_date = serializers.DateField(required=False)
    reference = serializers.CharField(required=False, allow_blank=True, max_length=120)
    idempotency_key = serializers.CharField(required=False, allow_blank=True, max_length=120)
    notes = serializers.CharField(required=False, allow_blank=True)
    items = SupplierReturnItemInputSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        user = self.context["request"].user
        order = attrs["purchase_order"]
        if order.user_id != user.id or order.is_deleted:
            raise serializers.ValidationError({"purchase_order": "Purchase order does not belong to this account."})
        require_staff_branch(self.context["request"], order.branch_id)
        key = attrs.get("idempotency_key", "")
        existing = SupplierReturn.objects.filter(user=user, idempotency_key=key).first() if key else None
        if existing:
            existing_items = list(existing.items.order_by("goods_received_note_item_id").values_list(
                "goods_received_note_item_id", "quantity", "quantity_damaged"
            ))
            requested_items = sorted(
                (
                    row["goods_received_note_item"].pk,
                    row["quantity"],
                    row["quantity_damaged"],
                )
                for row in attrs["items"]
            )
            if (
                existing.purchase_order_id == order.id
                and existing.reason == attrs["reason"]
                and existing_items == requested_items
                and ("return_date" not in attrs or existing.return_date == attrs["return_date"])
                and existing.reference == attrs.get("reference", "")
                and existing.notes == attrs.get("notes", "")
            ):
                attrs["_existing_return"] = existing
                return attrs
            raise serializers.ValidationError({"idempotency_key": "This key was already used for a different return."})
        note_items = [row["goods_received_note_item"] for row in attrs["items"]]
        for note_item in note_items:
            if note_item.goods_received_note.purchase_order_id != order.id:
                raise serializers.ValidationError({"items": "Returned goods must belong to the selected purchase order."})
            if note_item.is_deleted:
                raise serializers.ValidationError({"items": "Deleted receipt lines cannot be returned."})
            if note_item.goods_received_note.status != GoodsReceivedNote.STATUS_CONFIRMED:
                raise serializers.ValidationError({"items": "Only confirmed receipts can be returned."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        request = self.context["request"]
        existing = validated_data.pop("_existing_return", None)
        if existing:
            return existing
        order = PurchaseOrder.objects.select_for_update().get(pk=validated_data["purchase_order"].pk, user=request.user)
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        key = validated_data.get("idempotency_key", "")
        existing = SupplierReturn.objects.filter(user=request.user, idempotency_key=key).first() if key else None
        if existing:
            existing_items = list(existing.items.order_by("goods_received_note_item_id").values_list(
                "goods_received_note_item_id", "quantity", "quantity_damaged"
            ))
            requested_items = sorted(
                (
                    row["goods_received_note_item"].pk,
                    row["quantity"],
                    row["quantity_damaged"],
                )
                for row in validated_data["items"]
            )
            if (
                existing.purchase_order_id == order.id
                and existing.reason == validated_data["reason"]
                and existing_items == requested_items
                and (
                    "return_date" not in validated_data
                    or existing.return_date == validated_data["return_date"]
                )
                and existing.reference == validated_data.get("reference", "")
                and existing.notes == validated_data.get("notes", "")
            ):
                return existing
            raise serializers.ValidationError({"idempotency_key": "This key was already used for a different return."})
        return_record = SupplierReturn.objects.create(
            user=request.user,
            supplier=order.supplier,
            purchase_order=order,
            reason=validated_data["reason"],
            return_date=validated_data.get("return_date") or timezone.localdate(),
            reference=validated_data.get("reference", ""),
            idempotency_key=validated_data.get("idempotency_key", ""),
            notes=validated_data.get("notes", ""),
            created_by=request.user,
        )
        total_amount = Decimal("0")
        for row in validated_data["items"]:
            receipt_item = GoodsReceivedNoteItem.objects.select_for_update().select_related(
                "goods_received_note", "purchase_order_item__product", "batch"
            ).get(pk=row["goods_received_note_item"].pk)
            if receipt_item.goods_received_note.status != GoodsReceivedNote.STATUS_CONFIRMED:
                raise serializers.ValidationError({"items": "Only confirmed receipts can be returned."})
            previously_returned = receipt_item.supplier_return_items.filter(is_deleted=False).aggregate(
                quantity=Sum("quantity"),
                quantity_damaged=Sum("quantity_damaged"),
                amount=Sum("total_amount_base"),
            )
            remaining_accepted = receipt_item.quantity_accepted - (previously_returned["quantity"] or 0)
            remaining_damaged = receipt_item.quantity_damaged - (previously_returned["quantity_damaged"] or 0)
            accepted_quantity = row["quantity"]
            damaged_quantity = row["quantity_damaged"]
            if accepted_quantity > remaining_accepted:
                raise serializers.ValidationError({
                    "items": f"Only {remaining_accepted} accepted unit(s) from this receipt remain eligible for return."
                })
            batch = None
            product = None
            movement = None
            if accepted_quantity:
                product = Product.objects.select_for_update().get(
                    pk=receipt_item.purchase_order_item.product_id, user=request.user, is_deleted=False
                )
                if receipt_item.batch_id:
                    batch = ProductBatch.objects.select_for_update().get(pk=receipt_item.batch_id, is_deleted=False)
                    if batch.quantity_remaining < accepted_quantity:
                        raise serializers.ValidationError({"items": f"Only {batch.quantity_remaining} unit(s) remain in the received batch."})
                else:
                    tracked = ProductBatch.objects.filter(product=product, is_deleted=False).aggregate(
                        total=Sum("quantity_remaining")
                    )["total"] or 0
                    untracked = product.stock - tracked
                    if untracked < accepted_quantity:
                        raise serializers.ValidationError({"items": f"Only {untracked} untracked unit(s) are available to return."})
                if product.stock < accepted_quantity:
                    raise serializers.ValidationError({"items": f"Only {product.stock} unit(s) are currently in stock."})
            if damaged_quantity > remaining_damaged:
                raise serializers.ValidationError({
                    "items": f"Only {remaining_damaged} damaged unit(s) from this receipt remain eligible for return."
                })

            accepted = receipt_item.quantity_accepted
            remaining_amount = receipt_item.total_cost_base - (previously_returned["amount"] or Decimal("0"))
            amount = (
                remaining_amount
                if accepted_quantity == remaining_accepted and accepted_quantity
                else (receipt_item.total_cost_base * accepted_quantity / accepted).quantize(CENT)
                if accepted_quantity and accepted
                else Decimal("0")
            ).quantize(CENT)
            if accepted_quantity and product:
                if batch:
                    batch.quantity_remaining -= accepted_quantity
                    batch.save(update_fields=["quantity_remaining", "updated_at"])
                product.stock -= accepted_quantity
                product.save(update_fields=["stock", "status", "updated_at"])
                movement = StockMovement.objects.create(
                    product=product,
                    batch=batch,
                    quantity=accepted_quantity,
                    movement_type="out",
                    reason=f"Supplier return {return_record.pk}",
                    created_by=request.user,
                )
            SupplierReturnItem.objects.create(
                supplier_return=return_record,
                goods_received_note_item=receipt_item,
                quantity=accepted_quantity,
                quantity_damaged=damaged_quantity,
                unit_cost_base=(amount / accepted_quantity).quantize(CENT) if accepted_quantity else Decimal("0"),
                total_amount_base=amount,
                stock_movement=movement,
            )
            total_amount += amount
        return_record.total_amount_base = total_amount
        return_record.save(update_fields=["total_amount_base", "updated_at"])
        return return_record


class PurchaseCostHistorySerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    order_number = serializers.CharField(source="purchase_order.order_number", read_only=True)
    grn_number = serializers.CharField(source="goods_received_note_item.goods_received_note.grn_number", read_only=True)

    class Meta:
        model = PurchaseCostHistory
        fields = [
            "id", "supplier_name", "product_name", "order_number", "grn_number", "quantity",
            "unit_cost", "currency", "fx_rate_to_base", "unit_cost_base", "created_at",
        ]
        read_only_fields = fields


class SupplierPaymentSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)
    order_number = serializers.CharField(source="purchase_order.order_number", read_only=True)
    financial_account = serializers.PrimaryKeyRelatedField(
        queryset=BankAccount.objects.all(), required=False, allow_null=True
    )

    class Meta:
        model = SupplierPayment
        fields = "__all__"
        read_only_fields = ["user", "created_by", "fx_rate_to_base", "amount_base", "created_at", "updated_at"]
        extra_kwargs = {
            "amount": {"min_value": Decimal("0.01")},
            "idempotency_key": {"required": True},
        }

    def validate(self, attrs):
        user = self.context["request"].user
        supplier = attrs.get("supplier", getattr(self.instance, "supplier", None))
        order = attrs.get("purchase_order", getattr(self.instance, "purchase_order", None))
        idempotency_key = attrs.get("idempotency_key", "").strip()
        if len(idempotency_key) > 120:
            raise serializers.ValidationError({"idempotency_key": "Ensure this field has no more than 120 characters."})
        if not supplier or supplier.user_id != user.id:
            raise serializers.ValidationError({"supplier": "Supplier does not belong to this account."})
        if not order or order.user_id != user.id or order.supplier_id != supplier.id:
            raise serializers.ValidationError({"purchase_order": "Choose a purchase order for this supplier."})
        require_staff_branch(self.context["request"], order.branch_id)
        if order.status not in {
            PurchaseOrder.STATUS_PARTIALLY_RECEIVED,
            PurchaseOrder.STATUS_FULLY_RECEIVED,
            PurchaseOrder.STATUS_COMPLETED,
        }:
            raise serializers.ValidationError({"purchase_order": "Only received purchase orders can be paid."})
        currency = (attrs.get("currency") or user.currency).strip().upper()
        fx_rate = get_rate_to_base(user, currency, attrs.get("fx_rate_to_base"))
        amount_base = (attrs["amount"] * fx_rate).quantize(CENT)
        attrs["currency"] = currency
        attrs["fx_rate_to_base"] = fx_rate
        attrs["amount_base"] = amount_base
        if self.instance is None and not SupplierPayment.objects.filter(
            user=user, idempotency_key=idempotency_key,
        ).exists():
            require_approval_if_over_threshold(
                self.context["request"],
                "supplier_payment_amount_base_threshold",
                amount_base,
                "suppliers.pay",
            )
        account = attrs.get("financial_account", getattr(self.instance, "financial_account", None))
        if account:
            if account.user_id != user.id or account.is_deleted or not account.is_active:
                raise serializers.ValidationError({"financial_account": "Choose an active financial account owned by this business."})
            if account.currency.upper() != currency:
                raise serializers.ValidationError({"financial_account": "Payment currency must match the selected financial account."})
            payment_date = attrs.get("payment_date", getattr(self.instance, "payment_date", None))
            if payment_date and payment_date < account.opening_date:
                raise serializers.ValidationError({"financial_account": "Payment date is before the account opening date."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        request = self.context["request"]
        user = request.user
        order = PurchaseOrder.objects.select_for_update().get(
            pk=validated_data["purchase_order"].pk,
            user=user,
            supplier=validated_data["supplier"],
        )
        user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
        key = validated_data.get("idempotency_key", "")
        if key:
            existing = SupplierPayment.objects.filter(user=user, idempotency_key=key).first()
            if existing:
                financial_account = validated_data.get("financial_account")
                matches = (
                    existing.supplier_id == validated_data["supplier"].pk
                    and existing.purchase_order_id == validated_data["purchase_order"].pk
                    and existing.amount == validated_data["amount"]
                    and existing.currency == validated_data["currency"]
                    and existing.payment_date == validated_data["payment_date"]
                    and existing.method == validated_data.get("method", "cash")
                    and existing.reference == validated_data.get("reference", "")
                    and existing.notes == validated_data.get("notes", "")
                    and existing.financial_account_id == getattr(financial_account, "pk", None)
                )
                if matches:
                    return existing
                raise serializers.ValidationError({"idempotency_key": "This key was already used for a different supplier payment."})
        from .supplier_financial_services import get_purchase_order_received_totals_base

        receipt_total = get_purchase_order_received_totals_base(order)["received_total_base"]
        returned_total = SupplierReturnItem.objects.filter(
            supplier_return__purchase_order=order, is_deleted=False
        ).aggregate(total=Sum("total_amount_base"))["total"] or Decimal("0")
        paid_total = order.payments.filter(is_deleted=False).aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
        outstanding = receipt_total - returned_total - paid_total
        if validated_data["amount_base"] > outstanding:
            raise serializers.ValidationError({
                "amount": f"Payment exceeds the outstanding supplier balance of {outstanding:.2f} {request.user.currency}."
            })
        payment = SupplierPayment.objects.create(
            user=user,
            created_by=user,
            **validated_data,
        )
        if payment.financial_account_id:
            from reports.financial_services import post_allocations_to_accounts

            post_allocations_to_accounts(
                user=user,
                allocations=[{
                    "account": payment.financial_account_id,
                    "currency": payment.currency,
                    "amount": str(payment.amount),
                    "fx_rate_to_base": str(payment.fx_rate_to_base),
                    "amount_base": str(payment.amount_base),
                }],
                direction="out",
                entry_type="supplier_payment",
                transaction_date=payment.payment_date,
                description=f"Supplier payment to {payment.supplier.name}",
                source_key=f"supplier-payment:{payment.pk}:payment",
                created_by=user,
                reference=payment.reference,
            )
        return payment
