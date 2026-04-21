from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class Category(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="categories")
    name = models.CharField(max_length=100)

    class Meta:
        unique_together = ("user", "name")


class Branch(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="branches")
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=30, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    address = models.CharField(max_length=255, blank=True)
    is_primary = models.BooleanField(default=False)

    class Meta:
        unique_together = ("user", "name")

    def save(self, *args, **kwargs):
        if self.is_primary:
            Branch.objects.filter(user=self.user, is_primary=True).exclude(pk=self.pk).update(is_primary=False)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Supplier(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="suppliers")
    name = models.CharField(max_length=160)
    contact_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=30, blank=True)
    email = models.EmailField(blank=True)
    address = models.CharField(max_length=255, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        unique_together = ("user", "name")

    def __str__(self):
        return self.name


class Product(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("ok", "ok"), ("low", "low"), ("out", "out")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="products")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=100)
    barcode = models.CharField(max_length=100, blank=True)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    preferred_supplier = models.ForeignKey(Supplier, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    stock = models.IntegerField(default=0)
    reorder_level = models.IntegerField(default=0)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cost_currency = models.CharField(max_length=10, default="ZAR")
    cost_fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default="ok")

    class Meta:
        unique_together = ("user", "branch", "sku")

    def save(self, *args, **kwargs):
        if self.stock <= 0:
            self.status = "out"
        elif self.stock <= self.reorder_level:
            self.status = "low"
        else:
            self.status = "ok"
        super().save(*args, **kwargs)


class StockMovement(TimeStampedSoftDeleteModel):
    MOVEMENT_CHOICES = [("in", "in"), ("out", "out"), ("adjustment", "adjustment")]
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="movements")
    quantity = models.IntegerField()
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_CHOICES)
    reason = models.CharField(max_length=255, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stock_movements")


class StockTransfer(TimeStampedSoftDeleteModel):
    from_branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="outgoing_transfers")
    to_branch = models.ForeignKey(Branch, on_delete=models.CASCADE, related_name="incoming_transfers")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="transfers")
    quantity = models.PositiveIntegerField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stock_transfers")
    note = models.CharField(max_length=255, blank=True)


class PurchaseOrder(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [
        ("draft", "draft"),
        ("ordered", "ordered"),
        ("partially_received", "partially_received"),
        ("received", "received"),
        ("cancelled", "cancelled"),
    ]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="purchase_orders")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="purchase_orders")
    order_number = models.CharField(max_length=40)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default="draft")
    currency = models.CharField(max_length=10, default="ZAR")
    fx_rate_to_base = models.DecimalField(max_digits=18, decimal_places=6, default=1)
    expected_date = models.DateField(blank=True, null=True)
    notes = models.TextField(blank=True)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_cost_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        unique_together = ("user", "order_number")

    def save(self, *args, **kwargs):
        if not self.order_number:
            count = PurchaseOrder.objects.filter(user=self.user).count() + 1
            self.order_number = f"PO-{count:05d}"
        super().save(*args, **kwargs)


class PurchaseOrderItem(TimeStampedSoftDeleteModel):
    purchase_order = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="purchase_order_items")
    quantity_ordered = models.PositiveIntegerField(default=1)
    quantity_received = models.PositiveIntegerField(default=0)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit_cost_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    line_total_base = models.DecimalField(max_digits=12, decimal_places=2, default=0)
