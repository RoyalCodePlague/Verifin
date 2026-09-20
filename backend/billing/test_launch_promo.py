from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from inventory.models import Product
from .models import BillingCycle, Payment, Plan, SubscriptionEvent
from .services import get_or_create_subscription, has_feature, start_launch_promotion, sync_plan_catalog, activate_plan


@override_settings(LAUNCH_PROMO_ENABLED=True, BILLING_TEST_MODE=False, EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class LaunchPromotionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.client = APIClient()

    def signup(self):
        response = self.client.post("/api/v1/accounts/register/", {"email": "promo@example.test", "password": "Strong-promo-pass123", "business_name": "Shop"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        user = get_user_model().objects.get(email="promo@example.test")
        from django.core import mail
        import re
        token = re.search(r"token=([^\s]+)", mail.outbox[-1].body).group(1)
        self.assertEqual(self.client.post("/api/v1/accounts/verify-email/", {"token": token}, format="json").status_code, 200)
        user.refresh_from_db()
        self.client.force_authenticate(user)
        return user

    def test_signup_grants_exactly_thirty_days_without_payment(self):
        user = self.signup()
        sub = get_or_create_subscription(user)
        self.assertEqual(sub.plan.code, "business")
        self.assertEqual(sub.provider, "launch_promo")
        self.assertEqual(sub.launch_promo_ends_at - sub.launch_promo_started_at, timedelta(days=30))
        self.assertTrue(has_feature(user, "audits"))
        self.assertFalse(Payment.objects.exists())
        self.assertFalse(BillingCycle.objects.exists())
        overview = self.client.get("/api/v1/billing/subscriptions/current/")
        self.assertIsNotNone(overview.data["subscription"]["launch_promo_ends_at"])
        self.assertEqual(overview.data["available_actions"], ["downgrade"])

    def test_expiry_boundary_downgrades_once_and_preserves_data(self):
        user = self.signup()
        sub = get_or_create_subscription(user)
        product = Product.objects.create(user=user, name="Bread", sku="bread", stock=20, price=5)
        with patch("billing.services.timezone.now", return_value=sub.launch_promo_ends_at - timedelta(microseconds=1)):
            self.assertTrue(has_feature(user, "audits"))
        with patch("billing.services.timezone.now", return_value=sub.launch_promo_ends_at):
            self.assertFalse(has_feature(user, "audits"))
            current = get_or_create_subscription(user)
            self.assertEqual(current.plan.code, "starter")
            self.assertEqual(current.status, "active")
            self.assertIsNone(current.grace_period_ends_at)
            self.assertIsNone(current.current_period_end)
            self.assertEqual(start_launch_promotion(user).plan.code, "starter")
            response = self.client.get("/api/v1/audits/")
            self.assertEqual(response.status_code, 200, response.data)
            response = self.client.post("/api/v1/audits/", {}, format="json")
            self.assertEqual(response.status_code, 403, response.data)
        product.refresh_from_db()
        self.assertEqual(product.stock, 20)
        self.assertFalse(product.is_deleted)
        self.assertEqual(SubscriptionEvent.objects.filter(event_type="launch_promo_expired").count(), 1)
        limit = current.plan.limits.get(key="products")
        self.assertEqual(limit.limit, 50)

    @override_settings(LAUNCH_PROMO_ENABLED=False)
    def test_disabled_promo_is_not_advertised_or_granted(self):
        user = self.signup()
        self.assertEqual(get_or_create_subscription(user).plan.code, "starter")
        response = self.client.get("/api/v1/billing/pricing-context/")
        self.assertFalse(response.data["launch_promotion"]["enabled"])

    def test_existing_user_does_not_get_promotion_on_access(self):
        user = get_user_model().objects.create_user(username="existing", email="existing@example.test", password="test")
        self.assertEqual(get_or_create_subscription(user).plan.code, "starter")

    def test_public_billing_shortcuts_cannot_extend_or_upgrade(self):
        user = self.signup()
        sub = get_or_create_subscription(user)
        for action in ["mock-checkout", "mock-trial", "upgrade", "renew", "resume", "expire", "cancel", "pesepay-checkout", "downgrade"]:
            with self.subTest(action=action):
                response = self.client.post(f"/api/v1/billing/subscriptions/{action}/", {"plan": "business", "trial_days": 365}, format="json")
                self.assertEqual(response.status_code, 403, response.data)
        current = get_or_create_subscription(user)
        self.assertEqual(current.launch_promo_ends_at, sub.launch_promo_ends_at)
        self.assertEqual(current.provider, "launch_promo")
        self.assertFalse(Payment.objects.exists())

    def test_early_downgrade_does_not_restart_promotion(self):
        user = self.signup()
        response = self.client.post("/api/v1/billing/subscriptions/downgrade/", {"plan": "starter"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(start_launch_promotion(user).plan.code, "starter")
        self.assertFalse(Payment.objects.exists())

    def test_new_entitlement_is_not_overwritten_at_promo_expiry(self):
        user = self.signup()
        old = get_or_create_subscription(user)
        with patch("billing.services.timezone.now", return_value=old.launch_promo_started_at + timedelta(days=20)):
            activate_plan(user, "business")
        with patch("billing.services.timezone.now", return_value=old.launch_promo_ends_at):
            self.assertEqual(get_or_create_subscription(user).plan.code, "business")

    def test_scheduled_expiry(self):
        user = self.signup()
        sub = get_or_create_subscription(user)
        with patch("billing.services.timezone.now", return_value=sub.launch_promo_ends_at):
            call_command("expire_launch_promotions", verbosity=0)
        sub.refresh_from_db()
        self.assertEqual(sub.plan.code, "starter")
