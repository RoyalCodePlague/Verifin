from io import StringIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from accounts.mailgun_backend import MailgunDeliveryError
from notifications.models import NotificationPreference
from reports.models import AutomationEmailDispatch, AutomationPreferences


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class DailyEmailTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="email-owner",
            email="owner@example.com",
            business_name="Corner Shop",
        )

    @patch("reports.management.commands.send_daily_emails.send_mail", return_value=1)
    def test_opted_in_daily_summary_goes_only_to_the_business_account_email_and_is_idempotent(self, send_mail):
        NotificationPreference.objects.create(
            user=self.user,
            email_opt_in=True,
            email_daily_summary=True,
        )

        call_command("send_daily_emails", stdout=StringIO())
        call_command("send_daily_emails", stdout=StringIO())

        self.assertEqual(send_mail.call_count, 1)
        self.assertEqual(send_mail.call_args.kwargs["recipient_list"], ["owner@example.com"])
        self.assertIn("Corner Shop", send_mail.call_args.kwargs["message"])
        self.assertEqual(AutomationEmailDispatch.objects.get(user=self.user).status, AutomationEmailDispatch.SENT)

    @patch("reports.management.commands.send_daily_emails.send_mail")
    def test_email_is_not_sent_without_explicit_consent(self, send_mail):
        NotificationPreference.objects.create(
            user=self.user,
            email_opt_in=False,
            email_daily_summary=True,
        )

        call_command("send_daily_emails", stdout=StringIO())

        send_mail.assert_not_called()
        self.assertFalse(AutomationEmailDispatch.objects.exists())

    @patch("reports.management.commands.send_daily_emails.send_mail")
    def test_email_delivery_failure_is_reported_and_can_be_retried(self, send_mail):
        NotificationPreference.objects.create(
            user=self.user,
            email_opt_in=True,
            email_daily_summary=True,
        )
        send_mail.side_effect = [MailgunDeliveryError("Mailgun unavailable"), 1]

        with self.assertRaises(CommandError):
            call_command("send_daily_emails", stdout=StringIO())
        dispatch = AutomationEmailDispatch.objects.get(user=self.user)
        self.assertEqual(dispatch.status, AutomationEmailDispatch.PENDING)
        self.assertEqual(dispatch.attempts, 1)
        self.assertEqual(dispatch.last_error, "MailgunDeliveryError")

        call_command("send_daily_emails", stdout=StringIO())
        dispatch.refresh_from_db()
        self.assertEqual(dispatch.status, AutomationEmailDispatch.SENT)
        self.assertEqual(dispatch.attempts, 2)

    @patch("reports.management.commands.send_daily_emails.send_mail", return_value=1)
    def test_automation_alerts_require_email_channel_and_consent(self, send_mail):
        from billing.models import Plan
        from billing.services import get_or_create_subscription, sync_plan_catalog

        sync_plan_catalog(force=True)
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code=Plan.BUSINESS)
        subscription.status = "active"
        subscription.save()
        NotificationPreference.objects.create(user=self.user, email_opt_in=True)
        AutomationPreferences.objects.create(
            user=self.user,
            enabled_rules={
                "low_stock": False,
                "no_sales_today": True,
                "high_discrepancies": False,
                "high_expenses": False,
            },
            channel="email",
        )

        call_command("send_daily_emails", stdout=StringIO())

        self.assertEqual(send_mail.call_count, 1)
        self.assertIn("No sales have been recorded today.", send_mail.call_args.kwargs["message"])
