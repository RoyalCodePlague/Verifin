from datetime import timedelta
from uuid import uuid4
from io import StringIO

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from core.analytics import record_activation_event
from core.models import AnalyticsConsent, ProductEvent


class AnalyticsConsentTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="analytics-owner",
            email="analytics@example.com",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_events_are_not_recorded_until_opted_in_and_opt_out_deletes_them(self):
        self.assertFalse(record_activation_event(self.user, "first_product_added"))
        self.assertFalse(ProductEvent.objects.exists())

        enabled = self.client.patch("/api/v1/core/analytics-consent/", {"enabled": True}, format="json")
        self.assertEqual(enabled.status_code, 200, enabled.data)
        self.assertTrue(record_activation_event(self.user, "first_product_added"))
        self.assertFalse(record_activation_event(self.user, "first_product_added"))

        consent = AnalyticsConsent.objects.get(user=self.user)
        event = ProductEvent.objects.get(event="first_product_added")
        self.assertEqual(event.account_ref, consent.analytics_id)
        self.assertFalse(hasattr(event, "user_id"))

        disabled = self.client.patch("/api/v1/core/analytics-consent/", {"enabled": False}, format="json")
        self.assertEqual(disabled.status_code, 200, disabled.data)
        self.assertFalse(ProductEvent.objects.exists())

    def test_invalid_consent_payload_is_rejected(self):
        response = self.client.patch("/api/v1/core/analytics-consent/", {"enabled": "yes"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_account_deletion_removes_pseudonymous_events(self):
        consent = AnalyticsConsent.objects.create(user=self.user, opted_in=True)
        ProductEvent.objects.create(account_ref=consent.analytics_id, event="first_sale_recorded")

        self.user.delete()

        self.assertFalse(ProductEvent.objects.exists())

    def test_retention_command_deletes_events_older_than_twelve_months(self):
        old_event = ProductEvent.objects.create(account_ref=uuid4(), event="old_event")
        current_event = ProductEvent.objects.create(account_ref=uuid4(), event="current_event")
        ProductEvent.objects.filter(pk=old_event.pk).update(created_at=timezone.now() - timedelta(days=366))

        call_command("purge_product_events", stdout=StringIO())

        self.assertFalse(ProductEvent.objects.filter(pk=old_event.pk).exists())
        self.assertTrue(ProductEvent.objects.filter(pk=current_event.pk).exists())
