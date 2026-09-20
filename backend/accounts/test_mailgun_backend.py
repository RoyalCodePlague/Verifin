from email import policy
from email.parser import BytesParser
from io import StringIO
from unittest.mock import Mock, patch

import requests
from django.core.exceptions import ImproperlyConfigured
from django.core.mail import EmailMessage, EmailMultiAlternatives
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase, override_settings

from .mailgun_backend import EmailBackend, MailgunDeliveryError


@override_settings(
    EMAIL_BACKEND="accounts.mailgun_backend.EmailBackend",
    MAILGUN_API_KEY="test-domain-sending-key",
    MAILGUN_DOMAIN="mg.example.test",
    MAILGUN_REGION="eu",
    EMAIL_TIMEOUT=20,
    DEFAULT_FROM_EMAIL="Verifin <no-reply@mg.example.test>",
)
class MailgunBackendTests(SimpleTestCase):
    def message(self):
        return EmailMessage("Verify your email", "Verification link", to=["recipient@example.test"])

    @patch("accounts.mailgun_backend.requests.post")
    def test_mime_preserves_html_attachment_and_private_bcc(self, post):
        post.return_value = Mock(status_code=200, json=Mock(return_value={"id": "<message-id>"}))
        message = EmailMultiAlternatives(
            "Verify your email", "Plain text", "Verifin <no-reply@mg.example.test>",
            ["recipient@example.test"], cc=["copy@example.test"], bcc=["private@example.test"],
            reply_to=["support@example.test"],
        )
        message.attach_alternative("<p>Verify your email</p>", "text/html")
        message.attach("receipt.txt", "Example attachment", "text/plain")
        self.assertEqual(EmailBackend().send_messages([message]), 1)
        args, kwargs = post.call_args
        self.assertEqual(args[0], "https://api.eu.mailgun.net/v3/mg.example.test/messages.mime")
        self.assertEqual(kwargs["auth"], ("api", "test-domain-sending-key"))
        self.assertEqual(kwargs["timeout"], 20)
        self.assertFalse(kwargs["allow_redirects"])
        self.assertEqual(kwargs["data"]["to"], message.recipients())
        self.assertEqual(kwargs["data"]["o:tracking-clicks"], "no")
        mime = BytesParser(policy=policy.default).parsebytes(kwargs["files"]["message"][1])
        self.assertEqual(mime["Reply-To"], "support@example.test")
        self.assertIsNone(mime["Bcc"])
        self.assertNotIn(b"private@example.test", kwargs["files"]["message"][1])
        self.assertEqual(mime.get_body(preferencelist=("html",)).get_content().strip(), "<p>Verify your email</p>")
        self.assertEqual(next(mime.iter_attachments()).get_filename(), "receipt.txt")
        post.return_value.close.assert_called_once()

    @override_settings(MAILGUN_REGION="us")
    @patch("accounts.mailgun_backend.requests.post")
    def test_us_endpoint(self, post):
        post.return_value = Mock(status_code=200, json=Mock(return_value={"id": "<message-id>"}))
        self.assertEqual(EmailBackend().send_messages([self.message()]), 1)
        self.assertEqual(post.call_args.args[0], "https://api.mailgun.net/v3/mg.example.test/messages.mime")

    @patch("accounts.mailgun_backend.requests.post")
    def test_provider_rejection_is_sanitized_and_not_retried(self, post):
        post.return_value = Mock(status_code=401, text="secret provider details")
        with self.assertRaises(MailgunDeliveryError) as error:
            EmailBackend().send_messages([self.message()])
        self.assertIn("HTTP 401", str(error.exception))
        self.assertNotIn("secret", str(error.exception))
        post.assert_called_once()
        self.assertEqual(EmailBackend(fail_silently=True).send_messages([self.message()]), 0)

    @patch("accounts.mailgun_backend.requests.post")
    def test_timeout_does_not_expose_request_details(self, post):
        post.side_effect = requests.Timeout("request with secret key and token")
        with self.assertRaises(MailgunDeliveryError) as error:
            EmailBackend().send_messages([self.message()])
        self.assertNotIn("secret", str(error.exception))
        post.assert_called_once()

    @patch("accounts.mailgun_backend.requests.post")
    def test_unconfirmed_response_is_not_counted_as_delivery(self, post):
        for result in ({}, [], None):
            post.return_value = Mock(status_code=200, json=Mock(return_value=result))
            self.assertEqual(EmailBackend(fail_silently=True).send_messages([self.message()]), 0)
        post.return_value = Mock(status_code=200, json=Mock(side_effect=ValueError))
        self.assertEqual(EmailBackend(fail_silently=True).send_messages([self.message()]), 0)

    @patch("accounts.mailgun_backend.requests.post")
    def test_missing_configuration_and_invalid_region_do_not_send(self, post):
        for values in ({"MAILGUN_API_KEY": ""}, {"MAILGUN_DOMAIN": ""}, {"MAILGUN_REGION": "invalid"}):
            with self.settings(**values), self.assertRaises(ImproperlyConfigured):
                EmailBackend().send_messages([self.message()])
        post.assert_not_called()

    @patch("accounts.mailgun_backend.requests.post")
    def test_empty_messages_and_recipients_do_not_send(self, post):
        self.assertEqual(EmailBackend().send_messages([]), 0)
        self.assertEqual(EmailBackend().send_messages([EmailMessage("subject", "body")]), 0)
        post.assert_not_called()

    @patch("accounts.mailgun_backend.requests.post")
    def test_configuration_check_does_not_make_network_request(self, post):
        output = StringIO()
        call_command("check_email_delivery", stdout=output)
        self.assertIn("Mailgun API settings are present", output.getvalue())
        self.assertNotIn("test-domain-sending-key", output.getvalue())
        post.assert_not_called()

    @override_settings(MAILGUN_API_KEY="")
    def test_configuration_check_reports_missing_key(self):
        with self.assertRaisesMessage(CommandError, "MAILGUN_API_KEY"):
            call_command("check_email_delivery", stdout=StringIO())

    @patch("accounts.mailgun_backend.requests.post")
    def test_explicit_delivery_test_sends_through_api(self, post):
        post.return_value = Mock(status_code=200, json=Mock(return_value={"id": "<message-id>"}))
        output = StringIO()
        call_command("check_email_delivery", to="recipient@example.test", stdout=output)
        self.assertIn("Provider accepted", output.getvalue())
        post.assert_called_once()
