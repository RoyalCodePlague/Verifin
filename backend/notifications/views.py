from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Feedback, FeedbackVote, NotificationLog, NotificationPreference
from .serializers import FeedbackSerializer, NotificationLogSerializer, NotificationPreferenceSerializer


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


class FeedbackViewSet(viewsets.ModelViewSet):
    serializer_class = FeedbackSerializer
    http_method_names = ["get", "post", "head", "options"]
    search_fields = ["title", "message", "category"]
    ordering_fields = ["created_at", "updated_at"]

    def get_queryset(self):
        return Feedback.objects.filter(is_deleted=False).select_related("user").prefetch_related("votes")

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="upvote")
    def upvote(self, request, pk=None):
        feedback = self.get_object()
        existing = FeedbackVote.objects.filter(feedback=feedback, user=request.user, is_deleted=False).first()
        if existing:
            existing.is_deleted = True
            existing.save(update_fields=["is_deleted", "updated_at"])
            return Response(self.get_serializer(feedback).data, status=status.HTTP_200_OK)

        FeedbackVote.objects.create(feedback=feedback, user=request.user)
        return Response(self.get_serializer(feedback).data, status=status.HTTP_200_OK)
