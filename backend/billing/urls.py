from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import PaymentViewSet, SubscriptionViewSet

router = DefaultRouter()
router.register("subscriptions", SubscriptionViewSet, basename="subscriptions")
router.register("payments", PaymentViewSet, basename="payments")

urlpatterns = [path("", include(router.urls))]
