from rest_framework import serializers
from .models import SyncConflict


class SyncConflictSerializer(serializers.ModelSerializer):
    class Meta:
        model = SyncConflict
        fields = "__all__"
        read_only_fields = ["user", "created_at", "updated_at"]
