from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import SyncConflictViewSet, SyncPullView, SyncPushView

router = DefaultRouter()
router.register("conflicts", SyncConflictViewSet, basename="sync-conflicts")

urlpatterns = [
    path("push/", SyncPushView.as_view()),
    path("pull/", SyncPullView.as_view()),
    path("", include(router.urls)),
]
