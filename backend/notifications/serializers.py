from rest_framework import serializers
from .models import Feedback, FeedbackVote, NotificationLog, NotificationPreference


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = "__all__"
        read_only_fields = ["user"]


class NotificationLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationLog
        fields = "__all__"
        read_only_fields = ["user", "sent_at"]


class FeedbackSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()
    upvote_count = serializers.SerializerMethodField()
    has_upvoted = serializers.SerializerMethodField()

    class Meta:
        model = Feedback
        fields = [
            "id",
            "title",
            "message",
            "category",
            "author_name",
            "upvote_count",
            "has_upvoted",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["author_name", "upvote_count", "has_upvoted", "created_at", "updated_at"]

    def get_author_name(self, obj):
        return obj.user.business_name or obj.user.get_full_name() or obj.user.username or obj.user.email

    def get_upvote_count(self, obj):
        return obj.votes.filter(is_deleted=False).count()

    def get_has_upvoted(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return False
        return FeedbackVote.objects.filter(feedback=obj, user=request.user, is_deleted=False).exists()
