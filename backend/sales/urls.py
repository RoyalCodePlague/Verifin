from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import SaleItemViewSet, SaleViewSet, TillSessionViewSet

router = DefaultRouter()
router.register("items", SaleItemViewSet, basename="sale-items")
router.register("", SaleViewSet, basename="sales")

till_list = TillSessionViewSet.as_view({"get": "list", "post": "create"})
till_detail = TillSessionViewSet.as_view({"get": "retrieve", "patch": "partial_update", "delete": "destroy"})
till_current = TillSessionViewSet.as_view({"get": "current"})
till_close = TillSessionViewSet.as_view({"post": "close"})

urlpatterns = [
    path("tills/", till_list),
    path("tills/current/", till_current),
    path("tills/<int:pk>/", till_detail),
    path("tills/<int:pk>/close/", till_close),
    path("", include(router.urls)),
]
