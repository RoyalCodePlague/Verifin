from billing.services import has_feature

from .models import StaffActivityLog


def log_staff_activity(user, action, summary, *, actor=None, object_type="", object_id="", metadata=None):
    if not user or not getattr(user, "is_authenticated", False):
        return None
    if not has_feature(user, "staff_activity_logs"):
        return None
    return StaffActivityLog.objects.create(
        user=user,
        actor=actor if getattr(actor, "is_authenticated", False) else user,
        action=action,
        object_type=object_type,
        object_id=str(object_id or ""),
        summary=summary,
        metadata=metadata or {},
    )
