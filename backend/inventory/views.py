from datetime import timedelta
from decimal import Decimal
import httpx
from django.db import models, transaction
from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import APIException
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from accounts.activity import log_staff_activity
from accounts.approvals import require_approval_if_over_threshold
from accounts.branch_access import (
    get_staff_member,
    require_business_owner,
    require_staff_branch,
    require_staff_operation,
    scope_queryset_to_staff_branch,
)
from billing.services import enforce_feature, enforce_limit
from sales.models import SaleItem
from .models import (
    BarcodeLookupCache,
    Branch,
    Category,
    GoodsReceivedNote,
    GoodsReceivedNoteItem,
    Product,
    ProductBatch,
    PurchaseCostHistory,
    PurchaseOrder,
    PurchaseOrderItem,
    StockMovement,
    StockTransfer,
    StockTransferEvent,
    Supplier,
    SupplierPayment,
    SupplierReturn,
    SupplierReturnItem,
)
from .serializers import BranchSerializer, CategorySerializer, ProductBatchSerializer, ProductSerializer, PurchaseOrderSerializer, StockMovementSerializer, StockTransferSerializer, SupplierPaymentSerializer, SupplierSerializer
from .purchasing_serializers import (
    GoodsReceivedNoteSerializer,
    PurchaseCostHistorySerializer,
    PurchaseOrderSerializer as LifecyclePurchaseOrderSerializer,
    SupplierPaymentSerializer as PurchasingSupplierPaymentSerializer,
    SupplierReturnSerializer,
)
from .supplier_financial_services import get_purchase_order_received_totals_base

BARCODE_IDENTIFICATION_SOURCES = [
    ("open_food_facts", "https://world.openfoodfacts.org/api/v2/product/{barcode}"),
    ("open_products_facts", "https://world.openproductsfacts.org/api/v2/product/{barcode}"),
    ("open_beauty_facts", "https://world.openbeautyfacts.org/api/v2/product/{barcode}"),
    ("open_pet_food_facts", "https://world.openpetfoodfacts.org/api/v2/product/{barcode}"),
]


class StockTransferConflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = "This transfer idempotency key was already used with different details."
    default_code = "transfer_idempotency_conflict"


def create_transfer_request(request, payload):
    serializer = StockTransferSerializer(data=payload, context={"request": request})
    serializer.is_valid(raise_exception=True)
    values = serializer.validated_data
    key = values.get("idempotency_key", "")
    if key:
        from django.contrib.auth import get_user_model
        get_user_model().objects.select_for_update().get(pk=request.user.pk)
        existing = StockTransfer.objects.filter(created_by=request.user, idempotency_key=key).first()
        if existing:
            matches = (
                existing.product_id == values["product"].id
                and existing.to_branch_id == values["to_branch"].id
                and existing.quantity == values["quantity"]
                and existing.batch_id == getattr(values.get("batch"), "id", None)
                and existing.note == values.get("note", "")
            )
            if not matches:
                raise StockTransferConflict()
            return existing, False
    transfer = serializer.save(
        created_by=request.user,
        from_branch=values["product"].branch,
    )
    StockTransferEvent.objects.create(
        transfer=transfer,
        action="requested",
        quantity=transfer.quantity,
        note=transfer.note,
        created_by=request.user,
    )
    log_staff_activity(
        request.user, "stock_transfer_requested", f"Requested transfer of {transfer.quantity} {transfer.product.name}",
        actor=request.user, request=request, object_type="stock_transfer", object_id=transfer.id,
        metadata={"after": {"status": transfer.status, "quantity": transfer.quantity,
                            "from_branch_id": transfer.from_branch_id, "to_branch_id": transfer.to_branch_id,
                            "product_id": transfer.product_id}, "note": transfer.note},
    )
    return transfer, True


def _clean_text(value):
    return (value or "").strip()


def _extract_product_identity(payload, barcode, source):
    product = payload.get("product") or {}
    name = (
        _clean_text(product.get("product_name"))
        or _clean_text(product.get("product_name_en"))
        or _clean_text(product.get("generic_name"))
        or _clean_text(product.get("generic_name_en"))
    )
    brand = _clean_text(product.get("brands"))
    category = ""

    categories_tags = product.get("categories_tags") or []
    if categories_tags:
        category = _clean_text(str(categories_tags[0]).split(":")[-1].replace("-", " ").title())
    if not category:
        categories = _clean_text(product.get("categories"))
        if categories:
            category = _clean_text(categories.split(",")[0])

    return {
        "barcode": barcode,
        "name": name,
        "brand": brand,
        "category": category,
        "source": source,
    }


def _cache_identity(identity):
    BarcodeLookupCache.objects.update_or_create(
        barcode=identity["barcode"],
        defaults={
            "name": identity["name"],
            "brand": identity.get("brand", ""),
            "category": identity.get("category", ""),
            "source": identity.get("source", "cache"),
            "is_deleted": False,
        },
    )


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    search_fields = ["name"]

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class BranchViewSet(viewsets.ModelViewSet):
    serializer_class = BranchSerializer
    permission_classes = [IsAuthenticated]
    search_fields = ["name", "code", "address"]

    def get_queryset(self):
        queryset = Branch.objects.filter(user=self.request.user, is_deleted=False)
        staff = get_staff_member(self.request)
        if staff:
            return queryset.filter(pk=staff.branch_id) if staff.branch_id else queryset.none()
        return queryset

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            require_business_owner(request)

    def perform_create(self, serializer):
        enforce_feature(self.request.user, "multi_branch")
        branch = serializer.save(user=self.request.user)
        if not Branch.objects.filter(user=self.request.user, is_deleted=False).exclude(id=branch.id).exists():
            branch.is_primary = True
            branch.save()
        log_staff_activity(
            self.request.user, "branch_created", f"Created branch {branch.name}",
            actor=self.request.user, request=self.request, object_type="branch", object_id=branch.id,
            metadata={"after": {
                "name": branch.name, "code": branch.code, "opening_date": branch.opening_date.isoformat(),
                "manager_id": branch.manager_id, "is_primary": branch.is_primary,
            }},
        )

    def perform_update(self, serializer):
        enforce_feature(self.request.user, "multi_branch")
        branch = serializer.instance
        before = {
            "name": branch.name, "code": branch.code, "phone": branch.phone,
            "email": branch.email, "address": branch.address,
            "opening_date": branch.opening_date.isoformat(),
            "manager_id": branch.manager_id, "is_primary": branch.is_primary,
        }
        branch = serializer.save()
        after = {
            "name": branch.name, "code": branch.code, "phone": branch.phone,
            "email": branch.email, "address": branch.address,
            "opening_date": branch.opening_date.isoformat(),
            "manager_id": branch.manager_id, "is_primary": branch.is_primary,
        }
        if before != after:
            log_staff_activity(
                self.request.user, "branch_updated", f"Updated branch {branch.name}",
                actor=self.request.user, request=self.request, object_type="branch", object_id=branch.id,
                metadata={"before": before, "after": after},
            )

    def perform_destroy(self, instance):
        enforce_feature(self.request.user, "multi_branch")
        linked_records = (
            instance.products.filter(is_deleted=False).exists()
            or instance.sales.filter(is_deleted=False).exists()
            or instance.till_sessions.filter(is_deleted=False).exists()
            or instance.staff_members.filter(is_deleted=False).exists()
            or instance.purchase_orders.filter(is_deleted=False).exists()
            or instance.outgoing_transfers.filter(is_deleted=False).exists()
            or instance.incoming_transfers.filter(is_deleted=False).exists()
            or instance.expenses.filter(is_deleted=False).exists()
            or instance.other_income.filter(is_deleted=False).exists()
            or instance.customers.filter(is_deleted=False).exists()
        )
        if linked_records:
            raise serializers.ValidationError(
                {"detail": "This branch is in use. Reassign or remove its products, sales, tills, staff, purchase orders, and transfers before deleting it."}
            )
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted", "updated_at"])
        log_staff_activity(
            self.request.user, "branch_deleted", f"Deleted branch {instance.name}",
            actor=self.request.user, request=self.request, object_type="branch", object_id=instance.id,
            metadata={"before": {"name": instance.name, "code": instance.code}, "after": {"is_deleted": True}},
        )


class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    filterset_fields = ["status", "category", "branch"]
    search_fields = ["name", "sku", "barcode"]
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Product.objects.filter(user=self.request.user, is_deleted=False)
        branch = self.request.query_params.get("branch")
        if branch:
            qs = qs.filter(branch_id=branch)
        return scope_queryset_to_staff_branch(self.request, qs)

    def perform_create(self, serializer):
        enforce_limit(self.request.user, "products")
        if serializer.validated_data.get("stock", 0) > 0:
            require_approval_if_over_threshold(
                self.request, "stock_adjustment_units_threshold", serializer.validated_data["stock"], "inventory.adjust"
            )
        product = serializer.save(user=self.request.user)
        from core.analytics import record_activation_event
        record_activation_event(self.request.user, "first_product_added")
        if product.stock > 0:
            StockMovement.objects.create(
                product=product,
                quantity=product.stock,
                movement_type="in",
                reason="Opening stock",
                created_by=self.request.user,
            )
        log_staff_activity(
            self.request.user, "product_created", f"Created product {product.name}",
            actor=self.request.user, request=self.request, object_type="product", object_id=product.id,
            metadata={"after": {"name": product.name, "sku": product.sku, "stock": product.stock,
                                "price": str(product.price), "cost_price": str(product.cost_price),
                                "branch_id": product.branch_id}},
        )
        from accounts.webhooks import enqueue_product_stock_event
        enqueue_product_stock_event(self.request.user, product)

    def perform_update(self, serializer):
        previous_product = serializer.instance
        previous_status = previous_product.status
        requested_stock = serializer.validated_data.get("stock", previous_product.stock)
        if requested_stock != previous_product.stock:
            require_approval_if_over_threshold(
                self.request,
                "stock_adjustment_units_threshold",
                abs(requested_stock - previous_product.stock),
                "inventory.adjust",
            )
        before = {
            "name": previous_product.name, "sku": previous_product.sku, "stock": previous_product.stock,
            "price": str(previous_product.price), "cost_price": str(previous_product.cost_price),
            "branch_id": previous_product.branch_id,
        }
        product = serializer.save()
        if product.stock != before["stock"]:
            StockMovement.objects.create(
                product=product,
                quantity=product.stock,
                movement_type="adjustment",
                reason="Manual product stock adjustment",
                created_by=self.request.user,
            )
        after = {
            "name": product.name, "sku": product.sku, "stock": product.stock,
            "price": str(product.price), "cost_price": str(product.cost_price),
            "branch_id": product.branch_id,
        }
        log_staff_activity(
            self.request.user, "product_updated", f"Updated product {product.name}",
            actor=self.request.user, request=self.request, object_type="product", object_id=product.id,
            metadata={"before": before, "after": after},
        )
        from accounts.webhooks import enqueue_product_stock_event
        enqueue_product_stock_event(self.request.user, product, previous_status)

    def perform_destroy(self, instance):
        name = instance.name
        instance.is_deleted = True
        instance.save()
        log_staff_activity(
            self.request.user, "product_deleted", f"Deleted product {name}",
            actor=self.request.user, request=self.request, object_type="product", object_id=instance.id,
            metadata={"before": {"name": name, "sku": instance.sku, "stock": instance.stock},
                      "after": {"is_deleted": True}},
        )

    @action(detail=False, methods=["get"], url_path="barcode-lookup")
    def barcode_lookup(self, request):
        enforce_feature(request.user, "barcode_scanning")
        code = request.query_params.get("code")
        product = self.get_queryset().filter(barcode=code).first()
        if not product:
            return Response({"detail": "Product not found."}, status=404)
        return Response(ProductSerializer(product).data)

    @action(detail=False, methods=["get"], url_path="pos-barcode-lookup")
    def pos_barcode_lookup(self, request):
        code = _clean_text(request.query_params.get("code"))
        if not code:
            return Response({"detail": "Barcode is required."}, status=400)
        product = self.get_queryset().filter(barcode=code).first()
        if not product:
            return Response({"detail": "Product not found."}, status=404)
        return Response(ProductSerializer(product).data)

    @action(detail=False, methods=["get"], url_path="pos-catalog")
    def pos_catalog(self, request):
        """Paginated catalog for terminal startup and incremental refresh."""
        queryset = Product.objects.filter(user=request.user, is_deleted=False).select_related("branch", "category").order_by("id")
        if request.query_params.get("available_only", "true").lower() == "true":
            queryset = queryset.filter(stock__gt=0)
        branch = request.query_params.get("branch")
        if branch:
            queryset = queryset.filter(models.Q(branch__isnull=True) | models.Q(branch_id=branch))
        queryset = scope_queryset_to_staff_branch(request, queryset)
        updated_since = request.query_params.get("updated_since")
        if updated_since:
            queryset = queryset.filter(updated_at__gte=updated_since)
        page = self.paginate_queryset(queryset)
        serializer = ProductSerializer(page if page is not None else queryset, many=True)
        return self.get_paginated_response(serializer.data) if page is not None else Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="barcode-identify")
    def barcode_identify(self, request):
        enforce_feature(request.user, "barcode_scanning")
        code = _clean_text(request.query_params.get("code"))
        if not code:
            return Response({"detail": "Barcode is required."}, status=400)

        existing = self.get_queryset().filter(barcode=code).first()
        if existing:
            return Response({
                "barcode": code,
                "name": existing.name,
                "brand": existing.preferred_supplier.name if existing.preferred_supplier else "",
                "category": existing.category.name if existing.category else "",
                "source": "inventory",
                "existing_product_id": existing.id,
            })

        cached = BarcodeLookupCache.objects.filter(barcode=code, is_deleted=False).first()
        if cached:
            return Response({
                "barcode": code,
                "name": cached.name,
                "brand": cached.brand,
                "category": cached.category,
                "source": f"{cached.source}_cache",
            })

        request_failed = False
        for source, url in BARCODE_IDENTIFICATION_SOURCES:
            try:
                response = httpx.get(
                    url.format(barcode=code),
                    params={"fields": "product_name,product_name_en,generic_name,generic_name_en,brands,categories,categories_tags"},
                    timeout=5.0,
                    headers={"User-Agent": "Verifin/1.0 barcode-identify"},
                )
                response.raise_for_status()
                payload = response.json()
            except httpx.HTTPError:
                request_failed = True
                continue

            if payload.get("status") != 1:
                continue

            identity = _extract_product_identity(payload, code, source)
            if identity["name"]:
                _cache_identity(identity)
                return Response(identity)

        if request_failed:
            return Response({"detail": "Could not identify this barcode right now."}, status=502)
        return Response({"detail": "Product not found for this barcode."}, status=404)

    @action(detail=False, methods=["post"], url_path="bulk-import")
    def bulk_import(self, request):
        enforce_feature(request.user, "bulk_import_export")
        enforce_limit(request.user, "products", increment=len(request.data.get("items", [])))
        created = []
        for row in request.data.get("items", []):
            serializer = ProductSerializer(data=row, context={"request": request})
            serializer.is_valid(raise_exception=True)
            if serializer.validated_data.get("stock", 0) > 0:
                require_approval_if_over_threshold(
                    request, "stock_adjustment_units_threshold", serializer.validated_data["stock"], "inventory.adjust"
                )
            product = serializer.save(user=request.user)
            if product.stock > 0:
                StockMovement.objects.create(
                    product=product,
                    quantity=product.stock,
                    movement_type="in",
                    reason="Opening stock import",
                    created_by=request.user,
                )
            log_staff_activity(
                request.user, "product_created", f"Imported product {product.name}",
                actor=request.user, request=request, object_type="product", object_id=product.id,
                metadata={"after": {"name": product.name, "sku": product.sku, "stock": product.stock,
                                    "price": str(product.price), "cost_price": str(product.cost_price),
                                    "branch_id": product.branch_id}},
            )
            created.append(serializer.data)
        return Response({"created": created})

    @action(detail=False, methods=["get"], url_path="inventory-value")
    def inventory_value(self, request):
        products = self.get_queryset()
        total_value = sum([p.stock * p.price for p in products])
        total_cost = sum([p.stock * p.cost_price for p in products])
        return Response({
            "inventory_value": total_value,
            "inventory_cost": total_cost,
            "potential_profit": total_value - total_cost,
            "currency": request.user.currency,
        })

    @action(detail=False, methods=["get"], url_path="low-stock")
    def low_stock(self, request):
        products = self.get_queryset().filter(status__in=["low", "out"])
        return Response(ProductSerializer(products, many=True).data)

    @action(detail=False, methods=["post"], url_path="add-item")
    def add_item(self, request):
        enforce_limit(request.user, "products")
        # Expects: name, stock, price, sku (optional), category (optional)
        name = request.data.get("name")
        stock = serializers.IntegerField(min_value=0).run_validation(request.data.get("stock", 0))
        price = request.data.get("price")
        sku = request.data.get("sku", "")
        category_id = request.data.get("category")
        if not name or price is None:
            return Response({"detail": "Name and price are required."}, status=400)
        if stock > 0:
            require_approval_if_over_threshold(
                request, "stock_adjustment_units_threshold", stock, "inventory.adjust"
            )
        category = None
        if category_id:
            try:
                category = Category.objects.get(id=category_id, user=request.user)
            except Category.DoesNotExist:
                return Response({"detail": "Category not found."}, status=404)
        branch = None
        branch_id = request.data.get("branch")
        staff = get_staff_member(request)
        if staff:
            if not staff.branch_id:
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("This staff account must be assigned to a branch.")
            if branch_id and str(branch_id) != str(staff.branch_id):
                from rest_framework.exceptions import PermissionDenied
                raise PermissionDenied("Products must be assigned to your authorised branch.")
            branch_id = staff.branch_id
        if branch_id:
            try:
                branch = Branch.objects.get(id=branch_id, user=request.user, is_deleted=False)
            except Branch.DoesNotExist:
                return Response({"detail": "Branch not found."}, status=404)
        product = Product.objects.create(
            user=request.user,
            name=name,
            stock=stock,
            price=price,
            cost_price=request.data.get("cost_price", 0),
            sku=sku,
            category=category,
            branch=branch,
        )
        if product.stock > 0:
            StockMovement.objects.create(
                product=product,
                quantity=product.stock,
                movement_type="in",
                reason="Opening stock",
                created_by=request.user,
            )
        log_staff_activity(
            request.user, "product_created", f"Created product {product.name}",
            actor=request.user, request=request, object_type="product", object_id=product.id,
            metadata={"after": {"name": product.name, "sku": product.sku, "stock": product.stock,
                                "price": str(product.price), "cost_price": str(product.cost_price),
                                "branch_id": product.branch_id}},
        )
        return Response(ProductSerializer(product).data)

    @action(detail=False, methods=["get"], url_path="forecast")
    def forecast(self, request):
        enforce_feature(request.user, "forecasting")
        horizon = int(request.query_params.get("days", 7))
        horizon = max(horizon, 1)
        since = timezone.localdate() - timedelta(days=horizon)
        rows = []
        for product in self.get_queryset():
            sold = SaleItem.objects.filter(
                product=product,
                sale__created_by=request.user,
                sale__date__gte=since,
                is_deleted=False,
            ).aggregate(total=Sum("quantity"))["total"] or 0
            average_daily_sales = Decimal(sold) / Decimal(horizon)
            days_remaining = None
            if average_daily_sales > 0:
                days_remaining = Decimal(product.stock) / average_daily_sales
            suggested_reorder = max(0, int((average_daily_sales * Decimal(horizon * 2)) - product.stock))
            rows.append({
                "product": ProductSerializer(product).data,
                "sold_in_period": sold,
                "average_daily_sales": float(round(average_daily_sales, 2)),
                "days_remaining": float(round(days_remaining, 1)) if days_remaining is not None else None,
                "suggested_reorder": suggested_reorder,
                "risk": "stockout" if product.stock <= 0 else "high" if days_remaining is not None and days_remaining <= horizon else "low",
            })
        rows.sort(key=lambda item: (item["risk"] != "stockout", item["risk"] != "high", item["days_remaining"] is None, item["days_remaining"] or 9999))
        return Response({"horizon_days": horizon, "items": rows})

    @action(detail=False, methods=["get"], url_path="smart-reorder")
    def smart_reorder(self, request):
        enforce_feature(request.user, "reorder_suggestions")
        sales_window = max(int(request.query_params.get("sales_window", 30)), 1)
        cover_days = max(int(request.query_params.get("cover_days", 21)), 1)
        since = timezone.localdate() - timedelta(days=sales_window)
        rows = []

        for product in self.get_queryset().select_related("preferred_supplier", "branch", "category"):
            sold = SaleItem.objects.filter(
                product=product,
                sale__created_by=request.user,
                sale__date__gte=since,
                is_deleted=False,
            ).aggregate(total=Sum("quantity"))["total"] or 0
            average_daily_sales = Decimal(sold) / Decimal(sales_window)
            supplier = product.preferred_supplier
            lead_time = supplier.lead_time_days if supplier else 7
            safety_days = 7
            target_stock = max(
                Decimal(product.reorder_level * 2),
                average_daily_sales * Decimal(lead_time + cover_days + safety_days),
            )
            suggested_quantity = max(0, int(target_stock) - product.stock)
            days_remaining = None
            if average_daily_sales > 0:
                days_remaining = Decimal(product.stock) / average_daily_sales
            reorder_in_days = None if days_remaining is None else float(days_remaining) - lead_time

            if product.stock <= 0 or (reorder_in_days is not None and reorder_in_days <= 0):
                urgency = "critical"
            elif product.stock <= product.reorder_level or (reorder_in_days is not None and reorder_in_days <= 7):
                urgency = "high"
            elif suggested_quantity > 0:
                urgency = "watch"
            else:
                urgency = "healthy"

            if urgency == "healthy":
                continue
            rows.append({
                "product": ProductSerializer(product).data,
                "supplier": SupplierSerializer(supplier).data if supplier else None,
                "sold_in_period": sold,
                "sales_window_days": sales_window,
                "cover_days": cover_days,
                "average_daily_sales": float(round(average_daily_sales, 2)),
                "days_remaining": float(round(days_remaining, 1)) if days_remaining is not None else None,
                "lead_time_days": lead_time,
                "reorder_in_days": round(reorder_in_days, 1) if reorder_in_days is not None else None,
                "suggested_quantity": suggested_quantity,
                "estimated_cost": suggested_quantity * product.cost_price,
                "urgency": urgency,
            })

        priority = {"critical": 0, "high": 1, "watch": 2}
        rows.sort(key=lambda item: (priority.get(item["urgency"], 9), item["reorder_in_days"] is None, item["reorder_in_days"] or 9999))
        return Response({"items": rows})

    @action(detail=True, methods=["post"], url_path="transfer")
    @transaction.atomic
    def transfer(self, request, pk=None):
        enforce_feature(request.user, "multi_branch")
        payload = {**request.data, "product": self.get_object().pk}
        transfer, created = create_transfer_request(request, payload)
        return Response({
            "transfer": StockTransferSerializer(transfer).data,
            "source": ProductSerializer(transfer.product).data,
            "target": ProductSerializer(transfer.target_product).data if transfer.target_product else None,
        }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class StockMovementViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "head", "options"]
    serializer_class = StockMovementSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["movement_type", "product"]

    def get_queryset(self):
        queryset = StockMovement.objects.filter(created_by=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset, "product__branch_id")

    @transaction.atomic
    def perform_create(self, serializer):
        from rest_framework.exceptions import ValidationError
        product = Product.objects.select_for_update().get(pk=serializer.validated_data["product"].pk)
        stock_before = product.stock
        quantity = serializer.validated_data["quantity"]
        movement_type = serializer.validated_data["movement_type"]
        adjustment_size = abs(quantity - stock_before) if movement_type == "adjustment" else quantity
        require_approval_if_over_threshold(
            self.request, "stock_adjustment_units_threshold", adjustment_size, "inventory.adjust"
        )
        batch = serializer.validated_data.get("batch")
        if batch and batch.product_id != product.id:
            raise ValidationError({"batch": "Batch does not belong to this product."})
        if batch and movement_type != "adjustment":
            raise ValidationError({"batch": "Use a batch adjustment to change a specific batch."})
        batch_delta = quantity - batch.quantity_remaining if batch else 0
        if batch and product.stock + batch_delta < 0:
            raise ValidationError({"quantity": "Batch adjustment cannot create negative product stock."})
        if quantity < 0 or (movement_type == "out" and product.stock < quantity):
            raise ValidationError("Stock movements cannot create negative stock.")
        movement = serializer.save(
            created_by=self.request.user,
            quantity=batch_delta if batch else quantity,
        )
        if batch:
            batch.quantity_remaining = quantity
            batch.quantity_received = max(batch.quantity_received, quantity)
            batch.save(update_fields=["quantity_remaining", "quantity_received", "updated_at"])
            product.stock += batch_delta
        elif movement.movement_type == "in":
            product.stock += movement.quantity
        elif movement.movement_type == "out":
            batched_quantity = ProductBatch.objects.filter(
                product=product,
                is_deleted=False,
            ).aggregate(total=Sum("quantity_remaining"))["total"] or 0
            if product.stock - quantity < batched_quantity:
                raise ValidationError({"quantity": "Adjust tracked batches individually before reducing this product's total stock."})
            product.stock -= movement.quantity
        else:
            batched_quantity = ProductBatch.objects.filter(
                product=product,
                is_deleted=False,
            ).aggregate(total=Sum("quantity_remaining"))["total"] or 0
            if quantity < batched_quantity:
                raise ValidationError({"quantity": "Product stock cannot be set below the quantity in tracked batches."})
            product.stock = movement.quantity
        product.save()
        action_name = "stock_adjusted" if movement.movement_type == "adjustment" else "stock_movement_recorded"
        log_staff_activity(
            self.request.user,
            action_name,
            f"{movement.get_movement_type_display()} movement for {product.name}: {stock_before} to {product.stock}",
            actor=self.request.user,
            request=self.request,
            object_type="stock_movement",
            object_id=movement.id,
            metadata={
                "product_id": product.id,
                "movement_type": movement.movement_type,
                "quantity": movement.quantity,
                "before": {"stock": stock_before},
                "after": {"stock": product.stock},
                "reason": movement.reason,
            },
        )


class ProductBatchViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ProductBatchSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["product", "supplier"]
    search_fields = ["batch_number", "product__name", "product__sku", "supplier__name"]

    def get_queryset(self):
        queryset = ProductBatch.objects.filter(
            product__user=self.request.user,
            is_deleted=False,
            product__is_deleted=False,
        ).select_related("product", "supplier").order_by("expiry_date", "received_at", "id")
        return scope_queryset_to_staff_branch(self.request, queryset, "product__branch_id")

    @action(detail=False, methods=["post"], url_path="receive")
    @transaction.atomic
    def receive(self, request):
        from rest_framework.exceptions import ValidationError

        serializer = ProductBatchSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        product = Product.objects.select_for_update().get(
            pk=serializer.validated_data["product"].pk,
            user=request.user,
            is_deleted=False,
        )
        if ProductBatch.objects.filter(product=product, batch_number=serializer.validated_data["batch_number"]).exists():
            raise ValidationError({"batch_number": "This batch number is already recorded for the product."})
        quantity = serializer.validated_data["quantity_received"]
        batch = serializer.save(quantity_remaining=quantity)
        product.stock += quantity
        product.save()
        StockMovement.objects.create(
            product=product,
            batch=batch,
            quantity=quantity,
            movement_type="in",
            reason=f"Received batch {batch.batch_number}",
            created_by=request.user,
        )
        return Response(ProductBatchSerializer(batch, context={"request": request}).data, status=status.HTTP_201_CREATED)


class StockTransferViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "head", "options"]
    serializer_class = StockTransferSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["from_branch", "to_branch", "product"]

    def get_queryset(self):
        queryset = StockTransfer.objects.filter(
            created_by=self.request.user,
            is_deleted=False,
        ).select_related("from_branch", "to_branch", "product", "target_product", "batch")
        staff = get_staff_member(self.request)
        if staff:
            if not staff.branch_id:
                return queryset.none()
            queryset = queryset.filter(
                models.Q(from_branch_id=staff.branch_id) | models.Q(to_branch_id=staff.branch_id)
            )
        return queryset.prefetch_related("events")

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        enforce_feature(request.user, "multi_branch")
        transfer, created = create_transfer_request(request, request.data)
        return Response(
            self.get_serializer(transfer).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    def _locked_transfer(self, pk):
        transfer_id = self.get_object().pk
        return StockTransfer.objects.select_for_update().select_related(
            "from_branch", "to_branch", "product", "target_product", "batch"
        ).get(pk=transfer_id, is_deleted=False)

    @staticmethod
    def _event(transfer, action_name, request, quantity=0, note="", before=None):
        if len(note) > 255:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"note": "Ensure this field has no more than 255 characters."})
        StockTransferEvent.objects.create(
            transfer=transfer,
            action=action_name,
            quantity=quantity,
            note=note,
            created_by=request.user,
        )
        log_staff_activity(
            request.user,
            f"stock_transfer_{action_name}",
            f"Stock transfer {transfer.id} {action_name}",
            actor=request.user,
            request=request,
            object_type="stock_transfer",
            object_id=transfer.id,
            metadata={
                "before": before or {},
                "after": {
                    "status": transfer.status,
                    "quantity": transfer.quantity,
                    "quantity_dispatched": transfer.quantity_dispatched,
                    "quantity_received": transfer.quantity_received,
                    "quantity_discrepant": transfer.quantity_discrepant,
                    "quantity_in_transit": transfer.quantity_in_transit,
                },
                "event_quantity": quantity,
                "note": note,
            },
        )

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def approve(self, request, pk=None):
        enforce_feature(request.user, "multi_branch")
        transfer = self._locked_transfer(pk)
        require_staff_branch(request, transfer.to_branch_id)
        if transfer.status != StockTransfer.STATUS_REQUESTED:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"status": "Only requested transfers can be approved."})
        before = {"status": transfer.status, "quantity_dispatched": transfer.quantity_dispatched,
                  "quantity_received": transfer.quantity_received, "quantity_discrepant": transfer.quantity_discrepant}
        transfer.status = StockTransfer.STATUS_APPROVED
        transfer.approved_by = request.user
        transfer.approved_at = timezone.now()
        transfer.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
        self._event(transfer, "approved", request, note=str(request.data.get("note", "")), before=before)
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def reject(self, request, pk=None):
        enforce_feature(request.user, "multi_branch")
        transfer = self._locked_transfer(pk)
        require_staff_branch(request, transfer.to_branch_id)
        if transfer.status != StockTransfer.STATUS_REQUESTED:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"status": "Only requested transfers can be rejected."})
        before = {"status": transfer.status, "quantity_dispatched": transfer.quantity_dispatched,
                  "quantity_received": transfer.quantity_received, "quantity_discrepant": transfer.quantity_discrepant}
        transfer.status = StockTransfer.STATUS_REJECTED
        transfer.save(update_fields=["status", "updated_at"])
        self._event(transfer, "rejected", request, note=str(request.data.get("note", "")), before=before)
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def cancel(self, request, pk=None):
        enforce_feature(request.user, "multi_branch")
        transfer = self._locked_transfer(pk)
        require_staff_branch(request, transfer.from_branch_id)
        if transfer.status not in (StockTransfer.STATUS_REQUESTED, StockTransfer.STATUS_APPROVED):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"status": "A transfer can only be cancelled before dispatch."})
        before = {"status": transfer.status, "quantity_dispatched": transfer.quantity_dispatched,
                  "quantity_received": transfer.quantity_received, "quantity_discrepant": transfer.quantity_discrepant}
        transfer.status = StockTransfer.STATUS_CANCELLED
        transfer.save(update_fields=["status", "updated_at"])
        self._event(transfer, "cancelled", request, note=str(request.data.get("note", "")), before=before)
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"], url_path="dispatch")
    @transaction.atomic
    def dispatch_transfer(self, request, pk=None):
        enforce_feature(request.user, "multi_branch")
        transfer = self._locked_transfer(pk)
        require_staff_branch(request, transfer.from_branch_id)
        if transfer.status not in (
            StockTransfer.STATUS_APPROVED,
            StockTransfer.STATUS_DISPATCHED,
            StockTransfer.STATUS_PARTIALLY_RECEIVED,
        ):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"status": "Only approved transfers can be dispatched."})
        try:
            quantity = int(request.data.get("quantity", 0))
        except (TypeError, ValueError):
            quantity = 0
        if quantity <= 0 or quantity > transfer.quantity - transfer.quantity_dispatched:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"quantity": "Dispatch quantity must be positive and no greater than the undelivered request."})

        product = Product.objects.select_for_update().get(
            pk=transfer.product_id, user=request.user, is_deleted=False
        )
        batch = None
        batches = ProductBatch.objects.filter(product=product, is_deleted=False)
        if batches.exists():
            if transfer.batch_id:
                batch = batches.select_for_update().filter(pk=transfer.batch_id).first()
                if batch is None or batch.quantity_remaining < quantity:
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({"quantity": "The selected batch no longer has enough stock."})
            else:
                tracked_quantity = batches.aggregate(total=Sum("quantity_remaining"))["total"] or 0
                if product.stock - tracked_quantity < quantity:
                    from rest_framework.exceptions import ValidationError
                    raise ValidationError({"quantity": "Select a tracked batch before dispatching this quantity."})
        if product.stock < quantity:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"quantity": "Insufficient source stock for dispatch."})

        before = {"status": transfer.status, "quantity_dispatched": transfer.quantity_dispatched,
                  "quantity_received": transfer.quantity_received, "quantity_discrepant": transfer.quantity_discrepant,
                  "source_stock": product.stock}
        previous_source_status = product.status
        product.stock -= quantity
        product.save(update_fields=["stock", "status", "updated_at"])
        if batch:
            batch.quantity_remaining -= quantity
            batch.save(update_fields=["quantity_remaining", "updated_at"])

        target = transfer.target_product
        if target is None:
            target, _ = Product.objects.get_or_create(
                user=request.user,
                branch=transfer.to_branch,
                sku=product.sku,
                defaults={
                    "name": product.name,
                    "barcode": product.barcode,
                    "preferred_supplier_id": product.preferred_supplier_id,
                    "category_id": product.category_id,
                    "stock": 0,
                    "reorder_level": product.reorder_level,
                    "cost_price": product.cost_price,
                    "cost_currency": product.cost_currency,
                    "cost_fx_rate_to_base": product.cost_fx_rate_to_base,
                    "price": product.price,
                },
            )
            if target.is_deleted:
                from rest_framework.exceptions import ValidationError
                raise ValidationError({"product": "The destination already has a deleted product with this SKU."})
        target = Product.objects.select_for_update().get(pk=target.pk, is_deleted=False)
        previous_target_status = target.status
        transfer.target_product = target
        transfer.quantity_dispatched += quantity
        transfer.dispatched_by = request.user
        transfer.dispatched_at = transfer.dispatched_at or timezone.now()
        if transfer.quantity_received or transfer.quantity_discrepant:
            transfer.status = StockTransfer.STATUS_PARTIALLY_RECEIVED
        elif transfer.quantity_dispatched:
            transfer.status = StockTransfer.STATUS_DISPATCHED
        transfer.save(update_fields=[
            "target_product", "quantity_dispatched", "dispatched_by",
            "dispatched_at", "status", "updated_at",
        ])
        StockMovement.objects.create(
            product=product,
            batch=batch,
            quantity=quantity,
            movement_type="out",
            reason=f"Branch transfer {transfer.id} dispatched",
            created_by=request.user,
        )
        before["source_stock"] = product.stock + quantity
        self._event(transfer, "dispatched", request, quantity, str(request.data.get("note", "")), before=before)
        from accounts.webhooks import enqueue_product_stock_event
        enqueue_product_stock_event(request.user, product, previous_source_status)
        enqueue_product_stock_event(request.user, target, previous_target_status)
        return Response(self.get_serializer(transfer).data)

    @action(detail=True, methods=["post"])
    @transaction.atomic
    def receive(self, request, pk=None):
        enforce_feature(request.user, "multi_branch")
        transfer = self._locked_transfer(pk)
        require_staff_branch(request, transfer.to_branch_id)
        if transfer.status not in (
            StockTransfer.STATUS_DISPATCHED,
            StockTransfer.STATUS_PARTIALLY_RECEIVED,
        ):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"status": "Only dispatched transfers can be received."})
        try:
            quantity = int(request.data.get("quantity", 0))
            discrepant_quantity = int(request.data.get("discrepant_quantity", 0))
        except (TypeError, ValueError):
            quantity = discrepant_quantity = 0
        remaining = transfer.quantity_in_transit
        if quantity < 0 or discrepant_quantity < 0 or quantity + discrepant_quantity <= 0 or quantity + discrepant_quantity > remaining:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"quantity": "Received and discrepant quantities must account for a positive amount currently in transit."})

        target = Product.objects.select_for_update().get(
            pk=transfer.target_product_id, user=request.user, is_deleted=False
        )
        before = {"status": transfer.status, "quantity_dispatched": transfer.quantity_dispatched,
                  "quantity_received": transfer.quantity_received, "quantity_discrepant": transfer.quantity_discrepant,
                  "destination_stock": target.stock}
        previous_target_status = target.status
        if quantity:
            target.stock += quantity
            target.save(update_fields=["stock", "status", "updated_at"])
            target_batch = None
            if transfer.batch_id:
                source_batch = ProductBatch.objects.get(pk=transfer.batch_id)
                target_batch = ProductBatch.objects.select_for_update().filter(
                    product=target,
                    batch_number=source_batch.batch_number,
                ).first()
                if target_batch and target_batch.is_deleted:
                    target_batch.is_deleted = False
                if target_batch:
                    target_batch.quantity_received += quantity
                    target_batch.quantity_remaining += quantity
                    target_batch.expiry_date = source_batch.expiry_date
                    target_batch.unit_cost_base = source_batch.unit_cost_base
                    target_batch.supplier = source_batch.supplier
                    target_batch.save(update_fields=[
                        "is_deleted", "quantity_received", "quantity_remaining",
                        "expiry_date", "unit_cost_base", "supplier", "updated_at",
                    ])
                else:
                    target_batch = ProductBatch.objects.create(
                        product=target,
                        batch_number=source_batch.batch_number,
                        expiry_date=source_batch.expiry_date,
                        quantity_received=quantity,
                        quantity_remaining=quantity,
                        unit_cost_base=source_batch.unit_cost_base,
                        supplier=source_batch.supplier,
                    )
            StockMovement.objects.create(
                product=target,
                batch=target_batch,
                quantity=quantity,
                movement_type="in",
                reason=f"Branch transfer {transfer.id} received",
                created_by=request.user,
            )

        transfer.quantity_received += quantity
        transfer.quantity_discrepant += discrepant_quantity
        transfer.received_by = request.user
        transfer.discrepancy_note = str(request.data.get("discrepancy_note", "")) if discrepant_quantity else transfer.discrepancy_note
        if len(transfer.discrepancy_note) > 255:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"discrepancy_note": "Ensure this field has no more than 255 characters."})
        if (
            transfer.quantity_dispatched == transfer.quantity
            and transfer.quantity_received + transfer.quantity_discrepant == transfer.quantity_dispatched
        ):
            transfer.status = StockTransfer.STATUS_COMPLETED
            transfer.received_at = timezone.now()
        else:
            transfer.status = StockTransfer.STATUS_PARTIALLY_RECEIVED
        transfer.save(update_fields=[
            "quantity_received", "quantity_discrepant", "received_by",
            "discrepancy_note", "status", "received_at", "updated_at",
        ])
        event_note = str(request.data.get("note", "")) or transfer.discrepancy_note
        before["destination_stock"] = target.stock - quantity
        self._event(transfer, "received", request, quantity + discrepant_quantity, event_note, before=before)
        if quantity:
            from accounts.webhooks import enqueue_product_stock_event
            enqueue_product_stock_event(request.user, target, previous_target_status)
        return Response(self.get_serializer(transfer).data)


class SupplierViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated]
    search_fields = ["name", "contact_name", "phone", "email"]

    def get_queryset(self):
        queryset = Supplier.objects.filter(user=self.request.user, is_deleted=False)
        staff = get_staff_member(self.request)
        if staff:
            if not staff.branch_id:
                return queryset.none()
            queryset = queryset.filter(
                models.Q(products__branch_id=staff.branch_id)
                | models.Q(purchase_orders__branch_id=staff.branch_id)
            ).distinct()
        return queryset

    def perform_create(self, serializer):
        supplier = serializer.save(user=self.request.user)
        log_staff_activity(self.request.user, "supplier_created", f"Created supplier {supplier.name}", actor=self.request.user, request=self.request, object_type="supplier", object_id=supplier.id, metadata={"after": {"name": supplier.name, "phone": supplier.phone, "email": supplier.email}})

    def perform_update(self, serializer):
        supplier = serializer.instance
        before = {"name": supplier.name, "phone": supplier.phone, "email": supplier.email, "payment_terms_days": supplier.payment_terms_days}
        supplier = serializer.save()
        after = {"name": supplier.name, "phone": supplier.phone, "email": supplier.email, "payment_terms_days": supplier.payment_terms_days}
        log_staff_activity(self.request.user, "supplier_updated", f"Updated supplier {supplier.name}", actor=self.request.user, request=self.request, object_type="supplier", object_id=supplier.id, metadata={"before": before, "after": after})

    def perform_destroy(self, instance):
        name = instance.name
        instance.is_deleted = True
        instance.save()
        log_staff_activity(self.request.user, "supplier_deleted", f"Deleted supplier {name}", actor=self.request.user, request=self.request, object_type="supplier", object_id=instance.id, metadata={"before": {"name": name, "phone": instance.phone, "email": instance.email}, "after": {"is_deleted": True}})

    @action(detail=False, methods=["get"], url_path="scorecards")
    def scorecards(self, request):
        enforce_feature(request.user, "advanced_reports")
        cards = []
        for supplier in self.get_queryset().annotate(product_count=Count("products")):
            orders = PurchaseOrder.objects.filter(user=request.user, supplier=supplier, is_deleted=False)
            open_orders = orders.exclude(
                status__in=[
                    PurchaseOrder.STATUS_FULLY_RECEIVED,
                    PurchaseOrder.STATUS_COMPLETED,
                    PurchaseOrder.STATUS_CANCELLED,
                ]
            ).count()
            received_items = GoodsReceivedNoteItem.objects.filter(
                goods_received_note__user=request.user,
                goods_received_note__purchase_order__supplier=supplier,
                goods_received_note__status=GoodsReceivedNote.STATUS_CONFIRMED,
                is_deleted=False,
            )
            total_spend = received_items.aggregate(total=Sum("total_cost_base"))["total"] or 0
            delivered_quantity = received_items.aggregate(total=Sum("quantity_delivered"))["total"] or 0
            accepted_quantity = PurchaseCostHistory.objects.filter(
                supplier=supplier, is_deleted=False
            ).aggregate(total=Sum("quantity"))["total"] or 0
            damaged_quantity = received_items.aggregate(total=Sum("quantity_damaged"))["total"] or 0
            ordered_quantity = PurchaseOrderItem.objects.filter(
                purchase_order__in=orders, is_deleted=False
            ).aggregate(total=Sum("quantity_ordered"))["total"] or 0
            expected_receipts = GoodsReceivedNote.objects.filter(
                user=request.user,
                purchase_order__supplier=supplier,
                purchase_order__expected_date__isnull=False,
                status=GoodsReceivedNote.STATUS_CONFIRMED,
                is_deleted=False,
            )
            expected_count = expected_receipts.count()
            on_time_count = expected_receipts.filter(
                delivery_date__lte=models.F("purchase_order__expected_date")
            ).count()
            delivery_performance = (
                round(on_time_count * 100 / expected_count, 1) if expected_count else None
            )
            fill_rate = round(accepted_quantity * 100 / ordered_quantity, 1) if ordered_quantity else None
            damage_rate = round(damaged_quantity * 100 / delivered_quantity, 1) if delivered_quantity else 0
            low_stock_count = Product.objects.filter(
                user=request.user,
                preferred_supplier=supplier,
                status__in=["low", "out"],
                is_deleted=False,
            ).count()
            cards.append({
                "supplier": SupplierSerializer(supplier).data,
                "product_count": supplier.product_count,
                "open_purchase_orders": open_orders,
                "low_stock_products": low_stock_count,
                "total_spend": total_spend,
                "lead_time_days": supplier.lead_time_days,
                "payment_terms_days": supplier.payment_terms_days,
                "reliability_score": supplier.reliability_score,
                "health": "strong" if supplier.reliability_score >= 80 and low_stock_count <= 1 else "watch" if supplier.reliability_score >= 60 else "risk",
                "on_time_delivery_percent": delivery_performance,
                "fill_rate_percent": fill_rate,
                "damaged_delivery_percent": damage_rate,
            })
        cards.sort(key=lambda row: (row["health"] == "strong", -row["low_stock_products"], -row["open_purchase_orders"]))
        return Response({"items": cards})

    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, pk=None):
        supplier = self.get_object()
        orders = PurchaseOrder.objects.filter(
            user=request.user, supplier=supplier, is_deleted=False
        ).prefetch_related("items", "events")
        returns = SupplierReturn.objects.filter(
            user=request.user, supplier=supplier, is_deleted=False
        ).prefetch_related("items")
        payments = SupplierPayment.objects.filter(
            user=request.user, supplier=supplier, is_deleted=False
        ).order_by("-payment_date", "-id")
        products = Product.objects.filter(
            user=request.user, preferred_supplier=supplier, is_deleted=False
        ).order_by("name")
        costs = PurchaseCostHistory.objects.filter(
            product__user=request.user, supplier=supplier, is_deleted=False
        ).select_related(
            "product", "supplier", "purchase_order", "goods_received_note_item__goods_received_note"
        )
        return Response({
            "supplier": SupplierSerializer(supplier, context={"request": request}).data,
            "products": ProductSerializer(products, many=True, context={"request": request}).data,
            "purchase_orders": LifecyclePurchaseOrderSerializer(
                orders, many=True, context={"request": request}
            ).data,
            "payments": PurchasingSupplierPaymentSerializer(
                payments, many=True, context={"request": request}
            ).data,
            "returns": SupplierReturnSerializer(returns, many=True, context={"request": request}).data,
            "purchase_cost_history": PurchaseCostHistorySerializer(
                costs, many=True, context={"request": request}
            ).data,
        })

    @action(detail=True, methods=["get"], url_path="statement")
    def statement(self, request, pk=None):
        supplier = self.get_object()
        orders = PurchaseOrder.objects.filter(
            user=request.user,
            supplier=supplier,
            is_deleted=False,
        ).select_related("branch").prefetch_related("items").order_by("created_at", "id")
        orders = scope_queryset_to_staff_branch(request, orders)
        order_rows = list(orders)
        order_ids = [order.id for order in order_rows]
        orders_by_id = {order.id: order for order in order_rows}

        activity = []
        receipt_totals = {}
        receipt_groups = GoodsReceivedNoteItem.objects.filter(
            goods_received_note__purchase_order_id__in=order_ids,
            goods_received_note__status=GoodsReceivedNote.STATUS_CONFIRMED,
            goods_received_note__is_deleted=False,
            is_deleted=False,
        ).values(
            "goods_received_note__purchase_order_id",
            "goods_received_note_id",
            "goods_received_note__grn_number",
            "goods_received_note__delivery_date",
        ).annotate(total=Sum("total_cost_base"))
        for row in receipt_groups:
            order_id = row["goods_received_note__purchase_order_id"]
            amount = row["total"] or Decimal("0")
            activity.append({
                "date": row["goods_received_note__delivery_date"],
                "type": "invoice",
                "reference": row["goods_received_note__grn_number"],
                "description": f"Goods received against {orders_by_id[order_id].order_number}",
                "amount_base": amount,
                "order_id": order_id,
                "sort_id": row["goods_received_note_id"],
            })

        # Include older receipts that predate GRNs, including when an order later received a GRN.
        for order in order_rows:
            receipt_data = get_purchase_order_received_totals_base(order)
            receipt_totals[order.id] = receipt_data["received_total_base"]
            fallback_total = receipt_data["legacy_total_base"]
            if fallback_total:
                activity.append({
                    "date": order.invoice_date or order.created_at.date(),
                    "type": "invoice",
                    "reference": order.supplier_invoice_number or order.order_number,
                    "description": f"Received goods against {order.order_number}",
                    "amount_base": fallback_total,
                    "order_id": order.id,
                    "sort_id": order.id,
                })

        return_groups = SupplierReturnItem.objects.filter(
            supplier_return__user=request.user,
            supplier_return__supplier=supplier,
            supplier_return__purchase_order_id__in=order_ids,
            supplier_return__is_deleted=False,
            is_deleted=False,
        ).values(
            "supplier_return_id",
            "supplier_return__purchase_order_id",
            "supplier_return__return_date",
            "supplier_return__reference",
            "supplier_return__reason",
        ).annotate(total=Sum("total_amount_base"))
        return_totals = {}
        for row in return_groups:
            order_id = row["supplier_return__purchase_order_id"]
            amount = row["total"] or Decimal("0")
            return_totals[order_id] = return_totals.get(order_id, Decimal("0")) + amount
            activity.append({
                "date": row["supplier_return__return_date"],
                "type": "return",
                "reference": row["supplier_return__reference"] or f"Return #{row['supplier_return_id']}",
                "description": f"Supplier return ({row['supplier_return__reason']})",
                "amount_base": -amount,
                "order_id": order_id,
                "sort_id": row["supplier_return_id"],
            })

        payment_rows = SupplierPayment.objects.filter(
            user=request.user,
            supplier=supplier,
            purchase_order_id__in=order_ids,
            is_deleted=False,
        ).select_related("purchase_order").order_by("payment_date", "id")
        payment_totals = {}
        for payment in payment_rows:
            payment_totals[payment.purchase_order_id] = (
                payment_totals.get(payment.purchase_order_id, Decimal("0")) + payment.amount_base
            )
            activity.append({
                "date": payment.payment_date,
                "type": "payment",
                "reference": payment.reference or f"Payment #{payment.id}",
                "description": f"Payment against {payment.purchase_order.order_number}",
                "amount_base": -payment.amount_base,
                "order_id": payment.purchase_order_id,
                "sort_id": payment.id,
            })

        invoices = []
        for order in order_rows:
            received = receipt_totals.get(order.id, Decimal("0"))
            returned = return_totals.get(order.id, Decimal("0"))
            paid = payment_totals.get(order.id, Decimal("0"))
            outstanding = received - returned - paid
            if not received and not returned and not paid:
                continue
            invoice_number = order.supplier_invoice_number or order.order_number
            invoice_date = order.invoice_date
            if not invoice_date:
                first_receipt = next((row["date"] for row in activity if row["order_id"] == order.id and row["type"] == "invoice"), None)
                invoice_date = first_receipt or order.created_at.date()
            status_value = "overdue" if order.due_date and order.due_date < timezone.localdate() and outstanding > 0 else "open" if outstanding > 0 else "settled"
            invoices.append({
                "purchase_order": order.id,
                "order_number": order.order_number,
                "invoice_number": invoice_number,
                "invoice_date": invoice_date,
                "due_date": order.due_date,
                "received_total_base": received,
                "returned_total_base": returned,
                "paid_total_base": paid,
                "outstanding_base": outstanding,
                "status": status_value,
            })

        activity.sort(key=lambda row: (row["date"], {"invoice": 0, "return": 1, "payment": 2}[row["type"]], row["sort_id"]))
        running_balance = Decimal("0")
        for row in activity:
            running_balance += row["amount_base"]
            row["balance_base"] = running_balance
            row.pop("sort_id", None)

        total_received = sum((row["received_total_base"] for row in invoices), Decimal("0"))
        total_returns = sum((row["returned_total_base"] for row in invoices), Decimal("0"))
        total_paid = sum((row["paid_total_base"] for row in invoices), Decimal("0"))
        return Response({
            "supplier": SupplierSerializer(supplier, context={"request": request}).data,
            "currency": request.user.currency,
            "as_of": timezone.localdate(),
            "totals": {
                "received_total_base": total_received,
                "returned_total_base": total_returns,
                "paid_total_base": total_paid,
                "outstanding_base": total_received - total_returns - total_paid,
            },
            "invoices": invoices,
            "activity": activity,
        })


class SupplierPaymentViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierPaymentSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]
    filterset_fields = ["supplier", "purchase_order", "method", "payment_date"]
    search_fields = ["supplier__name", "purchase_order__order_number", "reference", "notes"]
    ordering_fields = ["payment_date", "amount_base", "created_at"]
    ordering = ["-payment_date", "-id"]

    def get_queryset(self):
        return SupplierPayment.objects.filter(
            user=self.request.user,
            is_deleted=False,
        ).select_related("supplier", "purchase_order")

    @action(detail=False, methods=["get"], url_path="balances")
    def balances(self, request):
        received = PurchaseOrderItem.objects.filter(
            purchase_order__user=request.user,
            purchase_order__status__in=["partially_received", "received"],
            purchase_order__is_deleted=False,
            is_deleted=False,
        ).values("purchase_order__supplier_id").annotate(
            total=Sum(models.F("unit_cost_base") * models.F("quantity_received"))
        )
        paid = SupplierPayment.objects.filter(
            user=request.user,
            is_deleted=False,
        ).values("supplier_id").annotate(total=Sum("amount_base"))
        received_by_supplier = {row["purchase_order__supplier_id"]: row["total"] or Decimal("0") for row in received}
        paid_by_supplier = {row["supplier_id"]: row["total"] or Decimal("0") for row in paid}
        rows = []
        for supplier in Supplier.objects.filter(user=request.user, is_deleted=False).order_by("name"):
            total_received = received_by_supplier.get(supplier.id, Decimal("0"))
            total_paid = paid_by_supplier.get(supplier.id, Decimal("0"))
            rows.append({
                "supplier": supplier.id,
                "supplier_name": supplier.name,
                "currency": request.user.currency,
                "received_total_base": total_received,
                "paid_total_base": total_paid,
                "outstanding_base": total_received - total_paid,
            })
        return Response({"items": rows})


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "supplier", "branch"]
    search_fields = ["order_number", "supplier__name"]

    def get_queryset(self):
        queryset = PurchaseOrder.objects.filter(user=self.request.user, is_deleted=False).prefetch_related("items")
        return scope_queryset_to_staff_branch(self.request, queryset)

    def perform_create(self, serializer):
        order = serializer.save(user=self.request.user)
        log_staff_activity(
            self.request.user, "purchase_order_created", f"Created purchase order {order.order_number}",
            actor=self.request.user, request=self.request, object_type="purchase_order", object_id=order.id,
            metadata={"after": {"status": order.status, "supplier_id": order.supplier_id,
                                "branch_id": order.branch_id, "total_cost": str(order.total_cost)}},
        )

    @action(detail=True, methods=["post"], url_path="receive")
    @transaction.atomic
    def receive(self, request, pk=None):
        order = PurchaseOrder.objects.select_for_update().get(pk=self.get_object().pk)
        if order.status == "cancelled":
            from rest_framework.exceptions import ValidationError
            raise ValidationError("Cannot receive a cancelled order.")
        received_any = False
        batch_details = request.data.get("batches", {})
        if not isinstance(batch_details, dict):
            raise ValidationError({"batches": "Expected a mapping of order item IDs to batch details."})
        for item in order.items.select_related("product"):
            qty = int(request.data.get(str(item.id), item.quantity_ordered - item.quantity_received))
            qty = max(0, min(qty, item.quantity_ordered - item.quantity_received))
            if qty <= 0:
                continue
            product = Product.objects.select_for_update().get(pk=item.product_id)
            details = batch_details.get(str(item.id), {})
            batch = None
            if details:
                if not isinstance(details, dict) or not str(details.get("batch_number", "")).strip():
                    raise ValidationError({"batches": f"Enter a batch number for {product.name}."})
                batch_number = str(details["batch_number"]).strip()
                expiry_raw = details.get("expiry_date") or ""
                expiry_date = parse_date(expiry_raw) if expiry_raw else None
                if expiry_raw and not expiry_date:
                    raise ValidationError({"batches": f"Enter a valid expiry date for {product.name}."})
                batch = ProductBatch.objects.select_for_update().filter(
                    product=product,
                    batch_number=batch_number,
                    is_deleted=False,
                ).first()
                if batch and batch.expiry_date != expiry_date:
                    raise ValidationError({"batches": f"Batch {batch_number} already exists with a different expiry date."})
                if batch:
                    batch.quantity_received += qty
                    batch.quantity_remaining += qty
                    batch.save(update_fields=["quantity_received", "quantity_remaining", "updated_at"])
                else:
                    batch = ProductBatch.objects.create(
                        product=product,
                        batch_number=batch_number,
                        expiry_date=expiry_date,
                        quantity_received=qty,
                        quantity_remaining=qty,
                        unit_cost_base=item.unit_cost_base or item.unit_cost,
                        supplier=order.supplier,
                    )
            product.stock += qty
            product.cost_price = item.unit_cost_base or item.unit_cost
            product.cost_currency = order.currency
            product.cost_fx_rate_to_base = order.fx_rate_to_base
            product.save()
            item.quantity_received += qty
            item.save()
            StockMovement.objects.create(
                product=product,
                batch=batch,
                quantity=qty,
                movement_type="in",
                reason=f"Received {order.order_number}",
                created_by=request.user,
            )
            received_any = True
        if received_any:
            remaining = order.items.filter(quantity_received__lt=models.F("quantity_ordered")).exists()
            order.status = "partially_received" if remaining else "received"
            order.save()
        return Response(PurchaseOrderSerializer(order, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="suggestions")
    def suggestions(self, request):
        horizon = int(request.query_params.get("days", 7))
        since = timezone.now() - timedelta(days=max(horizon, 1))
        suggestions = []
        products = Product.objects.filter(user=request.user, is_deleted=False).select_related("preferred_supplier", "branch")
        for product in products:
            sold = SaleItem.objects.filter(
                product=product,
                sale__created_by=request.user,
                sale__created_at__gte=since,
                is_deleted=False,
            ).aggregate(total=Sum("quantity"))["total"] or 0
            average_daily_sales = Decimal(sold) / Decimal(max(horizon, 1))
            target_stock = max(product.reorder_level * 2, int(average_daily_sales * Decimal(horizon * 2)))
            suggested_quantity = max(0, target_stock - product.stock)
            if suggested_quantity <= 0 and product.status == "ok":
                continue
            suggestions.append({
                "product": ProductSerializer(product).data,
                "supplier": SupplierSerializer(product.preferred_supplier).data if product.preferred_supplier else None,
                "average_daily_sales": round(average_daily_sales, 2),
                "suggested_quantity": max(suggested_quantity, product.reorder_level - product.stock if product.stock <= product.reorder_level else 0),
                "estimated_cost": max(suggested_quantity, 0) * product.cost_price,
                "estimated_cost_currency": request.user.currency,
            })
        return Response({"horizon_days": horizon, "items": suggestions})
