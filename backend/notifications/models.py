from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class NotificationPreference(TimeStampedSoftDeleteModel):
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_preference")
    whatsapp_daily = models.BooleanField(default=True)
    low_stock_alerts = models.BooleanField(default=True)
    discrepancy_alerts = models.BooleanField(default=True)
    push_enabled = models.BooleanField(default=True)


class NotificationLog(TimeStampedSoftDeleteModel):
    CHANNEL_CHOICES = [("whatsapp", "whatsapp"), ("email", "email"), ("push", "push")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notification_logs")
    type = models.CharField(max_length=100)
    message = models.TextField()
    sent_at = models.DateTimeField(auto_now_add=True)
    channel = models.CharField(max_length=20, choices=CHANNEL_CHOICES)
