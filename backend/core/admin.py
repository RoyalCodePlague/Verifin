from django.contrib import admin

from .models import AnalyticsConsent, ProductEvent


@admin.register(AnalyticsConsent)
class AnalyticsConsentAdmin(admin.ModelAdmin):
    list_display = ("user", "opted_in", "updated_at")
    list_filter = ("opted_in",)
    search_fields = ("user__email",)


@admin.register(ProductEvent)
class ProductEventAdmin(admin.ModelAdmin):
    list_display = ("event", "created_at")
    list_filter = ("event", "created_at")
    exclude = ("account_ref",)
    readonly_fields = ("event", "created_at")
