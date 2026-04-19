from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APIClient

User = get_user_model()


class AccountAuthTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_register_returns_tokens_and_creates_active_user(self):
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
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

        user = User.objects.get(email="newuser@example.com")
        self.assertTrue(user.is_active)
        self.assertTrue(user.email_verified)

    def test_verified_flag_does_not_block_login_for_now(self):
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

        self.assertEqual(response.status_code, 200)
        self.assertIn("access", response.data)
        self.assertIn("refresh", response.data)

    def test_invalid_login_still_rejected(self):
        response = self.client.post(
            reverse("login"),
            {"email": "missing@example.com", "password": "wrong"},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertNotIn("access", response.data)
