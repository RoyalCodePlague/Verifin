from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from billing.models import Plan
from billing.services import get_or_create_subscription, sync_plan_catalog
from expenses.models import Expense
from inventory.models import Product
from notifications.models import NotificationLog
from reports.automation_engine import (
    dispatch_automation_event,
    evaluate_scheduled_automations,
    recover_stale_automation_executions,
    retry_automation_execution,
)
from reports.models import AccountTransaction, AutomationExecution, AutomationRule


class AutomationRuleTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="rule-owner", email="rules@example.com", currency="ZAR",
        )
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_rules_are_validated_and_scoped_to_the_business_owner(self):
        invalid = self.client.post("/api/v1/reports/automation-rules/", {
            "name": "Invalid rule", "trigger": "stock_below_minimum", "action": "require_manager_approval",
        }, format="json")
        self.assertEqual(invalid.status_code, 400, invalid.data)

        created = self.client.post("/api/v1/reports/automation-rules/", {
            "name": "Approve large expenses", "trigger": "expense_exceeds_limit",
            "conditions": {"amount_base": "500"}, "action": "require_manager_approval", "enabled": True,
        }, format="json")
        self.assertEqual(created.status_code, 201, created.data)

        other = get_user_model().objects.create_user(username="other-rule-owner", email="other-rules@example.com")
        other_subscription = get_or_create_subscription(other)
        other_subscription.plan = Plan.objects.get(code="business")
        other_subscription.status = "active"
        other_subscription.save()
        other_client = APIClient()
        other_client.force_authenticate(other)
        hidden = other_client.get(f"/api/v1/reports/automation-rules/{created.data['id']}/")
        self.assertEqual(hidden.status_code, 404)

    def test_stock_event_creates_one_notification_and_execution_for_repeated_delivery(self):
        rule = AutomationRule.objects.create(
            user=self.user, name="Low stock alert", trigger="stock_below_minimum", action="create_notification",
        )
        product = Product.objects.create(user=self.user, name="Tea", sku="TEA-1", stock=1, reorder_level=3)
        event_key = f"product:{product.pk}:{timezone.localdate().isoformat()}"

        first = dispatch_automation_event(
            self.user, rule.trigger, event_key, "product", product.pk,
            {"stock": product.stock, "reorder_level": product.reorder_level},
        )
        repeated = dispatch_automation_event(
            self.user, rule.trigger, event_key, "product", product.pk,
            {"stock": product.stock, "reorder_level": product.reorder_level},
        )

        self.assertEqual(len(first), 1)
        self.assertEqual(len(repeated), 1)
        self.assertEqual(AutomationExecution.objects.filter(rule=rule, event_key=event_key).count(), 1)
        self.assertEqual(NotificationLog.objects.filter(user=self.user, type="automation_stock_below_minimum").count(), 1)
        self.assertEqual(repeated[0].status, "succeeded")

    def test_failed_execution_can_be_retried_without_duplicate_notification(self):
        rule = AutomationRule.objects.create(
            user=self.user, name="Stock alert", trigger="stock_below_minimum", action="create_notification",
        )
        event_key = "product:999:2026-11-15"
        execution = dispatch_automation_event(self.user, rule.trigger, event_key, "product", 999)[0]
        self.assertEqual(execution.status, "failed")

        Product.objects.create(id=999, user=self.user, name="Late item", sku="LATE-1", stock=0, reorder_level=2)
        execution = retry_automation_execution(execution)

        self.assertEqual(execution.status, "succeeded")
        self.assertEqual(execution.attempts, 2)
        self.assertEqual(NotificationLog.objects.filter(user=self.user, type="automation_stock_below_minimum").count(), 1)

    def test_scheduled_low_stock_rule_is_idempotent_and_recovers_stale_execution(self):
        rule = AutomationRule.objects.create(
            user=self.user, name="Scheduled low stock", trigger="stock_below_minimum", action="create_notification",
        )
        product = Product.objects.create(user=self.user, name="Oil", sku="OIL-1", stock=0, reorder_level=4)
        today = timezone.localdate()

        evaluate_scheduled_automations(today=today)
        evaluate_scheduled_automations(today=today)
        self.assertEqual(AutomationExecution.objects.filter(rule=rule).count(), 1)
        self.assertEqual(NotificationLog.objects.filter(user=self.user, type="automation_stock_below_minimum").count(), 1)

        stale = AutomationExecution.objects.create(
            rule=rule, user=self.user, event_key="product:stale", object_type="product", object_id=str(product.pk),
            status="running", started_at=timezone.now() - timedelta(minutes=30),
        )
        self.assertEqual(recover_stale_automation_executions(now=timezone.now()), 1)
        stale.refresh_from_db()
        self.assertEqual(stale.status, "succeeded")
        self.assertEqual(stale.attempts, 2)

    def test_expense_threshold_holds_payment_until_owner_approval(self):
        AutomationRule.objects.create(
            user=self.user, name="Review expenses above 500", trigger="expense_exceeds_limit",
            conditions={"amount_base": "500.00"}, action="require_manager_approval",
        )

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post("/api/v1/expenses/", {
                "description": "Large equipment", "amount": "700.00", "currency": "ZAR",
                "date": timezone.localdate().isoformat(),
            }, format="json")

        self.assertEqual(response.status_code, 201, response.data)
        expense = Expense.objects.get(pk=response.data["id"])
        self.assertEqual(expense.approval_status, "pending")
        self.assertFalse(expense.account_posting_key)
        self.assertEqual(AccountTransaction.objects.filter(user=self.user, entry_type="expense_payment").count(), 0)
        execution = AutomationExecution.objects.get(rule__user=self.user, object_type="expense", object_id=str(expense.pk))
        self.assertEqual(execution.status, "succeeded")
