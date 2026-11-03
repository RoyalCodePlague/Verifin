from django.contrib import admin

from .models import BarcodeLookupCache, Branch, Category, Product, ProductBatch, PurchaseOrder, PurchaseOrderItem, StockMovement, StockTransfer, Supplier, SupplierPayment


@admin.register(Branch)
class BranchAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "user", "is_primary", "created_at")
    search_fields = ("name", "code", "user__email")
    list_filter = ("is_primary", "user")


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display = ("name", "contact_name", "phone", "email", "lead_time_days", "reliability_score", "user", "created_at")
    search_fields = ("name", "contact_name", "phone", "email", "user__email")
    list_filter = ("user", "reliability_score")


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
    list_display = ("product", "batch", "quantity", "movement_type", "created_by", "created_at")
    search_fields = ("product__name", "batch__batch_number", "created_by__email")


@admin.register(ProductBatch)
class ProductBatchAdmin(admin.ModelAdmin):
    list_display = ("batch_number", "product", "expiry_date", "quantity_received", "quantity_remaining", "supplier", "received_at")
    list_filter = ("expiry_date", "supplier")
    search_fields = ("batch_number", "product__name", "product__sku", "supplier__name")


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


@admin.register(SupplierPayment)
class SupplierPaymentAdmin(admin.ModelAdmin):
    list_display = ("supplier", "purchase_order", "amount", "currency", "amount_base", "payment_date", "method", "created_by")
    list_filter = ("method", "currency", "payment_date")
    search_fields = ("supplier__name", "purchase_order__order_number", "reference", "created_by__email")
