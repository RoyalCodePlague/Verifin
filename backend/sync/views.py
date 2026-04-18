from django.utils.dateparse import parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from .models import SyncConflict
from sales.serializers import SaleSerializer
from expenses.serializers import ExpenseSerializer
from expenses.models import ExpenseCategory
from inventory.models import Category, Product
from inventory.serializers import ProductSerializer


class SyncPushView(APIView):
    permission_classes = [IsAuthenticated]

    def _inventory_category_id(self, request, payload):
        category_name = payload.get("categoryName") or payload.get("category_name")
        if not category_name:
            return payload.get("category")

        category, _ = Category.objects.get_or_create(user=request.user, name=category_name)
        return category.id

    def post(self, request):
        actions = request.data.get("actions", [])
        processed = 0
        conflicts = []
        errors = []

        for action in actions:
            action_type = action.get("type")
            payload = action.get("payload", {})

            if action_type == "sale":
                serializer = SaleSerializer(data=payload, context={"request": request})
                if serializer.is_valid():
                    serializer.save(created_by=request.user)
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Sale sync failed")

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
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Expense sync failed")
            elif action_type == "product_create":
                product_payload = {
                    "name": payload.get("name"),
                    "sku": payload.get("sku"),
                    "barcode": payload.get("barcode", ""),
                    "category": self._inventory_category_id(request, payload),
                    "stock": payload.get("stock", 0),
                    "reorder_level": payload.get("reorder_level", payload.get("reorder", 0)),
                    "price": payload.get("price", 0),
                }
                serializer = ProductSerializer(data=product_payload, context={"request": request})
                if serializer.is_valid():
                    serializer.save(user=request.user)
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Product create sync failed")
            elif action_type == "product_update":
                try:
                    product = Product.objects.get(id=payload.get("id"), user=request.user, is_deleted=False)
                except Product.DoesNotExist:
                    errors.append({"action": action, "detail": "Product not found"})
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Product update target missing")
                    continue

                product_payload = {
                    "name": payload.get("name", product.name),
                    "sku": payload.get("sku", product.sku),
                    "barcode": payload.get("barcode", product.barcode),
                    "category": self._inventory_category_id(request, payload),
                    "stock": payload.get("stock", product.stock),
                    "reorder_level": payload.get("reorder_level", payload.get("reorder", product.reorder_level)),
                    "price": payload.get("price", product.price),
                }
                serializer = ProductSerializer(product, data=product_payload, partial=True, context={"request": request})
                if serializer.is_valid():
                    serializer.save()
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Product update sync failed")
            elif action_type == "product_delete":
                updated = Product.objects.filter(id=payload.get("id"), user=request.user, is_deleted=False).update(is_deleted=True)
                if updated:
                    processed += 1
                else:
                    errors.append({"action": action, "detail": "Product not found"})
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Product delete target missing")
            else:
                errors.append({"action": action, "detail": "Unsupported sync action type"})
                SyncConflict.objects.create(user=request.user, payload=action, reason="Unsupported sync action")

        response_data = {
            "processed": processed,
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
        data = [{"id": item.id, "payload": item.payload, "updated_at": item.updated_at} for item in qs]
        return Response({"changes": data})
