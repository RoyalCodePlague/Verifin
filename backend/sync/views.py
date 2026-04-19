from django.utils.dateparse import parse_datetime
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import SyncConflict
from .serializers import SyncConflictSerializer
from audits.models import Audit, Discrepancy
from sales.serializers import SaleSerializer
from expenses.serializers import ExpenseSerializer
from expenses.models import ExpenseCategory
from inventory.models import Category, Product
from inventory.serializers import ProductSerializer


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
                "subtotal": item.get("subtotal"),
            })
        return resolved

    def post(self, request):
        actions = request.data.get("actions", [])
        processed = 0
        conflicts = []
        errors = []
        local_audit_ids = {}
        local_product_ids = {}

        for action in actions:
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
                    serializer.save(created_by=request.user)
                    processed += 1
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
                    serializer.save(created_by=request.user)
                    processed += 1
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
                    "reorder_level": payload.get("reorder_level", payload.get("reorder", 0)),
                    "cost_price": payload.get("cost_price", 0),
                    "price": payload.get("price", 0),
                    "branch": payload.get("branch"),
                }
                serializer = ProductSerializer(data=product_payload, context={"request": request})
                if serializer.is_valid():
                    product = serializer.save(user=request.user)
                    local_id = payload.get("local_id")
                    if local_id:
                        local_product_ids[str(local_id)] = product.id
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    conflicts.append(record_conflict(request.user, action, "Product create sync failed").id)
            elif action_type == "product_update":
                try:
                    product = Product.objects.get(id=payload.get("id"), user=request.user, is_deleted=False)
                except Product.DoesNotExist:
                    errors.append({"action": action, "detail": "Product not found"})
                    conflicts.append(record_conflict(request.user, action, "Product update target missing").id)
                    continue

                product_payload = {
                    "name": payload.get("name", product.name),
                    "sku": payload.get("sku", product.sku),
                    "barcode": payload.get("barcode", product.barcode),
                    "category": self._inventory_category_id(request, payload),
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
            elif action_type == "audit_create":
                audit = Audit.objects.create(
                    conductor=request.user,
                    status=payload.get("status", "in_progress"),
                    items_counted=payload.get("items_counted", 0),
                    discrepancies_found=payload.get("discrepancies_found", 0),
                    completed_at=timezone.now() if payload.get("status") == "completed" else None,
                )
                local_id = payload.get("local_id")
                if local_id:
                    local_audit_ids[str(local_id)] = audit.id
                processed += 1
            elif action_type == "audit_update":
                audit_id = payload.get("id") or local_audit_ids.get(str(payload.get("local_id")))
                try:
                    audit = Audit.objects.get(id=audit_id, conductor=request.user, is_deleted=False)
                except Audit.DoesNotExist:
                    errors.append({"action": action, "detail": "Audit not found"})
                    conflicts.append(record_conflict(request.user, action, "Audit update target missing").id)
                    continue

                if payload.get("status"):
                    audit.status = payload["status"]
                    if audit.status == "completed" and not audit.completed_at:
                        audit.completed_at = timezone.now()
                if payload.get("items_counted") is not None:
                    audit.items_counted = payload["items_counted"]
                if payload.get("discrepancies_found") is not None:
                    audit.discrepancies_found = payload["discrepancies_found"]
                audit.save()
                processed += 1
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
