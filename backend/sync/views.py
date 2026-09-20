from accounts.authentication import require_area
from rest_framework.exceptions import ValidationError
from django.db import transaction
from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import ProcessedSyncAction, SyncConflict
from .serializers import SyncConflictSerializer
from audits.models import Audit, Discrepancy
from sales.serializers import SaleSerializer
from expenses.serializers import ExpenseSerializer
from expenses.models import ExpenseCategory
from inventory.models import Category, Product
from inventory.serializers import ProductSerializer, SupplierSerializer
from customers.models import Customer
from customers.serializers import CustomerSerializer
from accounts.models import Staff
from accounts.serializers import StaffSerializer
from billing.services import enforce_feature


def record_conflict(user, action, reason):
    return SyncConflict.objects.create(
        user=user,
        action_id=action.get("id", ""),
        action_type=action.get("type", ""),
        payload=action,
        reason=reason,
    )


class SyncConflictViewSet(viewsets.ModelViewSet):
    serializer_class = SyncConflictSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "action_type"]
    search_fields = ["reason", "action_type", "action_id"]

    def get_queryset(self):
        return SyncConflict.objects.filter(user=self.request.user, is_deleted=False).order_by("-created_at")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"])
    def resolve(self, request, pk=None):
        conflict = self.get_object()
        conflict.status = request.data.get("status", "resolved")
        conflict.resolution_note = request.data.get("resolution_note", "")
        conflict.save()
        return Response(SyncConflictSerializer(conflict).data)


class SyncPushView(APIView):
    permission_classes = [IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        enforce_feature(request.user, "offline_sync")

    def _inventory_category_id(self, request, payload):
        category_name = payload.get("categoryName") or payload.get("category_name")
        if not category_name:
            return payload.get("category")

        category, _ = Category.objects.get_or_create(user=request.user, name=category_name)
        return category.id

    def _resolve_sale_items(self, request, items, local_product_ids):
        resolved = []
        for item in items:
            product_id = item.get("product")
            local_id = item.get("product_local_id")
            product_name = item.get("product_name")

            if not product_id and local_id:
                product_id = local_product_ids.get(str(local_id))

            if not product_id and product_name:
                product = Product.objects.filter(
                    user=request.user,
                    name__iexact=product_name,
                    is_deleted=False,
                ).order_by("-created_at").first()
                if product:
                    product_id = product.id

            if not product_id:
                raise ValueError(f"Product not found for offline sale item: {product_name or local_id or 'unknown'}")

            resolved.append({
                "product": product_id,
                "quantity": item.get("quantity"),
                "unit_price": item.get("unit_price"),
                **({"subtotal": item["subtotal"]} if item.get("subtotal") is not None else {}),
            })
        return resolved

    @transaction.atomic
    def post(self, request):
        from django.contrib.auth import get_user_model
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        actions = request.data.get("actions", [])
        if not isinstance(actions, list):
            raise ValidationError({"actions": "Expected a list."})
        # Authorize the entire batch before any writes, including cached/replayed actions.
        for queued in actions:
            if not isinstance(queued, dict) or not isinstance(queued.get("payload", {}), dict) or not isinstance(queued.get("type"), str):
                raise ValidationError({"actions": "Each action needs a type and an object payload."})
            kind = queued.get("type", "")
            area = {"sale": "sales", "expense": "expenses", "restock": "inventory"}.get(kind)
            if area is None:
                prefix = kind.split("_")[0]
                area = {"product": "inventory", "customer": "customers", "staff": "staff", "supplier": "suppliers", "supply": "suppliers", "audit": "audits", "discrepancy": "audits"}.get(prefix)
            if area is None:
                raise ValidationError({"actions": "Unsupported sync action type."})
            require_area(request, area)
        processed = 0
        conflicts = []
        errors = []
        local_audit_ids = {}
        local_product_ids = {}

        for action in actions:
            action_id = str(action.get("id", "")).strip()
            previous = ProcessedSyncAction.objects.filter(user=request.user, action_id=action_id).first() if action_id else None
            if previous:
                local_id = str(action.get("payload", {}).get("local_id", ""))
                if previous.result_id and previous.action_type == "product_create":
                    local_product_ids[local_id] = previous.result_id
                if previous.result_id and previous.action_type == "audit_create":
                    local_audit_ids[local_id] = previous.result_id
                continue
            result_id = None

            processed_before = processed
            action_type = action.get("type")
            payload = action.get("payload", {})

            if action_type == "sale":
                try:
                    sale_payload = {
                        **payload,
                        "sale_items": self._resolve_sale_items(
                            request,
                            payload.get("sale_items", []),
                            local_product_ids,
                        ),
                    }
                except ValueError as exc:
                    errors.append({"action": action, "detail": str(exc)})
                    conflicts.append(record_conflict(request.user, action, str(exc)).id)
                    continue

                serializer = SaleSerializer(data=sale_payload, context={"request": request})
                if serializer.is_valid():
                    try:
                        with transaction.atomic():
                            serializer.save(created_by=request.user)
                        processed += 1
                    except ValidationError as exc:
                        errors.append({"action": action, "detail": exc.detail})
                        conflicts.append(record_conflict(request.user, action, "Transaction sync failed").id)
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Sale sync failed").id)

            elif action_type == "expense":
                category_name = payload.get("categoryName") or payload.get("category_name")
                if category_name:
                    category, _ = ExpenseCategory.objects.get_or_create(name=category_name)
                    payload["category"] = category.id
                serializer = ExpenseSerializer(data=payload, context={"request": request})
                if serializer.is_valid():
                    try:
                        with transaction.atomic():
                            serializer.save(created_by=request.user)
                        processed += 1
                    except ValidationError as exc:
                        errors.append({"action": action, "detail": exc.detail})
                        conflicts.append(record_conflict(request.user, action, "Transaction sync failed").id)
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Expense sync failed").id)
            elif action_type == "product_create":
                product_payload = {
                    "name": payload.get("name"),
                    "sku": payload.get("sku"),
                    "barcode": payload.get("barcode", ""),
                    "category": self._inventory_category_id(request, payload),
                    "stock": payload.get("stock", 0),
                    "preferred_supplier": payload.get("preferred_supplier"),
                    "reorder_level": payload.get("reorder_level", payload.get("reorder", 0)),
                    "cost_price": payload.get("cost_price", 0),
                    "price": payload.get("price", 0),
                    "branch": payload.get("branch"),
                }
                serializer = ProductSerializer(data=product_payload, context={"request": request})
                if serializer.is_valid():
                    product = serializer.save(user=request.user)
                    result_id = product.id
                    local_id = payload.get("local_id")
                    if local_id:
                        local_product_ids[str(local_id)] = product.id
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Product create sync failed").id)
            elif action_type == "product_update":
                try:
                    product = Product.objects.select_for_update().get(id=payload.get("id") or local_product_ids.get(str(payload.get("local_id"))), user=request.user, is_deleted=False)
                except Product.DoesNotExist:
                    errors.append({"action": action, "detail": "Product not found"})
                    conflicts.append(record_conflict(request.user, action, "Product update target missing").id)
                    continue

                expected_stock = payload.get("expected_stock")
                if expected_stock is not None and payload.get("stock") == expected_stock:
                    payload = {key: value for key, value in payload.items() if key != "stock"}
                elif "stock" in payload and (expected_stock is None or product.stock != expected_stock):
                    errors.append({"action": action, "detail": "Stock changed since this offline edit. Review the current stock before applying it."})
                    conflicts.append(record_conflict(request.user, action, "Stock changed since offline edit").id)
                    continue

                product_payload = {
                    "name": payload.get("name", product.name),
                    "sku": payload.get("sku", product.sku),
                    "barcode": payload.get("barcode", product.barcode),
                    "category": self._inventory_category_id(request, payload) if any(k in payload for k in ("category", "categoryName", "category_name")) else product.category_id,
                    "preferred_supplier": payload.get("preferred_supplier", product.preferred_supplier_id),
                    "stock": payload.get("stock", product.stock),
                    "reorder_level": payload.get("reorder_level", payload.get("reorder", product.reorder_level)),
                    "cost_price": payload.get("cost_price", product.cost_price),
                    "price": payload.get("price", product.price),
                    "branch": payload.get("branch", product.branch_id),
                }
                serializer = ProductSerializer(product, data=product_payload, partial=True, context={"request": request})
                if serializer.is_valid():
                    serializer.save()
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Product update sync failed").id)
            elif action_type == "product_delete":
                updated = Product.objects.filter(id=payload.get("id"), user=request.user, is_deleted=False).update(is_deleted=True)
                if updated:
                    processed += 1
                else:
                    errors.append({"action": action, "detail": "Product not found"})
                    conflicts.append(record_conflict(request.user, action, "Product delete target missing").id)
            elif action_type == "customer_create":
                serializer = CustomerSerializer(data=payload, context={"request": request})
                if serializer.is_valid():
                    serializer.save(user=request.user)
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Customer create sync failed").id)
            elif action_type == "customer_update":
                try:
                    customer = Customer.objects.get(id=payload.get("id"), user=request.user, is_deleted=False)
                except Customer.DoesNotExist:
                    errors.append({"action": action, "detail": "Customer not found"})
                    conflicts.append(record_conflict(request.user, action, "Customer update target missing").id)
                    continue
                serializer = CustomerSerializer(customer, data=payload, partial=True, context={"request": request})
                if serializer.is_valid():
                    serializer.save()
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Customer update sync failed").id)
            elif action_type == "customer_delete":
                updated = Customer.objects.filter(id=payload.get("id"), user=request.user, is_deleted=False).update(is_deleted=True)
                if updated:
                    processed += 1
                else:
                    errors.append({"action": action, "detail": "Customer not found"})
                    conflicts.append(record_conflict(request.user, action, "Customer delete target missing").id)
            elif action_type == "staff_create":
                serializer = StaffSerializer(data=payload, context={"request": request})
                if serializer.is_valid():
                    serializer.save(user=request.user)
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Staff create sync failed").id)
            elif action_type == "staff_update":
                try:
                    staff = Staff.objects.get(id=payload.get("id"), user=request.user, is_deleted=False)
                except Staff.DoesNotExist:
                    errors.append({"action": action, "detail": "Staff member not found"})
                    conflicts.append(record_conflict(request.user, action, "Staff update target missing").id)
                    continue
                serializer = StaffSerializer(staff, data=payload, partial=True, context={"request": request})
                if serializer.is_valid():
                    serializer.save()
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Staff update sync failed").id)
            elif action_type == "staff_delete":
                updated = Staff.objects.filter(id=payload.get("id"), user=request.user, is_deleted=False).update(is_deleted=True)
                if updated:
                    processed += 1
                else:
                    errors.append({"action": action, "detail": "Staff member not found"})
                    conflicts.append(record_conflict(request.user, action, "Staff delete target missing").id)
            elif action_type == "supplier_create":
                serializer = SupplierSerializer(data=payload, context={"request": request})
                if serializer.is_valid():
                    serializer.save(user=request.user)
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Supplier create sync failed").id)
            elif action_type in ("supply_create", "supply_update"):
                from inventory.supply import SupplyEntrySerializer
                from inventory.models import SupplyEntry
                supply_payload = dict(payload)
                instance = None
                if action_type == "supply_update":
                    instance = SupplyEntry.objects.filter(user=request.user, request_id=supply_payload.pop("requestId", ""), is_deleted=False).first()
                    if instance is None:
                        errors.append({"action": action, "detail": "Supply entry not found"})
                        conflicts.append(record_conflict(request.user, action, "Supply entry not found").id)
                        continue
                else:
                    local_id = str(supply_payload.get("productId", ""))
                    if local_id in local_product_ids:
                        supply_payload["productId"] = local_product_ids[local_id]
                serializer = SupplyEntrySerializer(instance, data=supply_payload, partial=instance is not None, context={"request": request})
                try:
                    serializer.is_valid(raise_exception=True)
                    serializer.save()
                    processed += 1
                except ValidationError as exc:
                    errors.append({"action": action, "detail": exc.detail})
                    conflicts.append(record_conflict(request.user, action, "Supply sync failed").id)

            elif action_type == "audit_create":
                from audits.serializers import AuditSerializer
                enforce_feature(request.user, "audits")
                serializer = AuditSerializer(data=payload, context={"request": request})
                if not serializer.is_valid():
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Audit create failed").id)
                    continue
                audit = serializer.save(conductor=request.user)
                result_id = audit.id
                local_id = payload.get("local_id")
                if local_id:
                    local_audit_ids[str(local_id)] = audit.id
                processed += 1
            elif action_type == "audit_complete":
                from audits.services import complete_audit
                audit_id = payload.get("id") or local_audit_ids.get(str(payload.get("local_id")))
                counts = payload.get("counts")
                if counts is not None:
                    counts = [{**row, "product": local_product_ids.get(str(row.get("product")), row.get("product"))} for row in counts]
                try:
                    complete_audit(request, audit_id, counts)
                    processed += 1
                except (ValidationError, Audit.DoesNotExist) as exc:
                    errors.append({"action": action, "detail": str(exc)})
                    conflicts.append(record_conflict(request.user, action, "Audit completion failed").id)
            elif action_type == "audit_update":
                audit_id = payload.get("id") or local_audit_ids.get(str(payload.get("local_id")))
                try:
                    audit = Audit.objects.get(id=audit_id, conductor=request.user, is_deleted=False)
                except Audit.DoesNotExist:
                    errors.append({"action": action, "detail": "Audit not found"})
                    conflicts.append(record_conflict(request.user, action, "Audit update target missing").id)
                    continue

                from audits.serializers import AuditSerializer
                from audits.services import complete_audit
                try:
                    enforce_feature(request.user, "audits")
                    if payload.get("status") == "completed":
                        complete_audit(request, audit.id)
                    else:
                        serializer = AuditSerializer(audit, data=payload, partial=True, context={"request": request})
                        serializer.is_valid(raise_exception=True)
                        serializer.save()
                    processed += 1
                except ValidationError as exc:
                    errors.append({"action": action, "detail": str(exc)})
                    conflicts.append(record_conflict(request.user, action, "Audit update failed").id)
            elif action_type == "discrepancy_create":
                audit_id = payload.get("audit") or local_audit_ids.get(str(payload.get("audit_local_id")))
                product_id = payload.get("product")
                try:
                    audit = Audit.objects.get(id=audit_id, conductor=request.user, is_deleted=False)
                    product = Product.objects.get(id=product_id, user=request.user, is_deleted=False)
                except (Audit.DoesNotExist, Product.DoesNotExist):
                    errors.append({"action": action, "detail": "Audit or product not found"})
                    conflicts.append(record_conflict(request.user, action, "Discrepancy create target missing").id)
                    continue

                Discrepancy.objects.create(
                    audit=audit,
                    product=product,
                    expected_stock=payload.get("expected_stock", 0),
                    actual_stock=payload.get("actual_stock", 0),
                    difference=payload.get("difference", 0),
                    status=payload.get("status", "unresolved"),
                )
                processed += 1
            elif action_type == "discrepancy_resolve":
                updated = Discrepancy.objects.filter(
                    id=payload.get("id"),
                    audit__conductor=request.user,
                    is_deleted=False,
                ).update(status="resolved", resolved_by_id=request.user.id, resolved_at=timezone.now())
                if updated:
                    processed += 1
                else:
                    errors.append({"action": action, "detail": "Discrepancy not found"})
                    conflicts.append(record_conflict(request.user, action, "Discrepancy resolve target missing").id)
            else:
                errors.append({"action": action, "detail": "Unsupported sync action type"})
                conflicts.append(record_conflict(request.user, action, "Unsupported sync action").id)

            if action_id and processed > processed_before:
                ProcessedSyncAction.objects.get_or_create(
                    user=request.user,
                    action_id=action_id,
                    defaults={"action_type": str(action_type or ""), "result_id": result_id},
                )

        response_data = {
            "processed": processed,
            "conflicts": conflicts,
            "errors": errors,
            "resolution": "server_wins",
        }
        return Response(response_data, status=status.HTTP_200_OK)


class SyncPullView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        since = parse_datetime(request.query_params.get("since", ""))
        qs = SyncConflict.objects.filter(user=request.user)
        if since:
            qs = qs.filter(updated_at__gte=since)
        data = [SyncConflictSerializer(item).data for item in qs]
        return Response({"changes": data})
