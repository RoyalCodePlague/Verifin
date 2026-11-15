from django.contrib.auth.models import AbstractUser
from django.contrib.auth.hashers import check_password, make_password
from django.db import models
from django.utils import timezone
from decimal import Decimal
import secrets
import string
from core.models import TimeStampedSoftDeleteModel


def default_enabled_currencies():
    return ["ZAR"]


def default_staff_permissions():
    return []


def default_api_key_permissions():
    return ["inventory", "sales", "customers", "reports"]


def generate_business_code():
    """Return a staff-safe, non-sequential business identifier."""
    alphabet = string.ascii_lowercase + string.digits
    characters = [secrets.choice(string.ascii_lowercase), secrets.choice(string.digits)]
    characters.extend(secrets.choice(alphabet) for _ in range(4))
    secrets.SystemRandom().shuffle(characters)
    return "VF-" + "".join(characters)


class User(AbstractUser, TimeStampedSoftDeleteModel):
    email = models.EmailField(unique=True)
    google_subject = models.CharField(max_length=255, unique=True, null=True, blank=True, editable=False)
    phone = models.CharField(max_length=30, blank=True)
    business_name = models.CharField(max_length=255, blank=True)
    currency = models.CharField(max_length=10, default="ZAR")
    currency_symbol = models.CharField(max_length=10, default="R")
    enabled_currencies = models.JSONField(default=default_enabled_currencies, blank=True)
    exchange_rates = models.JSONField(default=dict, blank=True, help_text="Currency -> rate to base currency.")
    dark_mode = models.BooleanField(default=False)
    onboarding_complete = models.BooleanField(default=False)
    email_verified = models.BooleanField(default=True)
    email_verification_pending = models.BooleanField(default=False)
    email_verification_token = models.CharField(max_length=128, blank=True)
    email_verification_sent_at = models.DateTimeField(blank=True, null=True)
    business_code = models.CharField(max_length=16, unique=True, default=generate_business_code, editable=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username"]

    def save(self, *args, **kwargs):
        code_in_use = self.business_code and User.objects.filter(business_code=self.business_code).exclude(pk=self.pk).exists()
        if not self.business_code or code_in_use:
            candidate = generate_business_code()
            while User.objects.filter(business_code=candidate).exists():
                candidate = generate_business_code()
            self.business_code = candidate
        super().save(*args, **kwargs)


class Profile(TimeStampedSoftDeleteModel):
    user = models.OneToOneField(User, related_name="profile", on_delete=models.CASCADE)
    address = models.CharField(max_length=255, blank=True)
    country = models.CharField(max_length=100, blank=True)
    city = models.CharField(max_length=100, blank=True)
    avatar = models.ImageField(upload_to="avatars/", blank=True, null=True)
    bio = models.TextField(blank=True)


class Staff(TimeStampedSoftDeleteModel):
    OWNER = "Owner"
    ADMINISTRATOR = "Administrator"
    BRANCH_MANAGER = "Branch Manager"
    CASHIER = "Cashier"
    SALESPERSON = "Salesperson"
    STOCK_MANAGER = "Stock Manager"
    INVENTORY_MANAGER = "Inventory Manager"
    ACCOUNTANT = "Accountant"
    CUSTOM = "Custom"
    MANAGER = "Manager"
    ROLE_CHOICES = [
        (OWNER, OWNER),
        (ADMINISTRATOR, ADMINISTRATOR),
        (BRANCH_MANAGER, BRANCH_MANAGER),
        (CASHIER, CASHIER),
        (SALESPERSON, SALESPERSON),
        (STOCK_MANAGER, STOCK_MANAGER),
        (INVENTORY_MANAGER, INVENTORY_MANAGER),
        (ACCOUNTANT, ACCOUNTANT),
        (CUSTOM, CUSTOM),
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


class ApprovalSettings(TimeStampedSoftDeleteModel):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="approval_settings")
    discount_percent_threshold = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal("20.00"), blank=True, null=True)
    refund_amount_base_threshold = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("100.00"), blank=True, null=True)
    stock_adjustment_units_threshold = models.PositiveIntegerField(default=10, blank=True, null=True)
    supplier_payment_amount_base_threshold = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("500.00"), blank=True, null=True)
    purchase_order_amount_base_threshold = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal("500.00"), blank=True, null=True)


class ApprovalRequest(models.Model):
    STATUS_PENDING = "pending"
    STATUS_APPROVED = "approved"
    STATUS_REJECTED = "rejected"
    STATUS_CONSUMED = "consumed"
    STATUS_EXPIRED = "expired"
    ACTION_CHOICES = [
        ("sales.void", "Void sale"),
        ("sales.discount_approve", "Approve discount"),
        ("sales.refund", "Approve refund"),
        ("inventory.adjust", "Adjust inventory"),
        ("suppliers.pay", "Pay supplier"),
        ("purchasing.approve", "Approve purchase order"),
        ("till.review", "Review till"),
        ("financial.adjust", "Adjust financial account"),
    ]
    STATUS_CHOICES = [
        ("pending", "Pending"),
        ("approved", "Approved"),
        ("rejected", "Rejected"),
        ("consumed", "Consumed"),
        ("expired", "Expired"),
    ]

    user = models.ForeignKey(User, related_name="approval_requests", on_delete=models.CASCADE)
    requested_by_staff = models.ForeignKey(Staff, related_name="approval_requests", on_delete=models.CASCADE)
    branch = models.ForeignKey("inventory.Branch", blank=True, null=True, related_name="approval_requests", on_delete=models.SET_NULL)
    action = models.CharField(max_length=40, choices=ACTION_CHOICES)
    payload = models.JSONField(default=dict)
    payload_hash = models.CharField(max_length=64, db_index=True)
    summary = models.CharField(max_length=255)
    status = models.CharField(max_length=12, choices=STATUS_CHOICES, default="pending", db_index=True)
    decided_by = models.ForeignKey(User, related_name="decided_approval_requests", blank=True, null=True, on_delete=models.SET_NULL)
    decided_by_staff = models.ForeignKey(Staff, related_name="decided_approval_requests", blank=True, null=True, on_delete=models.SET_NULL)
    decision_note = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)
    expires_at = models.DateTimeField()
    decided_at = models.DateTimeField(blank=True, null=True)
    consumed_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        constraints = [
            models.UniqueConstraint(
                fields=["requested_by_staff", "action", "payload_hash"],
                condition=models.Q(status="pending"),
                name="unique_pending_staff_approval_payload",
            ),
        ]
        indexes = [models.Index(fields=["user", "status", "created_at"])]


class StaffActivityLog(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(User, related_name="staff_activity_logs", on_delete=models.CASCADE)
    actor = models.ForeignKey(User, related_name="performed_activity_logs", on_delete=models.SET_NULL, blank=True, null=True)
    staff_actor = models.ForeignKey(
        Staff, related_name="activity_logs", on_delete=models.SET_NULL, blank=True, null=True,
    )
    actor_name = models.CharField(max_length=255, blank=True)
    action = models.CharField(max_length=80)
    object_type = models.CharField(max_length=80, blank=True)
    object_id = models.CharField(max_length=80, blank=True)
    summary = models.CharField(max_length=255)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-created_at"]


class ApiKey(TimeStampedSoftDeleteModel):
    ACTIVE = "active"
    REVOKED = "revoked"
    STATUS_CHOICES = [(ACTIVE, ACTIVE), (REVOKED, REVOKED)]

    user = models.ForeignKey(User, related_name="api_keys", on_delete=models.CASCADE)
    created_by = models.ForeignKey(User, related_name="created_api_keys", on_delete=models.SET_NULL, blank=True, null=True)
    name = models.CharField(max_length=120)
    key_prefix = models.CharField(max_length=24, db_index=True)
    key_hash = models.CharField(max_length=128)
    permissions = models.JSONField(default=default_api_key_permissions, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default=ACTIVE)
    last_used_at = models.DateTimeField(blank=True, null=True)
    expires_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]

    def verify(self, raw_key):
        return check_password(raw_key, self.key_hash)

    def set_key(self, raw_key):
        self.key_prefix = raw_key[:18]
        self.key_hash = make_password(raw_key)


class ApiKeyRequestLog(models.Model):
    api_key = models.ForeignKey(ApiKey, related_name="request_logs", on_delete=models.CASCADE)
    method = models.CharField(max_length=10)
    path = models.CharField(max_length=255)
    status_code = models.PositiveSmallIntegerField(blank=True, null=True)
    response_time_ms = models.PositiveIntegerField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["api_key", "created_at"])]


class WebhookEndpoint(TimeStampedSoftDeleteModel):
    user = models.ForeignKey(User, related_name="webhook_endpoints", on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    url = models.URLField(max_length=500)
    events = models.JSONField(default=list)
    secret_ciphertext = models.TextField()
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["-created_at"]


class WebhookDelivery(TimeStampedSoftDeleteModel):
    STATUS_CHOICES = [
        ("pending", "pending"),
        ("sending", "sending"),
        ("delivered", "delivered"),
        ("failed", "failed"),
    ]

    endpoint = models.ForeignKey(WebhookEndpoint, related_name="deliveries", on_delete=models.CASCADE)
    event = models.CharField(max_length=80)
    payload = models.JSONField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default="pending")
    attempts = models.PositiveSmallIntegerField(default=0)
    next_attempt_at = models.DateTimeField(default=timezone.now, db_index=True)
    delivered_at = models.DateTimeField(blank=True, null=True)
    last_status_code = models.PositiveSmallIntegerField(blank=True, null=True)
    last_error = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["status", "next_attempt_at"])]


class AuthThrottleBucket(models.Model):
    key = models.CharField(max_length=64, unique=True)
    attempts = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField(db_index=True)
