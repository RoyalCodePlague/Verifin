from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import PaymentViewSet, PlanViewSet, PricingContextViewSet, RegionPriceViewSet, SubscriptionEventViewSet, SubscriptionViewSet

router = DefaultRouter()
router.register("plans", PlanViewSet, basename="plans")
router.register("region-prices", RegionPriceViewSet, basename="region-prices")
router.register("pricing-context", PricingContextViewSet, basename="pricing-context")
router.register("subscriptions", SubscriptionViewSet, basename="subscriptions")
router.register("payments", PaymentViewSet, basename="payments")
router.register("events", SubscriptionEventViewSet, basename="subscription-events")

urlpatterns = [path("", include(router.urls))]
