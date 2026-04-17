from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class SyncConflict(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sync_conflicts")
    payload = models.JSONField(default=dict)
    reason = models.CharField(max_length=255, blank=True)
from django.db import models

# Create your models here.
