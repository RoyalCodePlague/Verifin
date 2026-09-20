import os
import runpy
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase


class MailgunSettingsTests(SimpleTestCase):
    def load_settings(self, **environment):
        path = Path(__file__).resolve().parent.parent / "config" / "settings.py"
        with patch.dict(os.environ, environment, clear=True), patch("dotenv.load_dotenv"):
            return runpy.run_path(str(path))

    def test_api_key_selects_api_backend_without_smtp_credentials(self):
        config = self.load_settings(
            DEBUG="True", MAILGUN_API_KEY="test-key", MAILGUN_DOMAIN="mg.example.test", MAILGUN_REGION="EU",
        )
        self.assertEqual(config["EMAIL_BACKEND"], "accounts.mailgun_backend.EmailBackend")
        self.assertEqual(config["MAILGUN_REGION"], "eu")

    def test_explicit_backend_overrides_api_key(self):
        config = self.load_settings(
            MAILGUN_API_KEY="test-key", EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
        )
        self.assertEqual(config["EMAIL_BACKEND"], "django.core.mail.backends.console.EmailBackend")

    def test_mailgun_uses_starttls_and_smtp_even_in_debug(self):
        config = self.load_settings(
            DEBUG="True",
            MAILGUN_SMTP_USERNAME="postmaster@mg.example.test",
            MAILGUN_SMTP_PASSWORD="smtp-secret",
        )
        self.assertEqual(config["EMAIL_HOST"], "smtp.mailgun.org")
        self.assertEqual(config["EMAIL_PORT"], 587)
        self.assertTrue(config["EMAIL_USE_TLS"])
        self.assertFalse(config["EMAIL_USE_SSL"])
        self.assertEqual(config["EMAIL_BACKEND"], "django.core.mail.backends.smtp.EmailBackend")
        self.assertEqual(config["EMAIL_HOST_USER"], "postmaster@mg.example.test")
        self.assertEqual(config["EMAIL_HOST_PASSWORD"], "smtp-secret")

    def test_mailgun_does_not_mix_with_legacy_credentials(self):
        config = self.load_settings(
            MAILGUN_SMTP_HOST="smtp.eu.mailgun.org",
            EMAIL_HOST="smtp.gmail.com",
            EMAIL_HOST_USER="legacy@example.test",
            EMAIL_HOST_PASSWORD="legacy-password",
        )
        self.assertEqual(config["EMAIL_HOST"], "smtp.eu.mailgun.org")
        self.assertEqual(config["EMAIL_HOST_USER"], "")
        self.assertEqual(config["EMAIL_HOST_PASSWORD"], "")

    def test_explicit_preview_backend_is_respected(self):
        config = self.load_settings(
            MAILGUN_SMTP_HOST="smtp.mailgun.org",
            EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend",
        )
        self.assertEqual(config["EMAIL_BACKEND"], "django.core.mail.backends.console.EmailBackend")

    def test_eu_ssl_and_sender_overrides(self):
        config = self.load_settings(
            MAILGUN_SMTP_HOST="smtp.eu.mailgun.org",
            MAILGUN_SMTP_PORT="465",
            EMAIL_USE_TLS="False",
            EMAIL_USE_SSL="True",
            DEFAULT_FROM_EMAIL="Verifin <accounts@mg.example.test>",
        )
        self.assertEqual(config["EMAIL_HOST"], "smtp.eu.mailgun.org")
        self.assertEqual(config["EMAIL_PORT"], 465)
        self.assertFalse(config["EMAIL_USE_TLS"])
        self.assertTrue(config["EMAIL_USE_SSL"])
        self.assertEqual(config["DEFAULT_FROM_EMAIL"], "Verifin <accounts@mg.example.test>")

    def test_generic_smtp_remains_supported_when_mailgun_is_empty(self):
        config = self.load_settings(
            MAILGUN_SMTP_HOST="",
            MAILGUN_SMTP_USERNAME="",
            MAILGUN_SMTP_PASSWORD="",
            EMAIL_HOST="smtp.example.test",
            EMAIL_HOST_USER="user",
            EMAIL_HOST_PASSWORD="password",
        )
        self.assertEqual(config["EMAIL_HOST"], "smtp.example.test")
        self.assertEqual(config["EMAIL_HOST_USER"], "user")
        self.assertEqual(config["EMAIL_HOST_PASSWORD"], "password")
