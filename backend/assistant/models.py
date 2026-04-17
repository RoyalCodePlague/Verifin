from django.conf import settings
from django.db import models
from django.utils import timezone

class ChatMessage(models.Model):
    user_message = models.TextField()
    ai_response = models.TextField()
    action = models.CharField(max_length=50)
    confidence = models.FloatField(default=0.0)
    created_at = models.DateTimeField(default=timezone.now)
from core.models import TimeStampedSoftDeleteModel


class AssistantLog(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="assistant_logs")
    input_text = models.TextField()
    parsed_action = models.CharField(max_length=100, blank=True)
    result = models.TextField(blank=True)
    ai_response = models.JSONField(default=dict, blank=True, help_text="Full Claude AI response JSON")
    confidence = models.FloatField(default=0.0, help_text="Claude's confidence score (0.0-1.0)")
    requires_confirmation = models.BooleanField(default=False)
    executed = models.BooleanField(default=False, help_text="Whether the action was executed")

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Assistant Log"
        verbose_name_plural = "Assistant Logs"

    def __str__(self):
        return f"{self.user.email} - {self.parsed_action} - {self.created_at}"

