from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel
from inventory.models import Product


class Audit(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("in_progress", "in_progress"), ("completed", "completed")]
    date = models.DateField(auto_now_add=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="in_progress")
    items_counted = models.PositiveIntegerField(default=0)
    discrepancies_found = models.PositiveIntegerField(default=0)
    conductor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="audits")
    completed_at = models.DateTimeField(blank=True, null=True)


class Discrepancy(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("unresolved", "unresolved"), ("investigating", "investigating"), ("resolved", "resolved")]
    audit = models.ForeignKey(Audit, on_delete=models.CASCADE, related_name="discrepancies")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="discrepancies")
    expected_stock = models.IntegerField()
    actual_stock = models.IntegerField()
    difference = models.IntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="unresolved")
    resolved_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="resolved_discrepancies")
    resolved_at = models.DateTimeField(blank=True, null=True)


class StockCount(TimeStampedSoftDeleteModel):
    audit = models.ForeignKey(Audit, on_delete=models.CASCADE, related_name="stock_counts")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="stock_counts")
    counted_quantity = models.IntegerField()
    counted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="stock_counts")
