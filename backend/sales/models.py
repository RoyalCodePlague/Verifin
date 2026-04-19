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
    till_session = models.ForeignKey("TillSession", on_delete=models.SET_NULL, blank=True, null=True, related_name="sales")
    receipt_number = models.CharField(max_length=40, blank=True)
    invoice_number = models.CharField(max_length=40, blank=True)
    customer = models.ForeignKey(Customer, on_delete=models.SET_NULL, blank=True, null=True, related_name="sales")
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="sales")
    date = models.DateField(auto_now_add=True)
    time = models.TimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self.receipt_number and self.created_by_id:
            count = Sale.objects.filter(created_by=self.created_by).count() + 1
            self.receipt_number = f"R-{count:06d}"
        if not self.invoice_number and self.customer_id:
            count = Sale.objects.filter(created_by=self.created_by, customer__isnull=False).count() + 1
            self.invoice_number = f"INV-{count:06d}"
        super().save(*args, **kwargs)


class SaleItem(TimeStampedSoftDeleteModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="sale_items")
    product = models.ForeignKey(Product, on_delete=models.PROTECT, related_name="sale_items")
    quantity = models.IntegerField()
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    cost_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    profit = models.DecimalField(max_digits=12, decimal_places=2, default=0)


class TillSession(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [("open", "open"), ("closed", "closed")]
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="till_sessions")
    branch = models.ForeignKey(Branch, on_delete=models.SET_NULL, blank=True, null=True, related_name="till_sessions")
    cashier_name = models.CharField(max_length=120, blank=True)
    opening_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    closing_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    expected_cash = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    cash_variance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    card_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    eft_total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="open")
    opened_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(blank=True, null=True)
    notes = models.TextField(blank=True)
