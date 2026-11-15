from rest_framework.exceptions import PermissionDenied


def get_staff_member(request):
    staff = getattr(request, "staff_member", None)
    if not staff or staff.user_id != request.user.id or staff.is_deleted:
        return None
    return staff


def scope_queryset_to_staff_branch(request, queryset, lookup="branch_id"):
    staff = get_staff_member(request)
    if staff is None:
        return queryset
    if not staff.branch_id:
        return queryset.none()
    return queryset.filter(**{lookup: staff.branch_id})


def require_staff_branch(request, branch_id):
    staff = get_staff_member(request)
    if staff and (not staff.branch_id or branch_id != staff.branch_id):
        raise PermissionDenied("This staff account does not have access to that branch.")


def require_business_owner(request):
    if get_staff_member(request):
        raise PermissionDenied("Only the business owner can manage branch settings.")


SENSITIVE_OPERATION_ROLE_DEFAULTS = {
    "sales.void": {"Owner", "Manager"},
    "sales.discount_approve": {"Owner", "Manager", "Administrator", "Branch Manager"},
    "sales.refund": {"Owner", "Manager", "Administrator", "Branch Manager"},
    "inventory.adjust": {"Owner", "Manager", "Administrator", "Stock Manager", "Inventory Manager", "Branch Manager"},
    "suppliers.pay": {"Owner", "Manager", "Administrator"},
    "purchasing.approve": {"Owner", "Manager", "Administrator", "Branch Manager"},
    "till.review": {"Owner", "Manager", "Administrator", "Branch Manager"},
    "financial.adjust": {"Owner", "Manager", "Administrator"},
}


def require_staff_operation(request, permission, *, staff=None):
    """Gate a sensitive mutation by a named operation permission or safe role default."""
    if getattr(request, "api_key", None):
        if permission in {
            "financial.adjust", "inventory.adjust", "purchasing.approve", "suppliers.pay",
            "till.review", "sales.discount_approve",
        }:
            raise PermissionDenied("API keys cannot approve this sensitive operation.")
        return
    if staff is None:
        staff = get_staff_member(request)
    if staff is None:
        return
    permissions = set(getattr(staff, "permissions", None) or [])
    if "*" in permissions or permission in permissions:
        return
    if getattr(staff, "role", None) in SENSITIVE_OPERATION_ROLE_DEFAULTS.get(permission, set()):
        return
    from .approvals import require_or_request_staff_approval

    require_or_request_staff_approval(request, staff, permission)
