from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import AuditViewSet, DiscrepancyViewSet, StockCountViewSet

router = DefaultRouter()
router.register("stock-counts", StockCountViewSet, basename="stock-counts")
router.register("discrepancies", DiscrepancyViewSet, basename="discrepancies")
router.register("", AuditViewSet, basename="audits")

urlpatterns = [path("", include(router.urls))]
