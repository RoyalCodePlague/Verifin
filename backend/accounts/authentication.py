from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication


ROLE_DEFAULT_PERMISSIONS = {
    "Owner": ["*"],
    "Manager": ["dashboard", "inventory", "sales", "expenses", "customers", "reports", "audits", "suppliers"],
    "Stock Manager": ["dashboard", "inventory", "audits", "suppliers"],
    "Cashier": ["dashboard", "sales", "customers", "inventory"],
}


PATH_PERMISSIONS = (
    ("/api/v1/accounts/staff", "staff"),
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
            return None

        user, token = result
        staff_id = token.get("staff_id")
        if not staff_id:
            return result

        permission = self.permission_for_path(request.path)
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
        permissions = token.get("staff_permissions") or ROLE_DEFAULT_PERMISSIONS.get(token.get("staff_role"), [])
        return "*" in permissions or permission in permissions
