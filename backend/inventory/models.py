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


class Product(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("ok", "ok"), ("low", "low"), ("out", "out")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="products")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    name = models.CharField(max_length=255)
    sku = models.CharField(max_length=100)
    barcode = models.CharField(max_length=100, blank=True)
    category = models.ForeignKey(Category, on_delete=models.SET_NULL, blank=True, null=True, related_name="products")
    stock = models.IntegerField(default=0)
    reorder_level = models.IntegerField(default=0)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
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
