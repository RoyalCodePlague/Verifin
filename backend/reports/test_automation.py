from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audits.models import Audit, Discrepancy
from expenses.models import Expense, ExpenseCategory
from inventory.models import Product
from reports.models import AutomationPreferences
from reports.services import automation_alerts


class AutomationPreferencesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog

        sync_plan_catalog(force=True)

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="automation-owner", email="automation@example.com")
        from billing.models import Plan
        from billing.services import get_or_create_subscription

        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_preferences_are_created_and_persisted_per_account(self):
        response = self.client.get("/api/v1/reports/automation-preferences/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["enabled_rules"]["low_stock"], True)
        self.assertEqual(response.data["channel"], "in_app")

        response = self.client.patch(
            "/api/v1/reports/automation-preferences/",
            {"enabled_rules": {"low_stock": False, "high_expenses": True}, "severity": "critical"},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        preferences = AutomationPreferences.objects.get(user=self.user)
        self.assertEqual(preferences.enabled_rules["low_stock"], False)
        self.assertEqual(preferences.enabled_rules["no_sales_today"], True)
        self.assertEqual(preferences.enabled_rules["high_expenses"], True)
        self.assertEqual(preferences.severity, "critical")

    def test_preferences_reject_unknown_rules_and_invalid_values(self):
        response = self.client.patch(
            "/api/v1/reports/automation-preferences/",
            {"enabled_rules": {"unknown_rule": True}},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)

    def test_alerts_respect_disabled_rules_and_severity_preferences(self):
        Product.objects.create(user=self.user, name="Out of stock", sku="EMPTY", stock=0, reorder_level=1)
        preferences = AutomationPreferences.objects.create(
            user=self.user,
            enabled_rules={"low_stock": False, "no_sales_today": True, "high_discrepancies": False, "high_expenses": False},
            severity="critical",
        )

        result = automation_alerts(self.user)

        self.assertEqual([alert["rule"] for alert in result["alerts"]], ["no_sales_today"])
        self.assertEqual(result["alerts"][0]["severity"], "critical")

    def test_high_discrepancies_and_expenses_rules_are_evaluated(self):
        audit = Audit.objects.create(conductor=self.user)
        for index in range(3):
            product = Product.objects.create(user=self.user, name=f"Item {index}", sku=f"ITEM-{index}")
            Discrepancy.objects.create(
                audit=audit,
                product=product,
                expected_stock=5,
                actual_stock=0,
                difference=-5,
            )
        category = ExpenseCategory.objects.create(name="General")
        yesterday = timezone.localdate() - timedelta(days=1)
        for index in range(30):
            Expense.objects.create(
                description=f"Baseline {index}",
                amount=Decimal("100.00"),
                amount_base=Decimal("100.00"),
                date=yesterday - timedelta(days=index),
                category=category,
                created_by=self.user,
            )
        Expense.objects.create(
            description="Large expense",
            amount=Decimal("200.00"),
            amount_base=Decimal("200.00"),
            date=timezone.localdate(),
            category=category,
            created_by=self.user,
        )
        AutomationPreferences.objects.create(
            user=self.user,
            enabled_rules={"low_stock": False, "no_sales_today": False, "high_discrepancies": True, "high_expenses": True},
        )

        result = automation_alerts(self.user)

        self.assertEqual({alert["rule"] for alert in result["alerts"]}, {"high_discrepancies", "high_expenses"})

