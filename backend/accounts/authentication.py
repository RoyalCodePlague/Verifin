from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from django.utils import timezone


ROLE_DEFAULT_PERMISSIONS = {
    "Owner": ["*"],
    "Manager": ["dashboard", "inventory", "sales", "expenses", "customers", "reports", "audits", "suppliers"],
    "Stock Manager": ["dashboard", "inventory", "audits", "suppliers"],
    "Cashier": ["dashboard", "sales", "customers", "inventory"],
}


PATH_PERMISSIONS = (
    ("/api/v1/accounts/staff", "staff"),
    ("/api/v1/sync/conflicts", "settings"),
    ("/api/v1/sync/pull", "settings"),
    ("/api/v1/accounts/api-keys", "settings"),
    ("/api/v1/accounts/profiles", "settings"),
    ("/api/v1/accounts/change-password", "settings"),
    ("/api/v1/accounts/logout-other-devices", "settings"),
    ("/api/v1/accounts/activity-logs", "staff"),
    ("/api/v1/inventory/supply-entries", "suppliers"),
    ("/api/v1/billing", "billing"),
    ("/api/v1/reports", "reports"),
    ("/api/v1/audits", "audits"),
    ("/api/v1/expenses", "expenses"),
    ("/api/v1/customers", "customers"),
    ("/api/v1/sales", "sales"),
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

        from .models import ApiKey

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
            if api_key.expires_at and api_key.expires_at <= timezone.now():
                raise PermissionDenied("This API key has expired.")
            permission = self.permission_for_path(request.path)
            if permission is None:
                raise PermissionDenied("API keys can only access scoped integration endpoints.")
            permissions = api_key.permissions or []
            if permission and "*" not in permissions and permission not in permissions:
                raise PermissionDenied("This API key does not have access to this area.")
            api_key.last_used_at = timezone.now()
            api_key.save(update_fields=["last_used_at", "updated_at"])
            request.api_key = api_key
            return (api_key.user, api_key)
        return None


def require_area(request, permission):
    token = request.auth
    if token is not None and hasattr(token, "get") and token.get("staff_id"):
        if not StaffAwareJWTAuthentication.staff_can_access(token, permission):
            raise PermissionDenied("This staff account does not have access to this area.")
