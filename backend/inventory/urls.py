from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import BranchViewSet, CategoryViewSet, ProductBatchViewSet, ProductViewSet, StockMovementViewSet, StockTransferViewSet, SupplierViewSet

from .supply import SupplyEntryViewSet
from .purchasing_views import (
    GoodsReceivedNoteViewSet,
    InventoryIntelligenceViewSet,
    PurchaseCostHistoryViewSet,
    PurchaseOrderViewSet,
    SupplierPaymentViewSet,
    SupplierReturnViewSet,
)

router = DefaultRouter()
router.register("supply-entries", SupplyEntryViewSet, basename="supply-entries")
router.register("branches", BranchViewSet, basename="inventory-branches")
router.register("suppliers", SupplierViewSet, basename="inventory-suppliers")
router.register("supplier-payments", SupplierPaymentViewSet, basename="inventory-supplier-payments")
router.register("purchase-orders", PurchaseOrderViewSet, basename="inventory-purchase-orders")
router.register("goods-received-notes", GoodsReceivedNoteViewSet, basename="inventory-goods-received-notes")
router.register("supplier-returns", SupplierReturnViewSet, basename="inventory-supplier-returns")
router.register("purchase-cost-history", PurchaseCostHistoryViewSet, basename="inventory-purchase-cost-history")
router.register("intelligence", InventoryIntelligenceViewSet, basename="inventory-intelligence")
router.register("categories", CategoryViewSet, basename="inventory-categories")
router.register("products", ProductViewSet, basename="inventory-products")
router.register("batches", ProductBatchViewSet, basename="inventory-batches")
router.register("movements", StockMovementViewSet, basename="inventory-movements")
router.register("transfers", StockTransferViewSet, basename="inventory-transfers")

urlpatterns = [path("", include(router.urls))]
