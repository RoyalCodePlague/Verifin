from django.contrib import admin

from .models import Sale, SaleItem, TillSession


class SaleItemInline(admin.TabularInline):
    model = SaleItem
    extra = 0
    readonly_fields = ("unit_cost", "cost_total", "profit")


@admin.register(Sale)
class SaleAdmin(admin.ModelAdmin):
    list_display = ("receipt_number", "branch", "till_session", "total", "total_cost", "gross_profit", "payment_method", "created_by", "created_at")
    list_filter = ("branch", "payment_method", "created_by")
    search_fields = ("receipt_number", "invoice_number", "items", "created_by__email")
    inlines = [SaleItemInline]


@admin.register(TillSession)
class TillSessionAdmin(admin.ModelAdmin):
    list_display = ("id", "branch", "cashier_name", "status", "opening_cash", "expected_cash", "closing_cash", "cash_variance", "opened_at")
    list_filter = ("status", "branch", "user")
    search_fields = ("cashier_name", "user__email")
