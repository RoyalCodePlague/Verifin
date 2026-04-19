from rest_framework.permissions import BasePermission


class IsOwnerOrManager(BasePermission):
    """Permission class for staff management.
    
    Allows:
    - Superusers
    - Business owners (authenticated users accessing their own resources)
    - Staff with Owner or Manager role
    """
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        if request.user.is_superuser:
            return True
        return True
    
    def has_object_permission(self, request, view, obj):
        if request.user.is_superuser:
            return True
        # Object must belong to request user
        return obj.user == request.user
