from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import BranchViewSet, CategoryViewSet, ProductViewSet, PurchaseOrderViewSet, StockMovementViewSet, StockTransferViewSet, SupplierViewSet

router = DefaultRouter()
router.register("branches", BranchViewSet, basename="inventory-branches")
router.register("suppliers", SupplierViewSet, basename="inventory-suppliers")
router.register("purchase-orders", PurchaseOrderViewSet, basename="inventory-purchase-orders")
router.register("categories", CategoryViewSet, basename="inventory-categories")
router.register("products", ProductViewSet, basename="inventory-products")
router.register("movements", StockMovementViewSet, basename="inventory-movements")
router.register("transfers", StockTransferViewSet, basename="inventory-transfers")

urlpatterns = [path("", include(router.urls))]
