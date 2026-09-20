import re
from datetime import timedelta
from unittest.mock import Mock, patch
from django.contrib.auth import get_user_model
from django.core import mail
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from .models import AuthThrottleBucket

@override_settings(EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class EmailVerificationTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.email = "verify@example.test"
        self.password = "Strong-password-123!"

    def signup(self):
        return self.client.post("/api/v1/accounts/register/", {"email": self.email, "password": self.password}, format="json")

    def token(self):
        return re.search(r"token=([^\s]+)", mail.outbox[-1].body).group(1)

    def verify(self, token):
        return self.client.post("/api/v1/accounts/verify-email/", {"token": token}, format="json")

    def login(self):
        return self.client.post("/api/v1/accounts/login/", {"email": self.email, "password": self.password}, format="json")

    def test_pending_activation_single_use_and_promo_preserved(self):
        response = self.signup()
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["email_sent"])
        self.assertNotIn("access", response.data)
        self.assertNotIn("refresh", response.data)
        user = get_user_model().objects.get(email=self.email)
        original_expiry = user.subscription.launch_promo_ends_at
        token = self.token()
        self.assertNotEqual(user.email_verification_token, token)
        self.assertFalse(user.is_active)
        self.assertEqual(self.login().status_code, 400)
        verified = self.verify(token)
        self.assertEqual(verified.status_code, 200)
        self.assertEqual(verified["Cache-Control"], "no-store")
        self.assertEqual(verified.data["user"]["email"], self.email)
        self.assertTrue(verified.data["user"]["email_verified"])
        signed_in = APIClient()
        signed_in.credentials(HTTP_AUTHORIZATION=f"Bearer {verified.data['access']}")
        profile = signed_in.get("/api/v1/accounts/me/")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.data["email"], self.email)
        renewed = APIClient().post("/api/v1/accounts/token/refresh/", {"refresh": verified.data["refresh"]}, format="json")
        self.assertEqual(renewed.status_code, 200)
        reused = self.verify(token)
        self.assertEqual(reused.status_code, 400)
        self.assertNotIn("access", reused.data)
        self.assertNotIn("refresh", reused.data)
        self.assertEqual(self.login().status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.email_verified)
        self.assertFalse(user.email_verification_pending)
        self.assertEqual(user.subscription.launch_promo_ends_at, original_expiry)

    def test_expired_link_does_not_send_mail_or_activate(self):
        self.signup()
        token = self.token()
        with patch("accounts.email_verification.timezone.now", return_value=timezone.now()+timedelta(hours=25)):
            expired = self.verify(token)
            self.assertEqual(expired.status_code, 400)
            self.assertNotIn("access", expired.data)
            self.assertNotIn("refresh", expired.data)
        self.assertEqual(len(mail.outbox), 1)
        self.assertFalse(get_user_model().objects.get(email=self.email).is_active)

    def test_resend_rotates_link_and_applies_cooldown(self):
        self.signup()
        old = self.token()
        url = "/api/v1/accounts/resend-verification/"
        self.assertEqual(self.client.post(url, {"email":self.email}, format="json").status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        with patch("accounts.views.timezone.now", return_value=timezone.now()+timedelta(seconds=61)):
            self.assertEqual(self.client.post(url, {"email":self.email}, format="json").status_code, 200)
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(self.verify(old).status_code, 400)
        self.assertEqual(self.verify(self.token()).status_code, 200)

    def test_delivery_failure_stays_pending_and_allows_retry(self):
        with patch("accounts.email_verification.send_mail", side_effect=OSError("SMTP failed")):
            response = self.signup()
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["email_sent"])
        user = get_user_model().objects.get(email=self.email)
        self.assertFalse(user.is_active)
        self.assertEqual(user.email_verification_token, "")
        self.assertEqual(self.client.post("/api/v1/accounts/resend-verification/", {"email":self.email}, format="json").status_code, 200)
        self.assertEqual(len(mail.outbox), 1)

    @override_settings(EMAIL_BACKEND="accounts.mailgun_backend.EmailBackend", MAILGUN_API_KEY="test-key", MAILGUN_DOMAIN="mg.example.test", MAILGUN_REGION="eu")
    @patch("accounts.mailgun_backend.requests.post")
    def test_mailgun_signup_verification_and_failed_resend_preserves_link(self, post):
        from email import policy
        from email.parser import BytesParser

        post.return_value = Mock(status_code=200, json=Mock(return_value={"id": "<message-id>"}))
        response = self.signup()
        self.assertTrue(response.data["email_sent"])
        mime = BytesParser(policy=policy.default).parsebytes(post.call_args.kwargs["files"]["message"][1])
        token = re.search(r"token=([^\s]+)", mime.get_content()).group(1)
        post.return_value = Mock(status_code=503)
        with patch("accounts.views.timezone.now", return_value=timezone.now()+timedelta(seconds=61)):
            self.client.post("/api/v1/accounts/resend-verification/", {"email": self.email}, format="json")
        self.assertEqual(self.verify(token).status_code, 200)
        self.assertEqual(self.login().status_code, 200)

    @override_settings(EMAIL_BACKEND="accounts.mailgun_backend.EmailBackend", MAILGUN_API_KEY="", MAILGUN_DOMAIN="mg.example.test")
    def test_missing_mailgun_key_leaves_signup_pending(self):
        response = self.signup()
        self.assertFalse(response.data["email_sent"])
        self.assertFalse(get_user_model().objects.get(email=self.email).is_active)

    def test_get_request_does_not_consume_verification_link(self):
        self.signup()
        token = self.token()
        response = self.client.get("/api/v1/accounts/verify-email/", {"token": token})
        self.assertEqual(response.status_code, 405)
        self.assertFalse(get_user_model().objects.get(email=self.email).is_active)
        self.assertEqual(self.verify(token).status_code, 200)

    def test_invalid_link_never_returns_login_tokens(self):
        for token in ("unknown-token", "", "x" * 257):
            response = self.verify(token)
            self.assertEqual(response.status_code, 400)
            self.assertNotIn("access", response.data)
            self.assertNotIn("refresh", response.data)

    @override_settings(EMAIL_BACKEND="django.core.mail.backends.smtp.EmailBackend", EMAIL_HOST_USER="", EMAIL_HOST_PASSWORD="")
    def test_unconfigured_smtp_does_not_claim_email_sent(self):
        response = self.signup()
        self.assertFalse(response.data["email_sent"])
        self.assertTrue(response.data["verification_required"])

    def test_rate_limits_persist_in_database(self):
        self.signup()
        for _ in range(3):
            self.assertEqual(self.client.post("/api/v1/accounts/resend-verification/", {"email":self.email}, format="json").status_code, 200)
        response=self.client.post("/api/v1/accounts/resend-verification/", {"email":self.email}, format="json")
        self.assertEqual(response.status_code, 429)
        self.assertIn("Retry-After", response)
        self.assertTrue(AuthThrottleBucket.objects.exists())
        self.assertFalse(AuthThrottleBucket.objects.filter(key__contains=self.email).exists())

    def test_unknown_and_verified_resend_responses_match(self):
        self.signup()
        self.verify(self.token())
        a=self.client.post("/api/v1/accounts/resend-verification/", {"email":self.email}, format="json")
        b=self.client.post("/api/v1/accounts/resend-verification/", {"email":"unknown@example.test"}, format="json")
        self.assertEqual(a.data,b.data)
        self.assertEqual(len(mail.outbox),1)

    def test_deleted_pending_account_cannot_be_reactivated(self):
        self.signup()
        get_user_model().objects.filter(email=self.email).update(is_deleted=True)
        self.assertEqual(self.verify(self.token()).status_code,400)

    def test_login_is_rate_limited_without_disclosing_account_existence(self):
        for _ in range(10):
            self.assertEqual(self.login().status_code, 400)
        self.assertEqual(self.login().status_code, 429)

    def test_signup_is_rate_limited_by_ip(self):
        for i in range(5):
            self.email = f"person{i}@example.test"
            self.assertEqual(self.signup().status_code, 201)
        self.email = "sixth@example.test"
        self.assertEqual(self.signup().status_code, 429)

    def test_profile_cannot_mark_email_verified_or_change_it_without_verification(self):
        self.signup()
        self.verify(self.token())
        user = get_user_model().objects.get(email=self.email)
        self.client.force_authenticate(user)
        response = self.client.patch("/api/v1/accounts/me/", {"email":"another@example.test", "email_verified":True}, format="json")
        self.assertEqual(response.status_code,400)
        user.refresh_from_db()
        self.assertEqual(user.email,self.email)
