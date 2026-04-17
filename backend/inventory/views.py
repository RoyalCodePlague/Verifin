from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Category, Product, StockMovement
from .serializers import CategorySerializer, ProductSerializer, StockMovementSerializer


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    search_fields = ["name"]

    def get_queryset(self):
        return Category.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)



class ProductViewSet(viewsets.ModelViewSet):
    serializer_class = ProductSerializer
    filterset_fields = ["status", "category"]
    search_fields = ["name", "sku", "barcode"]

    def get_queryset(self):
        return Product.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=["get"], url_path="barcode-lookup")
    def barcode_lookup(self, request):
        code = request.query_params.get("code")
        product = self.get_queryset().filter(barcode=code).first()
        if not product:
            return Response({"detail": "Product not found."}, status=404)
        return Response(ProductSerializer(product).data)

    @action(detail=False, methods=["post"], url_path="bulk-import")
    def bulk_import(self, request):
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
        total_value = sum([p.stock * float(p.price) for p in products])
        return Response({"inventory_value": total_value})

    @action(detail=False, methods=["get"], url_path="low-stock")
    def low_stock(self, request):
        products = self.get_queryset().filter(status__in=["low", "out"])
        return Response(ProductSerializer(products, many=True).data)

    @action(detail=False, methods=["post"], url_path="add-item")
    def add_item(self, request):
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
            sku=sku,
            category=category,
        )
        return Response(ProductSerializer(product).data)


class StockMovementViewSet(viewsets.ModelViewSet):
    serializer_class = StockMovementSerializer
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
