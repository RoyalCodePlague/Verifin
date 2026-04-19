from django.contrib import admin

from .models import Sale, SaleItem


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0
    readonly_fields = ("unit_cost", "cost_total", "profit")


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ("id", "branch", "total", "total_cost", "gross_profit", "payment_method", "created_by", "created_at")
    list_filter = ("branch", "payment_method", "created_by")
    search_fields = ("items", "created_by__email")
    inlines = [SaleItemInline]
