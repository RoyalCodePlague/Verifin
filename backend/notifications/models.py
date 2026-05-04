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


class Feedback(TimeStampedSoftDeleteModel):
    CATEGORY_CHOICES = [
        ("idea", "Idea"),
        ("bug", "Bug"),
        ("improvement", "Improvement"),
        ("praise", "Praise"),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="feedback_posts")
    title = models.CharField(max_length=120)
    message = models.TextField()
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES, default="idea")

    class Meta:
        ordering = ["-created_at"]


class FeedbackVote(TimeStampedSoftDeleteModel):
    feedback = models.ForeignKey(Feedback, on_delete=models.CASCADE, related_name="votes")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="feedback_votes")

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["feedback", "user"],
                condition=models.Q(is_deleted=False),
                name="unique_active_feedback_vote",
            )
        ]
