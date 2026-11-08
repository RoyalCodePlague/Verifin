from datetime import date

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from inventory.models import Branch


class CustomReportTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog

        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="report-owner", email="reports@example.com")
        self.activate_plan("business")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def activate_plan(self, code):
        from billing.models import Plan
        from billing.services import get_or_create_subscription

        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code=code)
        subscription.status = "active"
        subscription.save()

    def test_templates_are_persisted_and_scoped_to_the_owner(self):
        branch = Branch.objects.create(user=self.user, name="Central")
        response = self.client.post(
            "/api/v1/reports/custom-reports/",
            {
                "name": "  Monthly sales  ",
                "metric": "sales",
                "group_by": "month",
                "start_date": "2026-01-01",
                "end_date": "2026-06-30",
                "branch_filter": "branch",
                "branch": branch.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["name"], "Monthly sales")
        template_id = response.data["id"]
        response = self.client.get("/api/v1/reports/custom-reports/")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["results"][0]["id"], template_id)

    def test_invalid_date_ranges_and_foreign_branches_are_rejected(self):
        other_user = get_user_model().objects.create_user(username="other-report", email="other-reports@example.com")
        foreign_branch = Branch.objects.create(user=other_user, name="Other")
        response = self.client.post(
            "/api/v1/reports/custom-reports/",
            {
                "name": "Invalid",
                "metric": "sales",
                "group_by": "day",
                "start_date": date(2026, 6, 1).isoformat(),
                "end_date": date(2026, 5, 1).isoformat(),
                "branch_filter": "branch",
                "branch": foreign_branch.id,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)

    def test_custom_reports_require_an_enabled_plan_feature(self):
        self.activate_plan("starter")
        response = self.client.get("/api/v1/reports/custom-reports/")

        self.assertEqual(response.status_code, 403, response.data)
