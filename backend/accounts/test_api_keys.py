from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import ApiKey


class ApiKeyManagementTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog

        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="api-owner", email="api@example.com")
        from billing.models import Plan
        from billing.services import get_or_create_subscription

        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_api_key_is_only_returned_at_creation_and_can_be_revoked(self):
        response = self.client.post(
            "/api/v1/accounts/api-keys/",
            {"name": "Warehouse integration", "permissions": ["inventory"]},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        raw_key = response.data["raw_key"]
        key = ApiKey.objects.get(user=self.user)
        self.assertTrue(key.verify(raw_key))
        self.assertNotEqual(key.key_hash, raw_key)

        response = self.client.get("/api/v1/accounts/api-keys/")
        self.assertEqual(response.status_code, 200, response.data)
        listed = response.data.get("results", response.data)[0]
        self.assertNotIn("raw_key", listed)

        response = self.client.post(f"/api/v1/accounts/api-keys/{key.id}/revoke/")
        self.assertEqual(response.status_code, 200, response.data)
        key.refresh_from_db()
        self.assertEqual(key.status, ApiKey.REVOKED)

    def test_api_key_expiration_must_be_in_the_future(self):
        response = self.client.post(
            "/api/v1/accounts/api-keys/",
            {
                "name": "Expired key",
                "permissions": ["inventory"],
                "expires_at": (timezone.now() - timedelta(minutes=1)).isoformat(),
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(ApiKey.objects.filter(user=self.user).exists())

