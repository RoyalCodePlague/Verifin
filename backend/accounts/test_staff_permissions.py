from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Staff


class StaffPermissionPlanTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog

        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="staff-owner", email="staff-owner@example.com")
        from billing.models import Plan
        from billing.services import get_or_create_subscription

        self.subscription = get_or_create_subscription(self.user)
        self.subscription.plan = Plan.objects.get(code="starter")
        self.subscription.status = "active"
        self.subscription.save()
        self.staff = Staff.objects.create(
            user=self.user,
            name="Cashier",
            role=Staff.CASHIER,
            permissions=["dashboard", "sales", "customers", "inventory"],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_default_role_permissions_remain_available_on_starter(self):
        response = self.client.patch(
            f"/api/v1/accounts/staff/{self.staff.id}/",
            {"permissions": ["dashboard", "sales", "customers", "inventory"]},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)

    def test_custom_permissions_are_blocked_without_the_feature(self):
        response = self.client.patch(
            f"/api/v1/accounts/staff/{self.staff.id}/",
            {"permissions": ["dashboard", "reports"]},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.permissions, ["dashboard", "sales", "customers", "inventory"])

