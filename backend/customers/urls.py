from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import CreditTransactionViewSet, CustomerViewSet, LoyaltyTransactionViewSet

router = DefaultRouter()
router.register("", CustomerViewSet, basename="customers")
router.register("loyalty-transactions", LoyaltyTransactionViewSet, basename="loyalty-transactions")
router.register("credit-transactions", CreditTransactionViewSet, basename="credit-transactions")

urlpatterns = [path("", include(router.urls))]
