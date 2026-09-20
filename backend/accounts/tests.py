from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

User = get_user_model()


@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class AccountAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_creates_pending_user_without_tokens(self):
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
        self.assertNotIn("access", response.data)
        self.assertNotIn("refresh", response.data)

        user = User.objects.get(email="newuser@example.com")
        self.assertFalse(user.is_active)
        self.assertFalse(user.email_verified)
        self.assertTrue(user.email_verification_pending)

    def test_unverified_email_blocks_login(self):
        User.objects.create_user(
            username="active@example.com",
            email="active@example.com",
            password="StrongPass123!",
            is_active=True,
            email_verified=False,
        )

        response = self.client.post(
            reverse("login"),
            {"email": "active@example.com", "password": "StrongPass123!"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access", response.data)
        self.assertNotIn("refresh", response.data)

    def test_invalid_login_still_rejected(self):
        response = self.client.post(
            reverse("login"),
            {"email": "missing@example.com", "password": "wrong"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access", response.data)

    def test_change_password_updates_credentials(self):
        user = User.objects.create_user(
            username="owner@example.com",
            email="owner@example.com",
            password="OldPass123!",
            is_active=True,
        )
        self.client.force_authenticate(user=user)

        response = self.client.post(
            reverse("change_password"),
            {
                "current_password": "OldPass123!",
                "new_password": "NewPass123!",
                "confirm_password": "NewPass123!",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password("NewPass123!"))

    def test_logout_other_devices_keeps_current_refresh(self):
        user = User.objects.create_user(
            username="security@example.com",
            email="security@example.com",
            password="StrongPass123!",
            is_active=True,
        )
        current_refresh = RefreshToken.for_user(user)
        other_refresh = RefreshToken.for_user(user)

        self.client.force_authenticate(user=user)
        response = self.client.post(
            reverse("logout_other_devices"),
            {"refresh": str(current_refresh)},
            format="json",
        )

        self.assertEqual(response.status_code, 200)

        current_check = self.client.post(
            reverse("token_refresh"),
            {"refresh": str(current_refresh)},
            format="json",
        )
        other_check = self.client.post(
            reverse("token_refresh"),
            {"refresh": str(other_refresh)},
            format="json",
        )

        self.assertEqual(current_check.status_code, 200)
        self.assertEqual(other_check.status_code, 401)
