from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from billing.services import has_feature
from audits.models import Audit, AuditSchedule


class Command(BaseCommand):
    help = "Create due stock audits from each account's active audit schedule."

    def handle(self, *args, **options):
        now = timezone.now()
        created = 0
        for schedule_id in AuditSchedule.objects.filter(
            is_active=True,
            is_deleted=False,
            next_run_at__lte=now,
        ).values_list("id", flat=True):
            with transaction.atomic():
                schedule = AuditSchedule.objects.select_for_update().select_related("user").get(pk=schedule_id)
                if not schedule.is_active or schedule.is_deleted or schedule.next_run_at > now:
                    continue
                if has_feature(schedule.user, "background_audits"):
                    Audit.objects.create(conductor=schedule.user, schedule=schedule)
                    created += 1
                schedule.last_run_at = now
                schedule.next_run_at += timedelta(days=1 if schedule.frequency == "daily" else 7)
                while schedule.next_run_at <= now:
                    schedule.next_run_at += timedelta(days=1 if schedule.frequency == "daily" else 7)
                schedule.save(update_fields=["last_run_at", "next_run_at", "updated_at"])
        self.stdout.write(self.style.SUCCESS(f"Created {created} scheduled audit(s)."))
