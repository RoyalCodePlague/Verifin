from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class SyncConflict(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("open", "open"), ("resolved", "resolved"), ("ignored", "ignored")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_conflicts")
    action_id = models.CharField(max_length=40, blank=True)
    action_type = models.CharField(max_length=40, blank=True)
    payload = models.JSONField(default=dict)
    reason = models.CharField(max_length=255, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    resolution_note = models.CharField(max_length=255, blank=True)
