from django.contrib import admin
from .models import AssistantLog


@admin.register(AssistantLog)
class AssistantLogAdmin(admin.ModelAdmin):
    list_display = (
        "user",
        "parsed_action",
        "confidence",
        "executed",
        "requires_confirmation",
        "created_at",
    )
    list_filter = ("parsed_action", "executed", "requires_confirmation", "created_at")
    search_fields = ("user__email", "input_text", "result")
    readonly_fields = (
        "user",
        "input_text",
        "parsed_action",
        "ai_response",
        "confidence",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        ("Command Information", {"fields": ("user", "input_text", "parsed_action")}),
        (
            "AI Response",
            {
                "fields": ("ai_response", "confidence", "requires_confirmation"),
                "classes": ("collapse",),
            },
        ),
        (
            "Execution",
            {
                "fields": ("result", "executed"),
            },
        ),
        (
            "Metadata",
            {
                "fields": ("created_at", "updated_at"),
                "classes": ("collapse",),
            },
        ),
    )

    def has_add_permission(self, request):
        return False

