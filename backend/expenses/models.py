from django.conf import settings
from django.db import models
from core.models import TimeStampedSoftDeleteModel


class ExpenseCategory(TimeStampedSoftDeleteModel):
    name = models.CharField(max_length=100, unique=True)


class Expense(TimeStampedSoftDeleteModel):
    description = models.CharField(max_length=255)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    category = models.ForeignKey(ExpenseCategory, on_delete=models.SET_NULL, null=True, related_name="expenses")
    date = models.DateField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="expenses")
    receipt_image = models.ImageField(upload_to="receipts/", blank=True, null=True)
