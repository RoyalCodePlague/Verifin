from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken
from billing.models import SubscriptionEvent
from billing.services import get_or_create_subscription, sync_plan_catalog


@override_settings(GOOGLE_CLIENT_ID="web-client.apps.googleusercontent.com", FRONTEND_URL="https://shop.example", LAUNCH_PROMO_ENABLED=True)
class GoogleSignInTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        config = self.client.get("/api/v1/accounts/google/")
        self.nonce = config.data["nonce"]
        self.claims = {"sub": "google-user-123", "email": "owner@gmail.com", "email_verified": True, "iss": "https://accounts.google.com", "nonce": self.nonce}

    def signin(self, **extra):
        return self.client.post("/api/v1/accounts/google/", {"credential": "google-token", "nonce": self.nonce, **extra}, format="json", HTTP_ORIGIN="https://shop.example")

    def test_new_account_and_returning_login_get_same_user_and_one_promo(self):
        with patch("accounts.google_auth.id_token.verify_oauth2_token", return_value=self.claims) as verify:
            first = self.signin(business_name="My shop")
            self.assertEqual(first.status_code, 200, first.data)
            verify.assert_called_once()
            self.assertEqual(verify.call_args.args[2], "web-client.apps.googleusercontent.com")
            second = self.signin()
        self.assertEqual(second.status_code, 200)
        self.assertTrue(first.data["created"])
        self.assertFalse(second.data["created"])
        self.assertEqual(first.data["user"]["id"], second.data["user"]["id"])
        user = get_user_model().objects.get(pk=first.data["user"]["id"])
        self.assertFalse(user.has_usable_password())
        self.assertEqual(str(AccessToken(first.data["access"])["user_id"]), str(user.id))
        sub = get_or_create_subscription(user)
        self.assertEqual(sub.plan.code, "business")
        self.assertEqual(sub.launch_promo_ends_at - sub.launch_promo_started_at, timedelta(days=30))
        self.assertEqual(SubscriptionEvent.objects.filter(event_type="launch_promo_started").count(), 1)
        with patch("billing.services.timezone.now", return_value=sub.launch_promo_ends_at):
            self.assertEqual(get_or_create_subscription(user).plan.code, "starter")
        with patch("accounts.google_auth.id_token.verify_oauth2_token", return_value=self.claims):
            self.assertEqual(self.signin().status_code, 200)
        self.assertEqual(get_or_create_subscription(user).plan.code, "starter")

    def test_existing_gmail_links_without_changing_password_or_granting_promo(self):
        user = get_user_model().objects.create_user(username="old", email="owner@gmail.com", password="existing-password")
        with patch("accounts.google_auth.id_token.verify_oauth2_token", return_value=self.claims):
            response = self.signin()
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["created"])
        user.refresh_from_db()
        self.assertTrue(user.check_password("existing-password"))
        self.assertEqual(user.google_subject, self.claims["sub"])
        self.assertEqual(get_or_create_subscription(user).plan.code, "starter")

    def test_third_party_email_cannot_take_over_existing_account(self):
        self.claims["email"] = "owner@example.com"
        get_user_model().objects.create_user(username="old", email=self.claims["email"], password="test")
        with patch("accounts.google_auth.id_token.verify_oauth2_token", return_value=self.claims):
            self.assertEqual(self.signin().status_code, 403)

    def test_disabled_account_cannot_login(self):
        get_user_model().objects.create_user(username="old", email=self.claims["email"], password="test", is_active=False)
        with patch("accounts.google_auth.id_token.verify_oauth2_token", return_value=self.claims):
            self.assertEqual(self.signin().status_code, 403)

    def test_rejects_invalid_token_and_claims(self):
        with patch("accounts.google_auth.id_token.verify_oauth2_token", side_effect=ValueError("Invalid signature")):
            self.assertEqual(self.signin().status_code, 403)
        for changed in [{"nonce": "wrong"}, {"email_verified": False}, {"iss": "https://evil.example"}, {"sub": ""}]:
            with self.subTest(changed=changed), patch("accounts.google_auth.id_token.verify_oauth2_token", return_value={**self.claims, **changed}):
                self.assertEqual(self.signin().status_code, 403)
        self.assertFalse(get_user_model().objects.exists())

    def test_expired_nonce_and_untrusted_origin(self):
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 601), patch("accounts.google_auth.id_token.verify_oauth2_token") as verify:
            self.assertEqual(self.signin().status_code, 403)
            verify.assert_not_called()
        response = self.client.post("/api/v1/accounts/google/", {"credential": "token", "nonce": self.nonce}, format="json", HTTP_ORIGIN="https://evil.example")
        self.assertEqual(response.status_code, 403)
        response = self.client.post("/api/v1/accounts/google/", {"credential": "token", "nonce": self.nonce}, HTTP_ORIGIN="https://shop.example")
        self.assertEqual(response.status_code, 415)

    @override_settings(GOOGLE_CLIENT_ID="")
    def test_unconfigured_google_is_disabled(self):
        self.assertEqual(self.client.get("/api/v1/accounts/google/").data["client_id"], "")
        self.assertEqual(self.signin().status_code, 503)

    def test_invalid_referral_does_not_leave_partial_account(self):
        with patch("accounts.google_auth.id_token.verify_oauth2_token", return_value=self.claims):
            self.assertEqual(self.signin(referral_code="BAD-CODE").status_code, 400)
        self.assertFalse(get_user_model().objects.exists())

    def test_google_claims_pending_account_without_reusing_unverified_password(self):
        user = get_user_model().objects.create_user(username="pending", email=self.claims["email"], password="unverified-password", is_active=False, email_verified=False, email_verification_pending=True, email_verification_token="old-token")
        with patch("accounts.google_auth.id_token.verify_oauth2_token", return_value=self.claims):
            response = self.signin()
        self.assertEqual(response.status_code,200,response.data)
        self.assertFalse(response.data["created"])
        user.refresh_from_db()
        self.assertTrue(user.is_active)
        self.assertTrue(user.email_verified)
        self.assertFalse(user.email_verification_pending)
        self.assertFalse(user.has_usable_password())
        self.assertEqual(user.email_verification_token, "")
