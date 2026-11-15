from billing.services import has_feature

from .models import StaffActivityLog


def log_staff_activity(
    user,
    action,
    summary,
    *,
    actor=None,
    actor_staff=None,
    request=None,
    object_type="",
    object_id="",
    metadata=None,
):
    if not user or not getattr(user, "is_authenticated", False):
        return None
    if not has_feature(user, "staff_activity_logs"):
        return None

    if actor_staff is None and request is not None:
        from .branch_access import get_staff_member

        actor_staff = get_staff_member(request)
    actor = actor if getattr(actor, "is_authenticated", False) else user
    actor_name = actor_staff.name if actor_staff else getattr(actor, "email", "")
    event_metadata = dict(metadata or {})
    if request is not None:
        user_agent = str(request.META.get("HTTP_USER_AGENT", "")).strip()
        if user_agent:
            source = event_metadata.get("source")
            if not isinstance(source, dict):
                source = {}
                event_metadata["source"] = source
            source.setdefault("user_agent", user_agent[:500])

    return StaffActivityLog.objects.create(
        user=user,
        actor=actor,
        staff_actor=actor_staff,
        actor_name=actor_name,
        action=action,
        object_type=object_type,
        object_id=str(object_id or ""),
        summary=summary,
        metadata=event_metadata,
    )
