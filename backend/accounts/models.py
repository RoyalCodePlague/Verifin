from django.contrib.auth.models import AbstractUser
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from core.models import TimeStampedSoftDeleteModel


def default_enabled_currencies():
    return ["ZAR"]


def default_staff_permissions():
    return []


class User(AbstractUser, TimeStampedSoftDeleteModel):
    email = models.EmailField(unique=True)
    phone = models.CharField(max_length=30, blank=True)
    business_name = models.CharField(max_length=255, blank=True)
    currency = models.CharField(max_length=10, default="ZAR")
    currency_symbol = models.CharField(max_length=10, default="R")
    enabled_currencies = models.JSONField(default=default_enabled_currencies, blank=True)
    exchange_rates = models.JSONField(default=dict, blank=True, help_text="Currency -> rate to base currency.")
    dark_mode = models.BooleanField(default=False)
    onboarding_complete = models.BooleanField(default=False)
    email_verified = models.BooleanField(default=True)
    email_verification_token = models.CharField(max_length=128, blank=True)
    email_verification_sent_at = models.DateTimeField(blank=True, null=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]


class Profile(TimeStampedSoftDeleteModel):
    user = models.OneToOneField(User, related_name="profile", on_delete=models.CASCADE)
    address = models.CharField(max_length=255, blank=True)
    country = models.CharField(max_length=100, blank=True)
    city = models.CharField(max_length=100, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    bio = models.TextField(blank=True)


class Staff(TimeStampedSoftDeleteModel):
    OWNER = "Owner"
    CASHIER = "Cashier"
    STOCK_MANAGER = "Stock Manager"
    MANAGER = "Manager"
    ROLE_CHOICES = [
        (OWNER, OWNER),
        (CASHIER, CASHIER),
        (STOCK_MANAGER, STOCK_MANAGER),
        (MANAGER, MANAGER),
    ]
    ACTIVE = "Active"
    INACTIVE = "Inactive"
    STATUS_CHOICES = [(ACTIVE, ACTIVE), (INACTIVE, INACTIVE)]

    user = models.ForeignKey(User, related_name="staff_members", on_delete=models.CASCADE)
    branch = models.ForeignKey("inventory.Branch", related_name="staff_members", on_delete=models.SET_NULL, blank=True, null=True)
    name = models.CharField(max_length=255)
    role = models.CharField(max_length=30, choices=ROLE_CHOICES, default=CASHIER)
    status = models.CharField(max_length=15, choices=STATUS_CHOICES, default=ACTIVE)
    last_active = models.DateTimeField(blank=True, null=True)
    username = models.CharField(max_length=80, blank=True)
    password = models.CharField(max_length=128, blank=True)
    permissions = models.JSONField(default=default_staff_permissions, blank=True)
    login_enabled = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["user", "username"],
                condition=models.Q(is_deleted=False) & ~models.Q(username=""),
                name="unique_active_staff_username_per_owner",
            )
        ]

    def set_password(self, raw_password):
        self.password = make_password(raw_password)

    def check_password(self, raw_password):
        if not self.password:
            return False
        return check_password(raw_password, self.password)


class StaffActivityLog(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(User, related_name="staff_activity_logs", on_delete=models.CASCADE)
    actor = models.ForeignKey(User, related_name="performed_activity_logs", on_delete=models.SET_NULL, blank=True, null=True)
    action = models.CharField(max_length=80)
    object_type = models.CharField(max_length=80, blank=True)
    object_id = models.CharField(max_length=80, blank=True)
    summary = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]
