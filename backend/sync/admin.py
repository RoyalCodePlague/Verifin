from django.contrib import admin
from .models import SyncConflict


@admin.register(SyncConflict)
class SyncConflictAdmin(admin.ModelAdmin):
    list_display = ("action_type", "status", "reason", "user", "created_at")
    list_filter = ("status", "action_type", "user")
    search_fields = ("reason", "action_id", "user__email")
