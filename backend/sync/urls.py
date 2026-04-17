from django.urls import path
from .views import SyncPullView, SyncPushView

urlpatterns = [
    path("push/", SyncPushView.as_view()),
    path("pull/", SyncPullView.as_view()),
]
