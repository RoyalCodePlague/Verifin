from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from billing.models import Payment, Plan
from billing.providers import PaynowProvider
from billing.services import sync_plan_catalog


class PaynowProviderTests(TestCase):
    @override_settings(
        PAYNOW_ENABLED=True,
        PAYNOW_ENV="production",
        PAYNOW_INTEGRATION_ID="merchant-id",
        PAYNOW_INTEGRATION_KEY="merchant-key",
    )
    def test_provider_is_ready_with_production_configuration(self):
        provider = PaynowProvider()

        self.assertTrue(provider.enabled)
        self.assertTrue(provider.ready)
        self.assertIn("production", provider.status().detail)

    @override_settings(PAYNOW_ENABLED=True, PAYNOW_INTEGRATION_ID="", PAYNOW_INTEGRATION_KEY="")
    def test_provider_is_not_ready_without_credentials(self):
        provider = PaynowProvider()

        self.assertTrue(provider.enabled)
        self.assertFalse(provider.ready)

    @override_settings(
        PAYNOW_ENABLED=True,
        PAYNOW_ENV="production",
        PAYNOW_INTEGRATION_ID="merchant-id",
        PAYNOW_INTEGRATION_KEY="merchant-key",
        FRONTEND_URL="https://verifin.example.test",
    )
    @patch(
        "billing.paynow.initiate_checkout",
        return_value={
            "browserurl": "https://www.paynow.co.zw/interface/checkout",
            "pollurl": "https://www.paynow.co.zw/interface/poll",
        },
    )
    def test_production_checkout_creates_pending_payment(self, initiate_checkout):
        sync_plan_catalog(force=True)
        user = get_user_model().objects.create_user(
            username="paynow-owner",
            email="paynow@example.com",
        )
        client = APIClient()
        client.force_authenticate(user)

        response = client.post(
            "/api/v1/billing/subscriptions/paynow-checkout/",
            {"plan": Plan.GROWTH, "billing_period": "monthly", "country_code": "ZW"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        payment = Payment.objects.get(provider_payment_id=response.data["reference"])
        self.assertEqual(payment.status, Payment.PENDING)
        self.assertEqual(payment.provider, "paynow")
        self.assertEqual(payment.currency, "USD")
        self.assertEqual(payment.amount, 12)
        self.assertEqual(response.data["redirect_url"], "https://www.paynow.co.zw/interface/checkout")
        initiate_checkout.assert_called_once()

    @override_settings(PAYNOW_ENABLED=False)
    def test_checkout_is_unavailable_until_paynow_is_enabled(self):
        user = get_user_model().objects.create_user(username="paynow-off", email="paynow-off@example.com")
        client = APIClient()
        client.force_authenticate(user)

        response = client.post(
            "/api/v1/billing/subscriptions/paynow-checkout/",
            {"plan": Plan.GROWTH, "billing_period": "monthly", "country_code": "ZW"},
            format="json",
        )

        self.assertEqual(response.status_code, 503)
