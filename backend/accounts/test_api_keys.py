from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import ApiKey, ApiKeyRequestLog


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

    @override_settings(API_KEY_REQUESTS_PER_HOUR=2)
    def test_api_key_requests_are_logged_and_rate_limited(self):
        key = ApiKey(user=self.user, created_by=self.user, name="Reporting", key_prefix="", key_hash="", permissions=["inventory"])
        raw_key = "vf_live_usage_test_key"
        key.set_key(raw_key)
        key.save()

        integration = APIClient()
        integration.credentials(HTTP_X_API_KEY=raw_key)
        first = integration.get("/api/v1/inventory/products/pos-catalog/")
        second = integration.get("/api/v1/inventory/products/pos-catalog/")
        limited = integration.get("/api/v1/inventory/products/pos-catalog/")

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(second.status_code, 200, second.data)
        self.assertEqual(limited.status_code, 429, limited.data)
        logs = list(ApiKeyRequestLog.objects.filter(api_key=key).order_by("created_at", "id"))
        self.assertEqual(len(logs), 3)
        self.assertEqual([log.status_code for log in logs], [200, 200, 429])
        self.assertTrue(all(log.response_time_ms is not None for log in logs))
        self.assertTrue(all(log.path == "/api/v1/inventory/products/pos-catalog/" for log in logs))

        owner = APIClient()
        owner.force_authenticate(self.user)
        usage = owner.get("/api/v1/accounts/api-key-usage/")
        self.assertEqual(usage.status_code, 200, usage.data)
        self.assertEqual(len(usage.data), 3)
        self.assertEqual(usage.data[0]["api_key_name"], "Reporting")

    def test_scope_denied_requests_are_counted_and_logged(self):
        key = ApiKey(user=self.user, created_by=self.user, name="Inventory only", key_prefix="", key_hash="", permissions=["inventory"])
        raw_key = "vf_live_scope_test_key"
        key.set_key(raw_key)
        key.save()
        integration = APIClient()
        integration.credentials(HTTP_X_API_KEY=raw_key)

        denied = integration.get("/api/v1/sales/")

        self.assertEqual(denied.status_code, 403)
        usage = ApiKeyRequestLog.objects.get(api_key=key)
        self.assertEqual(usage.status_code, 403)
        self.assertEqual(usage.path, "/api/v1/sales/")

