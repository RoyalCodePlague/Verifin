from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from urllib.parse import quote
from assistant.services import generate_whatsapp_summary, make_json_safe
from billing.services import enforce_feature
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

    @action(detail=False, methods=["post"], url_path="whatsapp-report")
    def whatsapp_report(self, request):
        enforce_feature(request.user, "whatsapp_reports")
        payload = make_json_safe(generate_whatsapp_summary(request.user))
        message = payload.get("message", "")
        phone = (request.data.get("phone") or getattr(request.user, "phone", "") or "").strip()
        log = NotificationLog.objects.create(user=request.user, type="daily_business_report", message=message, channel="whatsapp")
        return Response({
            "message": message,
            "date": payload.get("date"),
            "channel": "whatsapp",
            "log": NotificationLogSerializer(log).data,
            "whatsapp_url": f"https://wa.me/{phone}?text={quote(message)}" if phone else "",
        })


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
