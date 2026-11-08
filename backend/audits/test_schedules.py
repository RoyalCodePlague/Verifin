from datetime import timedelta
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audits.models import Audit, AuditSchedule
from billing.models import Plan
from billing.services import get_or_create_subscription, sync_plan_catalog


class AuditScheduleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="audit-owner", email="audit@example.com")
        self.activate_plan("business")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def activate_plan(self, code):
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code=code)
        subscription.status = "active"
        subscription.save()

    def test_schedule_api_creates_next_run_and_supports_pause(self):
        response = self.client.post(
            "/api/v1/audits/schedules/",
            {"frequency": "weekly"},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        schedule = AuditSchedule.objects.get(user=self.user)
        self.assertEqual(schedule.frequency, "weekly")
        self.assertGreater(schedule.next_run_at, timezone.now())

        response = self.client.patch(
            f"/api/v1/audits/schedules/{schedule.id}/",
            {"is_active": False},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        schedule.refresh_from_db()
        self.assertFalse(schedule.is_active)

    def test_command_creates_one_audit_and_advances_due_schedule(self):
        schedule = AuditSchedule.objects.create(
            user=self.user,
            frequency="daily",
            next_run_at=timezone.now() - timedelta(days=2),
        )

        output = StringIO()
        call_command("run_scheduled_audits", stdout=output)
        self.assertEqual(Audit.objects.filter(schedule=schedule).count(), 1)
        schedule.refresh_from_db()
        self.assertIsNotNone(schedule.last_run_at)
        self.assertGreater(schedule.next_run_at, timezone.now())

        call_command("run_scheduled_audits", stdout=StringIO())
        self.assertEqual(Audit.objects.filter(schedule=schedule).count(), 1)

    def test_command_advances_schedule_without_creating_audit_when_feature_is_unavailable(self):
        self.activate_plan("starter")
        schedule = AuditSchedule.objects.create(
            user=self.user,
            frequency="weekly",
            next_run_at=timezone.now() - timedelta(days=8),
        )

        call_command("run_scheduled_audits", stdout=StringIO())

        self.assertFalse(Audit.objects.filter(schedule=schedule).exists())
        schedule.refresh_from_db()
        self.assertGreater(schedule.next_run_at, timezone.now())

