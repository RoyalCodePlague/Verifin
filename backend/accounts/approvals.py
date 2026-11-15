import hashlib
import json

from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from .activity import log_staff_activity
from .branch_access import require_staff_operation
from .models import ApprovalRequest, ApprovalSettings


class ApprovalRequired(PermissionDenied):
    def __init__(self, *, staff_id, action, payload, payload_hash):
        self.staff_id = staff_id
        self.action = action
        self.payload = payload
        self.payload_hash = payload_hash
        super().__init__("An authorized reviewer must approve this operation.")


def _json_safe(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, dict) or hasattr(value, "items"):
        result = {}
        for key, item in value.items():
            normalized_key = str(key)
            key_lower = normalized_key.casefold().replace("-", "_")
            if any(secret in key_lower for secret in ("password", "secret", "api_key", "authorization", "access_token", "refresh_token")):
                raise ValueError("Approval payloads cannot contain credentials or secrets.")
            result[normalized_key] = _json_safe(item)
        return result
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    raise ValueError("Approval payload must contain JSON-compatible values only.")


def approval_payload(value):
    if not isinstance(value, dict) and not hasattr(value, "items"):
        raise PermissionDenied("This operation cannot be requested for approval because its payload is not an object.")
    try:
        payload = _json_safe(value)
        serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    except (TypeError, ValueError) as exc:
        raise PermissionDenied(str(exc)) from exc
    if len(serialized.encode("utf-8")) > 32 * 1024:
        raise PermissionDenied("Approval payloads must be 32 KB or smaller.")
    return payload, hashlib.sha256(serialized.encode("utf-8")).hexdigest()


def require_or_request_staff_approval(request, staff, action):
    if not getattr(staff, "pk", None):
        raise PermissionDenied("A valid staff account is required for an approval request.")
    allowed_actions = dict(ApprovalRequest.ACTION_CHOICES)
    if action not in allowed_actions:
        raise PermissionDenied("This operation is not available through approval requests.")
    payload, digest = approval_payload({
        "request": {
            "method": str(getattr(request, "method", "POST")).upper(),
            "path": str(getattr(request, "path", "")),
            "query": list(getattr(getattr(request, "query_params", {}), "lists", lambda: [])()),
        },
        "data": getattr(request, "data", {}),
    })
    # Some endpoints validate once for an idempotency check and again in the
    # generic create flow. Reuse the approval consumed by the first validation
    # only within this same request and only for the identical action/payload.
    consumed_id = getattr(request, "approval_request_consumed_id", None)
    if consumed_id is None:
        consumed_id = getattr(getattr(request, "_request", request), "approval_request_consumed_id", None)
    if consumed_id:
        already_consumed = ApprovalRequest.objects.filter(
            pk=consumed_id,
            user=request.user,
            requested_by_staff=staff,
            action=action,
            payload_hash=digest,
            status=ApprovalRequest.STATUS_CONSUMED,
        ).first()
        if already_consumed:
            return already_consumed
    now = timezone.now()
    with transaction.atomic():
        ApprovalRequest.objects.select_for_update().filter(
            user=request.user,
            requested_by_staff=staff,
            action=action,
            payload_hash=digest,
            status=ApprovalRequest.STATUS_APPROVED,
            expires_at__lte=now,
        ).update(status=ApprovalRequest.STATUS_EXPIRED, updated_at=now)
        approved = ApprovalRequest.objects.select_for_update().filter(
            user=request.user,
            requested_by_staff=staff,
            action=action,
            payload_hash=digest,
            status=ApprovalRequest.STATUS_APPROVED,
            expires_at__gt=now,
        ).order_by("created_at", "id").first()
        if approved:
            if approved.branch_id != staff.branch_id:
                raise PermissionDenied("This approval request is assigned to a different branch.")
            else:
                approved.status = ApprovalRequest.STATUS_CONSUMED
                approved.consumed_at = now
                approved.save(update_fields=["status", "consumed_at", "updated_at"])
                request.approval_request_consumed_id = approved.id
                django_request = getattr(request, "_request", request)
                django_request.approval_request_consumed_id = approved.id
                log_staff_activity(
                    request.user, "approval_request_consumed", f"Used approval for {allowed_actions[action].lower()}",
                    actor=request.user, actor_staff=staff, request=request,
                    object_type="approval_request", object_id=approved.id,
                    metadata={"action": action, "payload_hash": digest},
                )
                return approved

    raise ApprovalRequired(
        staff_id=staff.id,
        action=action,
        payload=payload,
        payload_hash=digest,
    )

def require_approval_if_over_threshold(request, threshold_field, amount, permission):
    """Require an approver only when a business configured a threshold and it is exceeded."""
    settings_record, _ = ApprovalSettings.objects.get_or_create(user=request.user)
    threshold = getattr(settings_record, threshold_field)
    if threshold is None or amount <= threshold:
        return False
    if getattr(request, "api_key", None):
        raise PermissionDenied("This API key cannot perform an operation above the configured approval threshold.")
    require_staff_operation(request, permission)
    return True
