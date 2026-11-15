from decimal import Decimal

from django.db import models, transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.activity import log_staff_activity
from accounts.approvals import require_approval_if_over_threshold
from accounts.branch_access import get_staff_member, require_staff_operation, scope_queryset_to_staff_branch

from .models import (
    GoodsReceivedNote,
    GoodsReceivedNoteItem,
    Product,
    ProductBatch,
    PurchaseCostHistory,
    PurchaseOrder,
    PurchaseOrderEvent,
    PurchaseOrderItem,
    StockMovement,
    Supplier,
    SupplierPayment,
    SupplierReturn,
    SupplierReturnItem,
)
from .purchasing_serializers import (
    GoodsReceivedNoteAttachmentSerializer,
    GoodsReceivedNoteCreateSerializer,
    GoodsReceivedNoteSerializer,
    PurchaseCostHistorySerializer,
    PurchaseOrderSerializer,
    SupplierPaymentSerializer,
    SupplierReturnCreateSerializer,
    SupplierReturnSerializer,
)
from .supplier_financial_services import get_purchase_order_received_totals_base
from .serializers import ProductSerializer, SupplierSerializer


CENT = Decimal("0.01")


def _record_order_transition(order, new_status, request, note=""):
    old_status = order.status
    order.status = new_status
    order.save()
    PurchaseOrderEvent.objects.create(
        purchase_order=order,
        from_status=old_status,
        to_status=new_status,
        note=note,
        created_by=request.user,
    )
    log_staff_activity(
        request.user,
        f"purchase_order_{new_status}",
        f"Purchase order {order.order_number} moved to {new_status}",
        actor=request.user,
        request=request,
        object_type="purchase_order",
        object_id=order.id,
        metadata={"before": {"status": old_status}, "after": {"status": new_status}, "note": note},
    )


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "head", "options"]
    filterset_fields = ["status", "supplier", "branch"]
    search_fields = ["order_number", "supplier__name", "supplier_invoice_number"]

    def get_queryset(self):
        queryset = PurchaseOrder.objects.filter(user=self.request.user, is_deleted=False).select_related(
            "supplier", "branch", "approved_by"
        ).prefetch_related("items__product", "events", "goods_received_notes")
        return scope_queryset_to_staff_branch(self.request, queryset)

    def perform_create(self, serializer):
        order = serializer.save(user=self.request.user)
        log_staff_activity(
            self.request.user,
            "purchase_order_created",
            f"Created draft purchase order {order.order_number}",
            actor=self.request.user,
            request=self.request,
            object_type="purchase_order",
            object_id=order.id,
            metadata={"after": {"status": order.status, "branch_id": order.branch_id,
                                "supplier_id": order.supplier_id, "total_cost_base": str(order.total_cost_base)}},
        )

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def submit(self, request, pk=None):
        order = PurchaseOrder.objects.select_for_update().get(
            pk=self.get_object().pk, user=request.user, is_deleted=False
        )
        if order.status != PurchaseOrder.STATUS_DRAFT:
            raise ValidationError("Only draft purchase orders can be submitted.")
        if not order.items.filter(is_deleted=False).exists():
            raise ValidationError({"items": "Add at least one product before submitting."})
        order.submitted_at = timezone.now()
        order.save(update_fields=["submitted_at", "updated_at"])
        _record_order_transition(order, PurchaseOrder.STATUS_SUBMITTED, request)
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def approve(self, request, pk=None):
        order = PurchaseOrder.objects.select_for_update().get(
            pk=self.get_object().pk, user=request.user, is_deleted=False
        )
        if order.status != PurchaseOrder.STATUS_SUBMITTED:
            raise ValidationError("Only submitted purchase orders can be approved.")
        require_approval_if_over_threshold(
            request, "purchase_order_amount_base_threshold", order.total_cost_base, "purchasing.approve"
        )
        order.approved_at = timezone.now()
        order.approved_by = request.user
        order.save(update_fields=["approved_at", "approved_by", "updated_at"])
        _record_order_transition(order, PurchaseOrder.STATUS_APPROVED, request)
        from reports.automation_engine import queue_automation_event
        queue_automation_event(
            request.user, "purchase_order_approved", f"purchase-order:{order.pk}:approved", "purchase_order", order.pk,
            {"total_amount_base": str(order.total_cost_base)},
        )
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def cancel(self, request, pk=None):
        order = PurchaseOrder.objects.select_for_update().get(
            pk=self.get_object().pk, user=request.user, is_deleted=False
        )
        if order.status not in {
            PurchaseOrder.STATUS_DRAFT,
            PurchaseOrder.STATUS_SUBMITTED,
            PurchaseOrder.STATUS_APPROVED,
            PurchaseOrder.STATUS_PARTIALLY_RECEIVED,
        }:
            raise ValidationError("This purchase order can no longer be cancelled.")
        _record_order_transition(order, PurchaseOrder.STATUS_CANCELLED, request, str(request.data.get("note", ""))[:255])
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def complete(self, request, pk=None):
        order = PurchaseOrder.objects.select_for_update().get(
            pk=self.get_object().pk, user=request.user, is_deleted=False
        )
        if order.status != PurchaseOrder.STATUS_FULLY_RECEIVED:
            raise ValidationError("Only fully received purchase orders can be completed.")
        order.completed_at = timezone.now()
        order.save(update_fields=["completed_at", "updated_at"])
        _record_order_transition(order, PurchaseOrder.STATUS_COMPLETED, request)
        return Response(self.get_serializer(order).data)

    @action(detail=True, methods=["get", "post"], url_path="goods-received-notes")
    def goods_received_notes(self, request, pk=None):
        order = self.get_object()
        if request.method == "GET":
            notes = order.goods_received_notes.filter(is_deleted=False).prefetch_related("items", "attachments")
            return Response(GoodsReceivedNoteSerializer(notes, many=True, context={"request": request}).data)
        serializer = GoodsReceivedNoteCreateSerializer(
            data=request.data,
            context={"request": request, "purchase_order": order},
        )
        serializer.is_valid(raise_exception=True)
        note = serializer.save()
        return Response(
            GoodsReceivedNoteSerializer(note, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"], url_path="receive")
    @transaction.atomic
    def receive(self, request, pk=None):
        order = self.get_object()
        if order.status == "ordered":
            locked_order = PurchaseOrder.objects.select_for_update().get(pk=order.pk, user=request.user)
            _record_order_transition(
                locked_order,
                PurchaseOrder.STATUS_APPROVED,
                request,
                "Existing sent order approved for receipt through the legacy endpoint.",
            )
            order.refresh_from_db()
        batch_details = request.data.get("batches", {})
        if not isinstance(batch_details, dict):
            raise ValidationError({"batches": "Expected a mapping of order item IDs to batch details."})
        receipt_items = []
        for item in order.items.filter(is_deleted=False):
            remaining = item.quantity_ordered - item.quantity_received
            raw_quantity = request.data.get(str(item.pk), remaining)
            try:
                quantity = int(raw_quantity)
            except (TypeError, ValueError):
                raise ValidationError({str(item.pk): "Enter a whole number for the received quantity."})
            if quantity < 0 or quantity > remaining:
                raise ValidationError({str(item.pk): f"Enter a quantity from 0 to {remaining}."})
            if quantity == 0:
                continue
            details = batch_details.get(str(item.pk), {})
            if not isinstance(details, dict):
                raise ValidationError({"batches": f"Invalid batch details for {item.product.name}."})
            receipt_items.append({
                "purchase_order_item": item.pk,
                "quantity_delivered": quantity,
                "unit_cost": str(item.unit_cost),
                "batch_number": details.get("batch_number", ""),
                "expiry_date": details.get("expiry_date") or None,
            })
        serializer = GoodsReceivedNoteCreateSerializer(
            data={"items": receipt_items},
            context={"request": request, "purchase_order": order},
        )
        serializer.is_valid(raise_exception=True)
        note = serializer.save()
        note_view = GoodsReceivedNoteViewSet()
        note_view.request = request
        note_view.format_kwarg = None
        return note_view.confirm(request, pk=note.pk)

    @action(detail=False, methods=["get"], url_path="suggestions")
    def suggestions(self, request):
        from datetime import timedelta
        from sales.models import SaleItem

        horizon = max(int(request.query_params.get("days", 7)), 1)
        since = timezone.now() - timedelta(days=horizon)
        suggestions = []
        products = Product.objects.filter(user=request.user, is_deleted=False).select_related(
            "preferred_supplier", "branch"
        )
        for product in products:
            sold = SaleItem.objects.filter(
                product=product,
                sale__created_by=request.user,
                sale__created_at__gte=since,
                is_deleted=False,
            ).aggregate(total=Sum("quantity"))["total"] or 0
            average_daily_sales = Decimal(sold) / Decimal(horizon)
            target_stock = max(product.reorder_level * 2, int(average_daily_sales * Decimal(horizon * 2)))
            suggested_quantity = max(0, target_stock - product.stock)
            if suggested_quantity <= 0 and product.status == "ok":
                continue
            suggestions.append({
                "product": ProductSerializer(product, context={"request": request}).data,
                "supplier": SupplierSerializer(product.preferred_supplier, context={"request": request}).data
                if product.preferred_supplier else None,
                "average_daily_sales": round(average_daily_sales, 2),
                "suggested_quantity": max(
                    suggested_quantity,
                    product.reorder_level - product.stock if product.stock <= product.reorder_level else 0,
                ),
                "estimated_cost": max(suggested_quantity, 0) * product.cost_price,
                "estimated_cost_currency": request.user.currency,
            })
        return Response({"horizon_days": horizon, "items": suggestions})


class GoodsReceivedNoteViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = GoodsReceivedNoteSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["purchase_order", "status", "delivery_date"]
    search_fields = ["grn_number", "purchase_order__order_number", "purchase_order__supplier__name"]

    def get_queryset(self):
        queryset = GoodsReceivedNote.objects.filter(
            user=self.request.user, is_deleted=False
        ).select_related("purchase_order", "purchase_order__supplier").prefetch_related(
            "items__purchase_order_item__product", "attachments"
        )
        return scope_queryset_to_staff_branch(self.request, queryset, "purchase_order__branch_id")

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def confirm(self, request, pk=None):
        note = self.get_queryset().select_for_update().get(pk=pk)
        if note.status == GoodsReceivedNote.STATUS_CONFIRMED:
            return Response(self.get_serializer(note).data)
        order = PurchaseOrder.objects.select_for_update().get(
            pk=note.purchase_order_id, user=request.user, is_deleted=False
        )
        note_status_before = note.status
        order_status_before = order.status
        if order.status not in {PurchaseOrder.STATUS_APPROVED, PurchaseOrder.STATUS_PARTIALLY_RECEIVED}:
            raise ValidationError("Only approved or partially received purchase orders can be received.")
        receipt_items = list(note.items.select_related("purchase_order_item__product").order_by("id"))
        if not receipt_items:
            raise ValidationError("Add at least one delivery line before confirming receipt.")

        order_items = {
            item.pk: item
            for item in PurchaseOrderItem.objects.select_for_update().filter(
                purchase_order=order, is_deleted=False
            ).order_by("pk")
        }
        order_gross = sum(
            (item.unit_cost * item.quantity_ordered for item in order_items.values()),
            Decimal("0"),
        )
        total_order_quantity = sum(item.quantity_ordered for item in order_items.values())
        discount_base = (order.discount_amount * order.fx_rate_to_base).quantize(CENT)
        charges_base = (order.additional_charges * order.fx_rate_to_base).quantize(CENT)
        allocated_discount = {
            item.pk: GoodsReceivedNoteItem.objects.filter(
                purchase_order_item=item,
                goods_received_note__status=GoodsReceivedNote.STATUS_CONFIRMED,
                is_deleted=False,
            ).aggregate(total=Sum("discount_amount_base"))["total"] or Decimal("0")
            for item in order_items.values()
        }
        allocated_charges = {
            item.pk: GoodsReceivedNoteItem.objects.filter(
                purchase_order_item=item,
                goods_received_note__status=GoodsReceivedNote.STATUS_CONFIRMED,
                is_deleted=False,
            ).aggregate(total=Sum("additional_charges_base"))["total"] or Decimal("0")
            for item in order_items.values()
        }
        previously_accepted = {
            item.pk: PurchaseCostHistory.objects.filter(
                purchase_order=order, goods_received_note_item__purchase_order_item=item
            ).aggregate(total=Sum("quantity"))["total"] or 0
            for item in order_items.values()
        }
        accepted_this_note = {item.pk: 0 for item in order_items.values()}
        stock_changes = []

        for receipt_item in receipt_items:
            order_item = order_items.get(receipt_item.purchase_order_item_id)
            if not order_item:
                raise ValidationError("A delivery line does not belong to this purchase order.")
            if receipt_item.quantity_delivered + receipt_item.quantity_missing > (
                order_item.quantity_ordered - order_item.quantity_received
            ):
                raise ValidationError({"items": f"Receipt exceeds ordered quantity for {order_item.product.name}."})
            if receipt_item.quantity_damaged > receipt_item.quantity_delivered:
                raise ValidationError({"items": f"Damaged quantity exceeds delivered quantity for {order_item.product.name}."})

            accepted = receipt_item.quantity_accepted
            receipt_item.unit_cost_base = (receipt_item.unit_cost * order.fx_rate_to_base).quantize(CENT)
            if accepted:
                cumulative_accepted = previously_accepted[order_item.pk] + accepted_this_note[order_item.pk] + accepted
                if order_gross:
                    discount_target = (
                        discount_base
                        * order_item.unit_cost
                        * cumulative_accepted
                        / order_gross
                    ).quantize(CENT)
                else:
                    discount_target = Decimal("0")
                charge_target = (
                    charges_base * cumulative_accepted / total_order_quantity
                ).quantize(CENT) if total_order_quantity else Decimal("0")
                receipt_item.discount_amount_base = max(
                    discount_target - allocated_discount[order_item.pk], Decimal("0")
                )
                receipt_item.additional_charges_base = max(
                    charge_target - allocated_charges[order_item.pk], Decimal("0")
                )
                raw_cost = (receipt_item.unit_cost_base * accepted).quantize(CENT)
                if receipt_item.discount_amount_base > raw_cost:
                    raise ValidationError({"discount_amount": "The allocated discount exceeds the received goods cost."})
                receipt_item.total_cost_base = (
                    raw_cost
                    - receipt_item.discount_amount_base
                    + receipt_item.additional_charges_base
                ).quantize(CENT)
                landed_unit_cost = (receipt_item.total_cost_base / accepted).quantize(CENT)
                allocated_discount[order_item.pk] += receipt_item.discount_amount_base
                allocated_charges[order_item.pk] += receipt_item.additional_charges_base
                accepted_this_note[order_item.pk] += accepted

                product = Product.objects.select_for_update().get(
                    pk=order_item.product_id, user=request.user, is_deleted=False
                )
                stock_before = product.stock
                batch = None
                if receipt_item.batch_number:
                    batch = ProductBatch.objects.select_for_update().filter(
                        product=product,
                        batch_number=receipt_item.batch_number,
                        is_deleted=False,
                    ).first()
                    if batch and batch.expiry_date != receipt_item.expiry_date:
                        raise ValidationError({
                            "items": f"Batch {receipt_item.batch_number} already exists with a different expiry date."
                        })
                    if batch:
                        batch.quantity_received += accepted
                        batch.quantity_remaining += accepted
                        batch.unit_cost_base = landed_unit_cost
                        batch.save(update_fields=[
                            "quantity_received", "quantity_remaining", "unit_cost_base", "updated_at"
                        ])
                    else:
                        batch = ProductBatch.objects.create(
                            product=product,
                            batch_number=receipt_item.batch_number,
                            expiry_date=receipt_item.expiry_date,
                            quantity_received=accepted,
                            quantity_remaining=accepted,
                            unit_cost_base=landed_unit_cost,
                            supplier=order.supplier,
                        )
                product.stock += accepted
                product.cost_price = landed_unit_cost
                product.cost_currency = request.user.currency
                product.cost_fx_rate_to_base = Decimal("1")
                product.save(update_fields=[
                    "stock", "status", "cost_price", "cost_currency", "cost_fx_rate_to_base", "updated_at"
                ])
                stock_changes.append({
                    "product_id": product.id,
                    "before": stock_before,
                    "after": product.stock,
                    "accepted": accepted,
                    "landed_unit_cost_base": str(landed_unit_cost),
                })
                movement = StockMovement.objects.create(
                    product=product,
                    batch=batch,
                    quantity=accepted,
                    movement_type="in",
                    reason=f"Goods received {note.grn_number}",
                    created_by=request.user,
                )
                receipt_item.batch = batch
                receipt_item.stock_movement = movement
                PurchaseCostHistory.objects.create(
                    product=product,
                    supplier=order.supplier,
                    purchase_order=order,
                    goods_received_note_item=receipt_item,
                    quantity=accepted,
                    unit_cost=receipt_item.unit_cost,
                    currency=order.currency,
                    fx_rate_to_base=order.fx_rate_to_base,
                    unit_cost_base=landed_unit_cost,
                )
            order_item.quantity_received += receipt_item.quantity_delivered
            order_item.save(update_fields=["quantity_received", "updated_at"])
            receipt_item.save()

        note.status = GoodsReceivedNote.STATUS_CONFIRMED
        note.confirmed_at = timezone.now()
        note.confirmed_by = request.user
        note.save(update_fields=["status", "confirmed_at", "confirmed_by", "updated_at"])
        remaining = order.items.filter(
            is_deleted=False,
            quantity_received__lt=models.F("quantity_ordered"),
        ).exists()
        new_status = (
            PurchaseOrder.STATUS_PARTIALLY_RECEIVED if remaining else PurchaseOrder.STATUS_FULLY_RECEIVED
        )
        _record_order_transition(order, new_status, request, f"Confirmed {note.grn_number}")
        log_staff_activity(
            request.user,
            "goods_received_note_confirmed",
            f"Confirmed goods receipt {note.grn_number}",
            actor=request.user,
            request=request,
            object_type="goods_received_note",
            object_id=note.id,
            metadata={
                "purchase_order_id": order.id,
                "before": {"status": note_status_before, "purchase_order_status": order_status_before},
                "after": {"status": note.status, "purchase_order_status": new_status,
                          "stock_changes": stock_changes},
                "items": [{"purchase_order_item_id": item.purchase_order_item_id,
                           "delivered": item.quantity_delivered, "accepted": item.quantity_accepted,
                           "damaged": item.quantity_damaged, "missing": item.quantity_missing,
                           "unit_cost": str(item.unit_cost)} for item in receipt_items],
            },
        )
        return Response(self.get_serializer(note).data)

    @action(
        detail=True,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
        url_path="attachments",
    )
    def attachments(self, request, pk=None):
        note = self.get_object()
        if note.status != GoodsReceivedNote.STATUS_DRAFT:
            raise ValidationError("Delivery documents can only be added before receipt is confirmed.")
        serializer = GoodsReceivedNoteAttachmentSerializer(
            data=request.data,
            context={"request": request, "goods_received_note": note},
        )
        serializer.is_valid(raise_exception=True)
        attachment = serializer.save()
        return Response(
            GoodsReceivedNoteAttachmentSerializer(attachment, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class SupplierReturnViewSet(viewsets.GenericViewSet):
    serializer_class = SupplierReturnSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = SupplierReturn.objects.filter(user=self.request.user, is_deleted=False).select_related(
            "supplier", "purchase_order"
        ).prefetch_related("items")
        return scope_queryset_to_staff_branch(self.request, queryset, "purchase_order__branch_id")

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        page = self.paginate_queryset(queryset)
        serializer = self.get_serializer(page if page is not None else queryset, many=True)
        return self.get_paginated_response(serializer.data) if page is not None else Response(serializer.data)

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        require_staff_operation(request, "inventory.adjust")
        key = str(request.data.get("idempotency_key", "")).strip()
        was_existing = bool(key and SupplierReturn.objects.filter(user=request.user, idempotency_key=key).exists())
        serializer = SupplierReturnCreateSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        return_record = serializer.save()
        if not was_existing:
            return_items = list(return_record.items.select_related(
                "goods_received_note_item__purchase_order_item__product"
            ))
            log_staff_activity(
                request.user,
                "supplier_return_recorded",
                f"Recorded supplier return {return_record.id}",
                actor=request.user,
                request=request,
                object_type="supplier_return",
                object_id=return_record.id,
                metadata={
                    "purchase_order_id": return_record.purchase_order_id,
                    "supplier_id": return_record.supplier_id,
                    "reason": return_record.reason,
                    "after": {"total_amount_base": str(return_record.total_amount_base)},
                    "items": [{
                        "product_id": item.goods_received_note_item.purchase_order_item.product_id,
                        "quantity_returned": item.quantity,
                        "quantity_damaged": item.quantity_damaged,
                        "amount_base": str(item.total_amount_base),
                    } for item in return_items],
                },
            )
        return Response(
            SupplierReturnSerializer(return_record, context={"request": request}).data,
            status=status.HTTP_201_CREATED,
        )


class SupplierPaymentViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierPaymentSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["supplier", "purchase_order", "method", "payment_date"]
    search_fields = ["supplier__name", "purchase_order__order_number", "reference", "notes"]
    ordering_fields = ["payment_date", "amount_base", "created_at"]
    ordering = ["-payment_date", "-id"]

    def get_queryset(self):
        queryset = SupplierPayment.objects.filter(user=self.request.user, is_deleted=False).select_related(
            "supplier", "purchase_order"
        )
        return scope_queryset_to_staff_branch(self.request, queryset, "purchase_order__branch_id")

    def perform_create(self, serializer):
        key = serializer.validated_data.get("idempotency_key", "")
        was_existing = bool(key and SupplierPayment.objects.filter(
            user=self.request.user, idempotency_key=key,
        ).exists())
        payment = serializer.save()
        if not was_existing:
            log_staff_activity(
                self.request.user, "supplier_payment_recorded",
                f"Recorded supplier payment of {payment.amount_base} to {payment.supplier.name}",
                actor=self.request.user, request=self.request,
                object_type="supplier_payment", object_id=payment.id,
                metadata={"after": {
                    "supplier_id": payment.supplier_id,
                    "purchase_order_id": payment.purchase_order_id,
                    "amount": str(payment.amount), "currency": payment.currency,
                    "amount_base": str(payment.amount_base), "payment_date": payment.payment_date.isoformat(),
                    "financial_account_id": payment.financial_account_id,
                }},
            )

    @action(detail=False, methods=["get"], url_path="balances")
    def balances(self, request):
        rows = []
        overdue_invoices = []
        suppliers = Supplier.objects.filter(user=request.user, is_deleted=False).order_by("name")
        staff = get_staff_member(request)
        if staff:
            if not staff.branch_id:
                suppliers = suppliers.none()
            else:
                branch_orders = PurchaseOrder.objects.filter(
                    user=request.user,
                    branch_id=staff.branch_id,
                    is_deleted=False,
                )
                suppliers = suppliers.filter(id__in=branch_orders.values("supplier_id"))
        for supplier in suppliers:
            received_total = Decimal("0")
            orders = PurchaseOrder.objects.filter(
                user=request.user, supplier=supplier, is_deleted=False
            ).prefetch_related("items", "goods_received_notes__items")
            if staff:
                orders = orders.filter(branch_id=staff.branch_id)
            for order in orders:
                receipt_value = get_purchase_order_received_totals_base(order)["received_total_base"]
                received_total += receipt_value
                order_returns = SupplierReturnItem.objects.filter(
                    supplier_return__purchase_order=order,
                    is_deleted=False,
                ).aggregate(total=Sum("total_amount_base"))["total"] or Decimal("0")
                order_payments = SupplierPayment.objects.filter(
                    user=request.user, purchase_order=order, is_deleted=False
                ).aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
                order_outstanding = receipt_value - order_returns - order_payments
                if order.due_date and order.due_date < timezone.localdate() and order_outstanding > 0:
                    overdue_invoices.append({
                        "supplier": supplier.pk,
                        "supplier_name": supplier.name,
                        "purchase_order": order.pk,
                        "order_number": order.order_number,
                        "invoice_number": order.supplier_invoice_number,
                        "invoice_date": order.invoice_date,
                        "due_date": order.due_date,
                        "currency": request.user.currency,
                        "original_total_base": receipt_value,
                        "paid_total_base": order_payments,
                        "returned_total_base": order_returns,
                        "outstanding_base": order_outstanding,
                    })
            returned_total = SupplierReturnItem.objects.filter(
                supplier_return__user=request.user,
                supplier_return__supplier=supplier,
                is_deleted=False,
            ).aggregate(total=Sum("total_amount_base"))["total"] or Decimal("0")
            paid_total = SupplierPayment.objects.filter(
                user=request.user, supplier=supplier, is_deleted=False
            ).aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
            rows.append({
                "supplier": supplier.id,
                "supplier_name": supplier.name,
                "currency": request.user.currency,
                "received_total_base": received_total,
                "returned_total_base": returned_total,
                "paid_total_base": paid_total,
                "outstanding_base": received_total - returned_total - paid_total,
            })
        return Response({"items": rows, "overdue_invoices": overdue_invoices})


class PurchaseCostHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PurchaseCostHistorySerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["product", "supplier", "purchase_order"]

    def get_queryset(self):
        queryset = PurchaseCostHistory.objects.filter(
            product__user=self.request.user, is_deleted=False
        ).select_related("product", "supplier", "purchase_order", "goods_received_note_item__goods_received_note")
        return scope_queryset_to_staff_branch(self.request, queryset, "product__branch_id")


class InventoryIntelligenceViewSet(viewsets.ViewSet):
    permission_classes = [IsAuthenticated]

    def list(self, request):
        from datetime import timedelta
        from sales.models import SaleItem, SaleReturn

        try:
            window_days = int(request.query_params.get("days", 90))
        except (TypeError, ValueError):
            raise ValidationError({"days": "Use a whole number between 30 and 365."})
        if window_days < 30 or window_days > 365:
            raise ValidationError({"days": "Use a whole number between 30 and 365."})

        products_queryset = Product.objects.filter(
            user=request.user, is_deleted=False
        ).select_related("preferred_supplier", "branch", "category").order_by("name")
        products = list(scope_queryset_to_staff_branch(request, products_queryset))
        product_ids = [product.pk for product in products]
        if not product_ids:
            return Response({
                "window_days": window_days,
                "currency": request.user.currency,
                "items": [],
                "summary": {
                    "inventory_value_base": "0.00",
                    "fast_moving_count": 0,
                    "slow_moving_count": 0,
                    "non_moving_count": 0,
                    "dead_stock_count": 0,
                    "low_stock_count": 0,
                },
            })

        cutoff = timezone.localdate() - timedelta(days=window_days)
        dead_stock_cutoff = timezone.localdate() - timedelta(days=180)
        sales = {
            row["product_id"]: row
            for row in SaleItem.objects.filter(
                product_id__in=product_ids,
                sale__created_by=request.user,
                sale__date__gte=cutoff,
                sale__is_deleted=False,
                is_deleted=False,
            ).values("product_id").annotate(
                quantity=Sum("quantity"),
                revenue=Sum("subtotal"),
                profit=Sum("profit"),
            )
        }
        returns = {
            row["sale_item__product_id"]: row
            for row in SaleReturn.objects.filter(
                sale_item__product_id__in=product_ids,
                created_by=request.user,
                return_date__gte=cutoff,
                is_deleted=False,
                sale_item__is_deleted=False,
            ).values("sale_item__product_id").annotate(
                quantity=Sum("quantity"),
                refund=Sum("refund_amount"),
                cost=Sum("cost_amount"),
            )
        }
        movement_rows = {
            row["product_id"]: row
            for row in StockMovement.objects.filter(
                product_id__in=product_ids,
                created_by=request.user,
                created_at__date__gte=cutoff,
                is_deleted=False,
            ).values("product_id").annotate(
                incoming=Sum("quantity", filter=Q(movement_type="in")),
                outgoing=Sum("quantity", filter=Q(movement_type="out")),
                adjustments=Count("id", filter=Q(movement_type="adjustment")),
            )
        }
        cost_rows = {}
        for product_id, quantity, unit_cost_base in PurchaseCostHistory.objects.filter(
            product_id__in=product_ids, is_deleted=False
        ).values_list("product_id", "quantity", "unit_cost_base"):
            totals = cost_rows.setdefault(product_id, {"quantity": 0, "total": Decimal("0")})
            totals["quantity"] += quantity
            totals["total"] += Decimal(quantity) * unit_cost_base
        batch_rows = ProductBatch.objects.filter(
            product_id__in=product_ids,
            is_deleted=False,
            quantity_remaining__gt=0,
        ).values("product_id", "quantity_remaining", "unit_cost_base", "received_at")
        age_data = {}
        for batch in batch_rows:
            age_days = max((timezone.localdate() - batch["received_at"].date()).days, 0)
            bucket = "0_30" if age_days <= 30 else "31_60" if age_days <= 60 else "61_90" if age_days <= 90 else "over_90"
            row = age_data.setdefault(batch["product_id"], {
                "0_30": {"quantity": 0, "value_base": Decimal("0")},
                "31_60": {"quantity": 0, "value_base": Decimal("0")},
                "61_90": {"quantity": 0, "value_base": Decimal("0")},
                "over_90": {"quantity": 0, "value_base": Decimal("0")},
                "tracked_quantity": 0,
                "dead_stock_quantity": 0,
            })
            quantity = batch["quantity_remaining"]
            value = (Decimal(quantity) * batch["unit_cost_base"]).quantize(CENT)
            row[bucket]["quantity"] += quantity
            row[bucket]["value_base"] += value
            row["tracked_quantity"] += quantity
            if batch["received_at"].date() <= dead_stock_cutoff:
                row["dead_stock_quantity"] += quantity

        rows = []
        totals = {
            "inventory_value_base": Decimal("0"),
            "fast_moving_count": 0,
            "slow_moving_count": 0,
            "non_moving_count": 0,
            "dead_stock_count": 0,
            "low_stock_count": 0,
        }
        for product in products:
            sales_row = sales.get(product.pk, {})
            returns_row = returns.get(product.pk, {})
            sold_quantity = sales_row.get("quantity") or 0
            returned_quantity = returns_row.get("quantity") or 0
            net_sold = max(sold_quantity - returned_quantity, 0)
            net_revenue = (sales_row.get("revenue") or Decimal("0")) - (returns_row.get("refund") or Decimal("0"))
            net_profit = (
                (sales_row.get("profit") or Decimal("0"))
                - (returns_row.get("refund") or Decimal("0"))
                + (returns_row.get("cost") or Decimal("0"))
            )
            velocity = Decimal(net_sold) / Decimal(window_days)
            movement = movement_rows.get(product.pk, {})
            age = age_data.get(product.pk, {
                "0_30": {"quantity": 0, "value_base": Decimal("0")},
                "31_60": {"quantity": 0, "value_base": Decimal("0")},
                "61_90": {"quantity": 0, "value_base": Decimal("0")},
                "over_90": {"quantity": 0, "value_base": Decimal("0")},
                "tracked_quantity": 0,
                "dead_stock_quantity": 0,
            })
            untracked_quantity = max(product.stock - age["tracked_quantity"], 0)
            current_unit_cost_base = (product.cost_price * product.cost_fx_rate_to_base).quantize(CENT)
            inventory_value = sum(
                (age[bucket]["value_base"] for bucket in ("0_30", "31_60", "61_90", "over_90")),
                Decimal("0"),
            ) + (Decimal(untracked_quantity) * current_unit_cost_base).quantize(CENT)
            if velocity >= Decimal("1"):
                movement_class = "fast"
                totals["fast_moving_count"] += 1
            elif velocity > 0:
                movement_class = "slow"
                totals["slow_moving_count"] += 1
            else:
                movement_class = "non_moving"
                totals["non_moving_count"] += 1
            dead_stock = age["dead_stock_quantity"] > 0
            if dead_stock:
                totals["dead_stock_count"] += 1
            if product.status in {"low", "out"}:
                totals["low_stock_count"] += 1
            totals["inventory_value_base"] += inventory_value

            opening_stock = None
            average_stock = None
            turnover = None
            if not movement.get("adjustments", 0):
                opening_stock = max(
                    product.stock
                    - (movement.get("incoming") or 0)
                    + (movement.get("outgoing") or 0),
                    0,
                )
                average_stock = (Decimal(opening_stock + product.stock) / Decimal("2")).quantize(CENT)
                if average_stock > 0:
                    turnover = (Decimal(net_sold) / average_stock).quantize(CENT)

            cost_history = cost_rows.get(product.pk, {})
            average_purchase_cost = (
                (cost_history["total"] / cost_history["quantity"]).quantize(CENT)
                if cost_history.get("quantity") else None
            )
            rows.append({
                "product_id": product.pk,
                "product_name": product.name,
                "sku": product.sku,
                "category": product.category.name if product.category else "",
                "branch": product.branch.name if product.branch else "",
                "preferred_supplier": product.preferred_supplier.name if product.preferred_supplier else "",
                "stock": product.stock,
                "reorder_level": product.reorder_level,
                "status": product.status,
                "movement_class": movement_class,
                "sold_quantity": sold_quantity,
                "returned_quantity": returned_quantity,
                "net_sold_quantity": net_sold,
                "average_daily_sales": velocity.quantize(Decimal("0.01")),
                "net_revenue": net_revenue.quantize(CENT),
                "gross_profit": net_profit.quantize(CENT),
                "inventory_value_base": inventory_value.quantize(CENT),
                "average_purchase_cost_base": average_purchase_cost,
                "stock_turnover": turnover,
                "dead_stock": dead_stock,
                "ageing": age,
                "untracked_quantity": untracked_quantity,
                "cost_basis": "batch_cost_and_current_cost_for_untracked_stock",
                "average_stock": average_stock,
                "opening_stock": opening_stock,
            })
        totals["inventory_value_base"] = totals["inventory_value_base"].quantize(CENT)
        return Response({
            "window_days": window_days,
            "currency": request.user.currency,
            "classification_thresholds": {
                "fast": "at least 1 net unit sold per day",
                "slow": "more than 0 and less than 1 net unit sold per day",
                "non_moving": "no net sales in the selected window",
                "dead_stock": "remaining tracked batch stock received more than 180 days ago; untracked stock age is unknown",
            },
            "summary": totals,
            "items": rows,
        })
