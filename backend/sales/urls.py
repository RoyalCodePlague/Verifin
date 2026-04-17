from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import SaleItemViewSet, SaleViewSet

router = DefaultRouter()
router.register("", SaleViewSet, basename="sales")
router.register("items", SaleItemViewSet, basename="sale-items")

urlpatterns = [path("", include(router.urls))]
