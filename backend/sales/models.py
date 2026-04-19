from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel
from customers.models import Customer
from inventory.models import Branch, Product


class Sale(TimeStampedSoftDeleteModel):
    PAYMENT_CHOICES = [("Cash", "Cash"), ("EFT", "EFT"), ("Card", "Card")]
    items = models.TextField(blank=True)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    gross_profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    payment_method = models.CharField(max_length=20, choices=PAYMENT_CHOICES, default="Cash")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="sales")
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, blank=True, null=True, related_name="sales")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sales")
    date = models.DateField(auto_now_add=True)
    time = models.TimeField(auto_now_add=True)


class SaleItem(TimeStampedSoftDeleteModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="sale_items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="sale_items")
    quantity = models.IntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    cost_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
