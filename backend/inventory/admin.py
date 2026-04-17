from django.contrib import admin

from .models import Category, Product, StockMovement


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "created_at")
    search_fields = ("name", "user__email")
    list_filter = ("user",)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "sku", "user", "stock", "status", "price", "created_at")
    search_fields = ("name", "sku", "barcode", "user__email")
    list_filter = ("status", "user")


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("product", "quantity", "movement_type", "created_by", "created_at")
    search_fields = ("product__name", "created_by__email")
