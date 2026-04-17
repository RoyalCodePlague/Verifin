from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CategoryViewSet, ProductViewSet, StockMovementViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="inventory-categories")
router.register("products", ProductViewSet, basename="inventory-products")
router.register("movements", StockMovementViewSet, basename="inventory-movements")

urlpatterns = [path("", include(router.urls))]
