from datetime import timedelta
from decimal import Decimal
import httpx
from django.db import models, transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from accounts.activity import log_staff_activity
from billing.services import enforce_feature, enforce_limit
from sales.models import SaleItem
from .models import BarcodeLookupCache, Branch, Category, Product, PurchaseOrder, StockMovement, StockTransfer, Supplier
from .serializers import BranchSerializer, CategorySerializer, ProductSerializer, PurchaseOrderSerializer, StockMovementSerializer, StockTransferSerializer, SupplierSerializer

BARCODE_IDENTIFICATION_SOURCES = [
    ("open_food_facts", "https://world.openfoodfacts.org/api/v2/product/{barcode}"),
    ("open_products_facts", "https://world.openproductsfacts.org/api/v2/product/{barcode}"),
    ("open_beauty_facts", "https://world.openbeautyfacts.org/api/v2/product/{barcode}"),
    ("open_pet_food_facts", "https://world.openpetfoodfacts.org/api/v2/product/{barcode}"),
]


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
        return Branch.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        branch = serializer.save(user=self.request.user)
        if not Branch.objects.filter(user=self.request.user, is_deleted=False).exclude(id=branch.id).exists():
            branch.is_primary = True
            branch.save()


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
        return qs

    def perform_create(self, serializer):
        enforce_limit(self.request.user, "products")
        product = serializer.save(user=self.request.user)
        log_staff_activity(self.request.user, "product_created", f"Created product {product.name}", actor=self.request.user, object_type="product", object_id=product.id)

    def perform_update(self, serializer):
        product = serializer.save()
        log_staff_activity(self.request.user, "product_updated", f"Updated product {product.name}", actor=self.request.user, object_type="product", object_id=product.id)

    def perform_destroy(self, instance):
        name = instance.name
        instance.delete()
        log_staff_activity(self.request.user, "product_deleted", f"Deleted product {name}", actor=self.request.user, object_type="product", object_id=instance.id)

    @action(detail=False, methods=["get"], url_path="barcode-lookup")
    def barcode_lookup(self, request):
        enforce_feature(request.user, "barcode_scanning")
        code = request.query_params.get("code")
        product = self.get_queryset().filter(barcode=code).first()
        if not product:
            return Response({"detail": "Product not found."}, status=404)
        return Response(ProductSerializer(product).data)

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
            serializer = ProductSerializer(data=row)
            serializer.is_valid(raise_exception=True)
            serializer.save(user=request.user)
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
        stock = request.data.get("stock", 0)
        price = request.data.get("price")
        sku = request.data.get("sku", "")
        category_id = request.data.get("category")
        if not name or price is None:
            return Response({"detail": "Name and price are required."}, status=400)
        category = None
        if category_id:
            try:
                category = Category.objects.get(id=category_id, user=request.user)
            except Category.DoesNotExist:
                return Response({"detail": "Category not found."}, status=404)
        product = Product.objects.create(
            user=request.user,
            name=name,
            stock=stock,
            price=price,
            cost_price=request.data.get("cost_price", 0),
            sku=sku,
            category=category,
            branch_id=request.data.get("branch"),
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

    @action(detail=True, methods=["post"], url_path="transfer")
    @transaction.atomic
    def transfer(self, request, pk=None):
        product = self.get_object()
        to_branch_id = request.data.get("to_branch")
        quantity = int(request.data.get("quantity", 0))
        if quantity <= 0:
            return Response({"detail": "Quantity must be greater than zero."}, status=status.HTTP_400_BAD_REQUEST)
        if product.stock < quantity:
            return Response({"detail": "Insufficient stock for transfer."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            to_branch = Branch.objects.get(id=to_branch_id, user=request.user, is_deleted=False)
        except Branch.DoesNotExist:
            return Response({"detail": "Destination branch not found."}, status=status.HTTP_404_NOT_FOUND)

        product.stock -= quantity
        product.save()
        target, _ = Product.objects.get_or_create(
            user=request.user,
            branch=to_branch,
            sku=product.sku,
            defaults={
                "name": product.name,
            "barcode": product.barcode,
            "preferred_supplier": product.preferred_supplier_id,
                "category": product.category,
                "stock": 0,
                "reorder_level": product.reorder_level,
                "cost_price": product.cost_price,
                "price": product.price,
            },
        )
        target.stock += quantity
        target.save()
        transfer = StockTransfer.objects.create(
            from_branch=product.branch or to_branch,
            to_branch=to_branch,
            product=product,
            quantity=quantity,
            created_by=request.user,
            note=request.data.get("note", ""),
        )
        return Response({
            "transfer": StockTransferSerializer(transfer).data,
            "source": ProductSerializer(product).data,
            "target": ProductSerializer(target).data,
        })


class StockMovementViewSet(viewsets.ModelViewSet):
    serializer_class = StockMovementSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["movement_type", "product"]

    def get_queryset(self):
        return StockMovement.objects.filter(created_by=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        movement = serializer.save(created_by=self.request.user)
        product = movement.product
        if movement.movement_type == "in":
            product.stock += movement.quantity
        elif movement.movement_type == "out":
            product.stock -= movement.quantity
        else:
            product.stock = movement.quantity
        product.save()


class StockTransferViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StockTransferSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["from_branch", "to_branch", "product"]

    def get_queryset(self):
        return StockTransfer.objects.filter(created_by=self.request.user, is_deleted=False)


class SupplierViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierSerializer
    permission_classes = [IsAuthenticated]
    search_fields = ["name", "contact_name", "phone", "email"]

    def get_queryset(self):
        return Supplier.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class PurchaseOrderViewSet(viewsets.ModelViewSet):
    serializer_class = PurchaseOrderSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "supplier", "branch"]
    search_fields = ["order_number", "supplier__name"]

    def get_queryset(self):
        return PurchaseOrder.objects.filter(user=self.request.user, is_deleted=False).prefetch_related("items")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="receive")
    @transaction.atomic
    def receive(self, request, pk=None):
        order = self.get_object()
        received_any = False
        for item in order.items.select_related("product"):
            qty = int(request.data.get(str(item.id), item.quantity_ordered - item.quantity_received))
            qty = max(0, min(qty, item.quantity_ordered - item.quantity_received))
            if qty <= 0:
                continue
            product = item.product
            product.stock += qty
            product.cost_price = item.unit_cost_base or item.unit_cost
            product.cost_currency = order.currency
            product.cost_fx_rate_to_base = order.fx_rate_to_base
            product.save()
            item.quantity_received += qty
            item.save()
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
