from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import NotificationLog, NotificationPreference
from .serializers import NotificationLogSerializer, NotificationPreferenceSerializer


class NotificationPreferenceViewSet(viewsets.ModelViewSet):
    serializer_class = NotificationPreferenceSerializer

    def get_queryset(self):
        return NotificationPreference.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class NotificationLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationLogSerializer

    def get_queryset(self):
        return NotificationLog.objects.filter(user=self.request.user, is_deleted=False).order_by("-sent_at")

    @action(detail=False, methods=["post"], url_path="send-test")
    def send_test(self, request):
        log = NotificationLog.objects.create(
            user=request.user, type="test", message="This is a test notification", channel="push"
        )
        return Response(NotificationLogSerializer(log).data)
