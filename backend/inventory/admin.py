from django.contrib import admin

from .models import BarcodeLookupCache, Branch, Category, Product, PurchaseOrder, PurchaseOrderItem, StockMovement, StockTransfer, Supplier


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "user", "is_primary", "created_at")
    search_fields = ("name", "code", "user__email")
    list_filter = ("is_primary", "user")


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ("name", "contact_name", "phone", "email", "user", "created_at")
    search_fields = ("name", "contact_name", "phone", "email", "user__email")
    list_filter = ("user",)


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "user", "created_at")
    search_fields = ("name", "user__email")
    list_filter = ("user",)


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "sku", "branch", "preferred_supplier", "user", "stock", "status", "cost_price", "price", "created_at")
    search_fields = ("name", "sku", "barcode", "preferred_supplier__name", "user__email")
    list_filter = ("status", "branch", "preferred_supplier", "user")


@admin.register(BarcodeLookupCache)
class BarcodeLookupCacheAdmin(admin.ModelAdmin):
    list_display = ("barcode", "name", "brand", "category", "source", "updated_at")
    search_fields = ("barcode", "name", "brand", "category")
    list_filter = ("source",)


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    list_display = ("product", "quantity", "movement_type", "created_by", "created_at")
    search_fields = ("product__name", "created_by__email")


@admin.register(StockTransfer)
class StockTransferAdmin(admin.ModelAdmin):
    list_display = ("product", "from_branch", "to_branch", "quantity", "created_by", "created_at")
    search_fields = ("product__name", "from_branch__name", "to_branch__name", "created_by__email")


class PurchaseOrderItemInline(admin.TabularInline):
    model = PurchaseOrderItem
    extra = 0


@admin.register(PurchaseOrder)
class PurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ("order_number", "supplier", "branch", "status", "total_cost", "expected_date", "created_at")
    list_filter = ("status", "supplier", "branch")
    search_fields = ("order_number", "supplier__name")
    inlines = [PurchaseOrderItemInline]
