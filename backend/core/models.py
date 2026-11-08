import uuid

from django.db import models
from django.conf import settings


class TimeStampedSoftDeleteModel(models.Model):
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    is_deleted = models.BooleanField(default=False)

    class Meta:
        abstract = True


class ProductEvent(models.Model):
    """Opt-in, pseudonymous activation telemetry without a direct account relation."""
    account_ref = models.UUIDField()
    event = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["account_ref", "event"], name="unique_product_event_per_account")]
        indexes = [models.Index(fields=["event", "created_at"])]


class AnalyticsConsent(models.Model):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="analytics_consent",
    )
    analytics_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    opted_in = models.BooleanField(default=False)
    updated_at = models.DateTimeField(auto_now=True)
