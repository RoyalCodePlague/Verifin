from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework.views import exception_handler

from .activity import log_staff_activity
from .approvals import ApprovalRequired
from .models import ApprovalRequest, Staff


def api_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if not isinstance(exc, ApprovalRequired) or response is None:
        return response

    request = context["request"]
    user = request.user
    now = timezone.now()
    staff = Staff.objects.filter(pk=exc.staff_id, user=user, is_deleted=False).first()
    if staff is None:
        return response

    ApprovalRequest.objects.filter(
        user=user,
        requested_by_staff=staff,
        action=exc.action,
        payload_hash=exc.payload_hash,
        status=ApprovalRequest.STATUS_PENDING,
        expires_at__lte=now,
    ).update(status=ApprovalRequest.STATUS_EXPIRED, updated_at=now)
    summary = f"{dict(ApprovalRequest.ACTION_CHOICES)[exc.action]} requested by {staff.name}"
    with transaction.atomic():
        approval, created = ApprovalRequest.objects.get_or_create(
            user=user,
            requested_by_staff=staff,
            action=exc.action,
            payload_hash=exc.payload_hash,
            status=ApprovalRequest.STATUS_PENDING,
            defaults={
                "branch_id": staff.branch_id,
                "payload": exc.payload,
                "summary": summary[:255],
                "expires_at": now + timedelta(days=7),
            },
        )
        if created:
            from notifications.models import NotificationLog

            NotificationLog.objects.create(
                user=user,
                type="approval_request_pending",
                message=f"{summary}. Review request #{approval.id} in Approvals.",
                channel="push",
            )
            log_staff_activity(
                user,
                "approval_requested",
                summary,
                actor=user,
                actor_staff=staff,
                request=request,
                object_type="approval_request",
                object_id=approval.id,
                metadata={"action": exc.action, "payload_hash": exc.payload_hash},
            )

    response.data = {
        "detail": f"Approval request #{approval.id} is pending. Retry the same operation after an authorized reviewer approves it.",
        "approval_request": approval.id,
    }
    return response
