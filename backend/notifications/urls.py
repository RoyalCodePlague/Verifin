from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import NotificationLogViewSet, NotificationPreferenceViewSet

router = DefaultRouter()
router.register("preferences", NotificationPreferenceViewSet, basename="notification-preferences")
router.register("", NotificationLogViewSet, basename="notifications")

urlpatterns = [path("", include(router.urls))]
