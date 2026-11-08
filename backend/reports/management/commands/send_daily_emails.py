from datetime import timedelta
from smtplib import SMTPException

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import send_mail
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.mailgun_backend import MailgunDeliveryError
from billing.services import has_feature
from notifications.models import NotificationPreference
from reports.models import AutomationEmailDispatch, AutomationPreferences
from reports.services import automation_alerts


class Command(BaseCommand):
    help = "Send opted-in daily business summaries and automation alerts."

    def handle(self, *args, **options):
        today = timezone.localdate()
        sent = 0
        skipped = 0
        failures = []
        preferences = NotificationPreference.objects.filter(
            email_opt_in=True,
            user__is_active=True,
            is_deleted=False,
        ).select_related("user")

        for notification_preference in preferences.iterator():
            user = notification_preference.user
            automation_preferences = AutomationPreferences.objects.filter(
                user=user,
                is_deleted=False,
            ).first()
            wants_automation_alerts = bool(
                automation_preferences
                and automation_preferences.channel == "email"
                and has_feature(user, "automation_rules")
            )
            wants_daily_summary = notification_preference.email_daily_summary
            if not wants_automation_alerts and not wants_daily_summary:
                skipped += 1
                continue

            alerts = automation_alerts(user)["alerts"] if wants_automation_alerts else []
            if not alerts and not wants_daily_summary:
                skipped += 1
                continue

            dispatch, _ = AutomationEmailDispatch.objects.get_or_create(
                user=user,
                delivery_date=today,
            )
            with transaction.atomic():
                dispatch = AutomationEmailDispatch.objects.select_for_update().get(pk=dispatch.pk)
                stale_sending = (
                    dispatch.status == AutomationEmailDispatch.SENDING
                    and dispatch.updated_at < timezone.now() - timedelta(minutes=30)
                )
                if dispatch.status == AutomationEmailDispatch.SENT or (
                    dispatch.status == AutomationEmailDispatch.SENDING and not stale_sending
                ):
                    skipped += 1
                    continue
                if dispatch.attempts >= 3:
                    skipped += 1
                    continue
                dispatch.status = AutomationEmailDispatch.SENDING
                dispatch.attempts += 1
                dispatch.last_error = ""
                dispatch.save(update_fields=["status", "attempts", "last_error", "updated_at"])

            body = self._build_message(user, today, alerts, wants_daily_summary)
            try:
                delivered = send_mail(
                    subject=f"Verifin daily update - {user.business_name or 'your business'}",
                    message=body,
                    from_email=settings.DEFAULT_FROM_EMAIL,
                    recipient_list=[user.email],
                    fail_silently=False,
                )
                if delivered != 1:
                    raise MailgunDeliveryError("Email backend did not confirm delivery.")
            except (MailgunDeliveryError, ImproperlyConfigured, SMTPException, OSError) as exc:
                dispatch.status = AutomationEmailDispatch.PENDING
                dispatch.last_error = type(exc).__name__
                dispatch.save(update_fields=["status", "last_error", "updated_at"])
                failures.append(user.email)
                continue

            dispatch.status = AutomationEmailDispatch.SENT
            dispatch.sent_at = timezone.now()
            dispatch.save(update_fields=["status", "sent_at", "updated_at"])
            sent += 1

        self.stdout.write(f"Sent {sent} email(s); skipped {skipped}; failed {len(failures)}.")
        if failures:
            raise CommandError(
                f"Email delivery failed for {len(failures)} account(s); review server mail configuration and retry."
            )

    @staticmethod
    def _build_message(user, today, alerts, include_summary):
        lines = [f"Verifin daily update for {user.business_name or 'your business'}", today.isoformat(), ""]
        if include_summary:
            from reports.business_services import generate_whatsapp_summary

            summary = generate_whatsapp_summary(user)["message"]
            lines.extend(
                line.replace("*", "")
                for line in summary.splitlines()
                if "Copy and send via WhatsApp." not in line
            )
        if alerts:
            if include_summary:
                lines.append("")
            lines.append("Automation alerts:")
            lines.extend(
                f"- [{alert['severity'].upper()}] {alert['message']}"
                for alert in alerts
            )
        lines.extend(["", "Manage email preferences in Verifin Settings."])
        return "\n".join(lines)
