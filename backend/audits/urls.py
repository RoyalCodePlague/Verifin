from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import AuditScheduleViewSet, AuditViewSet, DiscrepancyViewSet, StockCountViewSet

router = DefaultRouter()
router.register("schedules", AuditScheduleViewSet, basename="audit-schedules")
router.register("stock-counts", StockCountViewSet, basename="stock-counts")
router.register("discrepancies", DiscrepancyViewSet, basename="discrepancies")
router.register("", AuditViewSet, basename="audits")

urlpatterns = [path("", include(router.urls))]
