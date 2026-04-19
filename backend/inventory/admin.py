from django.contrib import admin

from .models import Branch, Category, Product, StockMovement, StockTransfer


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "user", "is_primary", "created_at")
    search_fields = ("name", "code", "user__email")
    list_filter = ("is_primary", "user")


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "created_at")
    search_fields = ("name", "user__email")
    list_filter = ("user",)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "sku", "branch", "user", "stock", "status", "cost_price", "price", "created_at")
    search_fields = ("name", "sku", "barcode", "user__email")
    list_filter = ("status", "branch", "user")


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("product", "quantity", "movement_type", "created_by", "created_at")
    search_fields = ("product__name", "created_by__email")


@admin.register(StockTransfer)
class StockTransferAdmin(admin.ModelAdmin):
    list_display = ("product", "from_branch", "to_branch", "quantity", "created_by", "created_at")
    search_fields = ("product__name", "from_branch__name", "to_branch__name", "created_by__email")
