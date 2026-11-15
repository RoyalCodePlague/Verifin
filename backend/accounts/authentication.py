from rest_framework.exceptions import PermissionDenied
from rest_framework.exceptions import Throttled
from rest_framework_simplejwt.authentication import JWTAuthentication
from django.utils import timezone
from django.conf import settings
from django.db import transaction
from datetime import timedelta


ROLE_DEFAULT_PERMISSIONS = {
    "Owner": ["*"],
    "Administrator": ["dashboard", "inventory", "sales", "expenses", "customers", "reports", "audits", "suppliers", "staff", "settings"],
    "Branch Manager": ["dashboard", "inventory", "sales", "expenses", "customers", "reports", "audits", "suppliers"],
    "Manager": ["dashboard", "inventory", "sales", "expenses", "customers", "reports", "audits", "suppliers"],
    "Accountant": ["dashboard", "expenses", "customers", "reports", "suppliers", "financial"],
    "Inventory Manager": ["dashboard", "inventory", "audits", "suppliers"],
    "Stock Manager": ["dashboard", "inventory", "audits", "suppliers"],
    "Salesperson": ["dashboard", "sales", "customers", "inventory"],
    "Cashier": ["dashboard", "sales", "customers", "inventory"],
    "Custom": [],
}


PATH_PERMISSIONS = (
    ("/api/v1/accounts/staff", "staff"),
    ("/api/v1/sync/conflicts", "settings"),
    ("/api/v1/sync/pull", "settings"),
    ("/api/v1/accounts/api-keys", "settings"),
    ("/api/v1/accounts/api-key-usage", "settings"),
    ("/api/v1/accounts/webhooks", "settings"),
    ("/api/v1/accounts/webhook-deliveries", "settings"),
    ("/api/v1/accounts/profiles", "settings"),
    ("/api/v1/accounts/change-password", "settings"),
    ("/api/v1/accounts/logout-other-devices", "settings"),
    ("/api/v1/accounts/activity-logs", "staff"),
    ("/api/v1/accounts/approval-requests", "dashboard"),
    ("/api/v1/accounts/approval-settings", "settings"),
    ("/api/v1/reports/account-transactions", "financial"),
    ("/api/v1/reports/account-transfers", "financial"),
    ("/api/v1/reports/accounts", "financial"),
    ("/api/v1/inventory/supply-entries", "suppliers"),
    ("/api/v1/billing", "billing"),
    ("/api/v1/reports", "reports"),
    ("/api/v1/audits", "audits"),
    ("/api/v1/expenses", "expenses"),
    ("/api/v1/customers", "customers"),
    ("/api/v1/sales", "sales"),
    ("/api/v1/inventory/products/pos-catalog", "inventory"),
    ("/api/v1/inventory/products/pos-barcode-lookup", "inventory"),
    ("/api/v1/inventory/suppliers", "suppliers"),
    ("/api/v1/inventory/purchase-orders", "suppliers"),
    ("/api/v1/inventory", "inventory"),
)


class StaffAwareJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return self.authenticate_api_key(request)

        user, token = result
        if user.is_deleted or not user.email_verified:
            raise PermissionDenied("Verify your email before accessing this account.")
        staff_id = token.get("staff_id")
        if not staff_id:
            return result

        from .models import Staff
        staff = Staff.objects.filter(pk=staff_id, user=user, is_deleted=False, status=Staff.ACTIVE, login_enabled=True).first()
        if staff is None:
            raise PermissionDenied("This staff account is no longer active.")
        token["staff_permissions"] = staff.permissions
        token["staff_role"] = staff.role
        request.staff_member = staff
        permission = self.permission_for_path(request.path)
        if request.path == "/api/v1/billing/subscriptions/features/" and request.method in ("GET", "HEAD", "OPTIONS"):
            permission = None
        if request.path.startswith("/api/v1/accounts/me/") and request.method not in ("GET", "HEAD", "OPTIONS"):
            permission = "settings"
        if permission and not self.staff_can_access(token, permission):
            raise PermissionDenied("This staff account does not have access to this area.")
        financial_path = request.path.startswith((
            "/api/v1/reports/accounts/",
            "/api/v1/reports/account-transactions/",
            "/api/v1/reports/account-transfers/",
        ))
        if request.path.startswith("/api/v1/reports/") and not financial_path and not request.path.startswith(
            ("/api/v1/reports/branch-overview/", "/api/v1/reports/profit-loss/")
        ):
            raise PermissionDenied("This report is not scoped to the staff member's authorised branch.")
        return result

    @staticmethod
    def permission_for_path(path):
        for prefix, permission in PATH_PERMISSIONS:
            if path.startswith(prefix):
                return permission
        return None

    @staticmethod
    def staff_can_access(token, permission):
        permissions = token.get("staff_permissions")
        if permissions is None:
            permissions = ROLE_DEFAULT_PERMISSIONS.get(token.get("staff_role"), [])
        return "*" in permissions or permission in permissions

    def authenticate_api_key(self, request):
        raw_key = request.headers.get("X-API-Key", "").strip()
        auth_header = request.headers.get("Authorization", "").strip()
        if not raw_key and auth_header.lower().startswith("api-key "):
            raw_key = auth_header.split(" ", 1)[1].strip()
        if not raw_key:
            return None

        from .models import ApiKey, ApiKeyRequestLog

        prefix = raw_key[:18]
        candidates = ApiKey.objects.select_related("user").filter(
            key_prefix=prefix,
            status=ApiKey.ACTIVE,
            is_deleted=False,
            user__is_active=True,
            user__email_verified=True,
            user__is_deleted=False,
        )
        for api_key in candidates:
            if not api_key.verify(raw_key):
                continue
            now = timezone.now()
            limited = False
            expired = False
            django_request = getattr(request, "_request", request)
            with transaction.atomic():
                locked_key = ApiKey.objects.select_for_update().select_related("user").get(pk=api_key.pk)
                recent_requests = ApiKeyRequestLog.objects.filter(
                    api_key=locked_key,
                    created_at__gte=now - timedelta(hours=1),
                ).count()
                request.api_key = locked_key
                django_request.api_key = locked_key
                expired = bool(locked_key.expires_at and locked_key.expires_at <= now)
                if recent_requests >= settings.API_KEY_REQUESTS_PER_HOUR:
                    usage_log = ApiKeyRequestLog.objects.create(
                        api_key=locked_key, method=request.method, path=request.path[:255], status_code=429,
                    )
                    request.api_key_request_log_id = usage_log.id
                    django_request.api_key_request_log_id = usage_log.id
                    limited = True
                else:
                    usage_log = ApiKeyRequestLog.objects.create(
                        api_key=locked_key, method=request.method, path=request.path[:255],
                    )
                    request.api_key_request_log_id = usage_log.id
                    django_request.api_key_request_log_id = usage_log.id
                    if not expired:
                        locked_key.last_used_at = now
                        locked_key.save(update_fields=["last_used_at", "updated_at"])
            if limited:
                raise Throttled(wait=3600, detail="API key request limit exceeded. Try again later.")
            if expired:
                raise PermissionDenied("This API key has expired.")
            permission = self.permission_for_path(request.path)
            if permission is None:
                raise PermissionDenied("API keys can only access scoped integration endpoints.")
            permissions = locked_key.permissions or []
            if permission and "*" not in permissions and permission not in permissions:
                raise PermissionDenied("This API key does not have access to this area.")
            return (locked_key.user, locked_key)
        return None


def require_area(request, permission):
    token = request.auth
    if token is not None and hasattr(token, "get") and token.get("staff_id"):
        if not StaffAwareJWTAuthentication.staff_can_access(token, permission):
            raise PermissionDenied("This staff account does not have access to this area.")
