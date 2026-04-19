from datetime import timedelta

from django.core import mail
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient

from django.contrib.auth import get_user_model

User = get_user_model()


def response_text(response, key="detail"):
    value = response.data[key]
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    return str(value)


@override_settings(
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    FRONTEND_URL="https://app.example.test",
    EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS=0,
)
class AccountAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_registered_user_cannot_login_until_email_is_verified(self):
        response = self.client.post(
            reverse("register"),
            {
                "email": "NewUser@Example.com",
                "password": "StrongPass123!",
                "business_name": "New Business",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        user = User.objects.get(email="newuser@example.com")
        self.assertFalse(user.email_verified)
        self.assertFalse(user.is_active)
        self.assertEqual(len(mail.outbox), 1)

        login_response = self.client.post(
            reverse("login"),
            {"email": "newuser@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(login_response.status_code, 400)
        self.assertIn("verify your email", response_text(login_response).lower())
        self.assertNotIn("access", login_response.data)

    def test_verified_user_can_login(self):
        user = User.objects.create_user(
            username="verified@example.com",
            email="verified@example.com",
            password="StrongPass123!",
            is_active=False,
            email_verified=False,
            email_verification_token="valid-token",
            email_verification_sent_at=timezone.now(),
        )

        verify_response = self.client.post(reverse("verify_email"), {"token": "valid-token"}, format="json")
        self.assertEqual(verify_response.status_code, 200)

        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertTrue(user.is_active)
        self.assertEqual(user.email_verification_token, "")

        login_response = self.client.post(
            reverse("login"),
            {"email": "verified@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(login_response.status_code, 200)
        self.assertIn("access", login_response.data)
        self.assertIn("refresh", login_response.data)

    def test_expired_verification_link_does_not_activate_account(self):
        old_token = "expired-token"
        user = User.objects.create_user(
            username="expired@example.com",
            email="expired@example.com",
            password="StrongPass123!",
            is_active=False,
            email_verified=False,
            email_verification_token=old_token,
            email_verification_sent_at=timezone.now() - timedelta(hours=25),
        )

        response = self.client.post(reverse("verify_email"), {"token": old_token}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertIn("expired", response_text(response).lower())
        user.refresh_from_db()
        self.assertFalse(user.email_verified)
        self.assertFalse(user.is_active)
        self.assertNotEqual(user.email_verification_token, old_token)
        self.assertEqual(len(mail.outbox), 1)
