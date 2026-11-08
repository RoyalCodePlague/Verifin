import hashlib
import hmac
import json
import socket
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import WebhookDelivery, WebhookEndpoint
from accounts.webhooks import (
    WebhookSafetyError,
    decrypt_webhook_secret,
    deliver_due_webhooks,
    enqueue_webhook_event,
    resolve_public_addresses,
    validate_webhook_url,
)


class WebhookTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog

        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(username="hook-owner", email="hooks@example.com")
        from billing.models import Plan
        from billing.services import get_or_create_subscription

        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_registration_returns_a_secret_once_and_never_lists_it(self):
        response = self.client.post(
            "/api/v1/accounts/webhooks/",
            {"name": "Accounting", "url": "https://example.com/hooks/verifin", "events": ["sale.created"]},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        secret = response.data["secret"]
        endpoint = WebhookEndpoint.objects.get(user=self.user)
        self.assertNotEqual(endpoint.secret_ciphertext, secret)
        self.assertEqual(decrypt_webhook_secret(endpoint.secret_ciphertext), secret)

        response = self.client.get("/api/v1/accounts/webhooks/")
        self.assertEqual(response.status_code, 200, response.data)
        listed = response.data.get("results", response.data)[0]
        self.assertNotIn("secret", listed)
        self.assertNotIn("secret_ciphertext", listed)

    def test_registration_rejects_non_https_and_private_destinations(self):
        for url in ("http://example.com/hook", "https://127.0.0.1/hook"):
            with self.subTest(url=url):
                response = self.client.post(
                    "/api/v1/accounts/webhooks/",
                    {"name": "Unsafe", "url": url, "events": ["sale.created"]},
                    format="json",
                )
                self.assertEqual(response.status_code, 400, response.data)

    def test_event_dispatch_only_queues_matching_active_endpoints(self):
        endpoint = WebhookEndpoint.objects.create(
            user=self.user,
            name="Sales",
            url="https://example.com/hook",
            events=["sale.created"],
            secret_ciphertext="ciphertext",
        )

        queued = enqueue_webhook_event(self.user, "expense.created", {"expense_id": 1})
        self.assertEqual(queued, 0)
        queued = enqueue_webhook_event(self.user, "sale.created", {"sale_id": 5})

        self.assertEqual(queued, 1)
        self.assertEqual(WebhookDelivery.objects.get(endpoint=endpoint).payload, {"sale_id": 5})

    def test_delivery_is_signed_and_marks_success(self):
        endpoint = WebhookEndpoint.objects.create(
            user=self.user,
            name="Sales",
            url="https://example.com/hook",
            events=["sale.created"],
            secret_ciphertext="ciphertext",
        )
        secret = "whsec_example-secret"
        from accounts.webhooks import encrypt_webhook_secret
        endpoint.secret_ciphertext = encrypt_webhook_secret(secret)
        endpoint.save(update_fields=["secret_ciphertext", "updated_at"])
        delivery = WebhookDelivery.objects.create(
            endpoint=endpoint,
            event="sale.created",
            payload={"sale_id": 5},
        )
        response = type("Response", (), {"status": 204, "read": lambda self, size: b""})()

        with patch("accounts.webhooks.resolve_public_addresses", return_value=["93.184.216.34"]), \
             patch("accounts.webhooks._PinnedHTTPSConnection") as connection_class:
            connection_class.return_value.getresponse.return_value = response
            processed = deliver_due_webhooks()

        self.assertEqual(processed, 1)
        delivery.refresh_from_db()
        self.assertEqual(delivery.status, "delivered")
        self.assertEqual(delivery.attempts, 1)
        request = connection_class.return_value.request.call_args
        body = request.kwargs["body"]
        headers = request.kwargs["headers"]
        signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        self.assertEqual(headers["X-Verifin-Signature"], f"sha256={signature}")
        self.assertEqual(json.loads(body)["data"], {"sale_id": 5})

    def test_transient_failure_is_retried_and_local_dns_is_blocked(self):
        endpoint = WebhookEndpoint.objects.create(
            user=self.user,
            name="Sales",
            url="https://example.com/hook",
            events=["sale.created"],
            secret_ciphertext="ciphertext",
        )
        WebhookDelivery.objects.create(
            endpoint=endpoint,
            event="sale.created",
            payload={"sale_id": 5},
        )

        with patch("accounts.webhooks._send_delivery", side_effect=TimeoutError()):
            deliver_due_webhooks()

        delivery = WebhookDelivery.objects.get(endpoint=endpoint)
        self.assertEqual(delivery.status, "pending")
        self.assertEqual(delivery.attempts, 1)
        self.assertGreater(delivery.next_attempt_at, delivery.created_at)

        validate_webhook_url("https://example.com/hooks")
        with patch(
            "accounts.webhooks.socket.getaddrinfo",
            return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 443))],
        ):
            with self.assertRaises(WebhookSafetyError):
                resolve_public_addresses("example.com")

