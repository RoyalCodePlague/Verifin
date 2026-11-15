import calendar
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Staff
from billing.models import Plan
from billing.services import get_or_create_subscription, sync_plan_catalog
from customers.models import Customer
from expenses.models import Expense, ExpenseBudget, ExpenseCategory
from inventory.models import Branch, Product, PurchaseOrder, PurchaseOrderItem, Supplier, SupplierPayment
from reports.models import AccountTransaction, BankAccount
from sales.models import Sale, SaleItem, TillSession


class BusinessInsightTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = self.create_business_user("insight-owner")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def create_business_user(self, username):
        user = get_user_model().objects.create_user(
            username=username, email=f"{username}@example.com", password="Secure123!",
        )
        subscription = get_or_create_subscription(user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        return user

    def create_sale(self, product, amount, sale_date=None):
        sale = Sale.objects.create(
            created_by=self.user,
            total=Decimal(amount),
            total_cost=Decimal(amount) / 2,
            gross_profit=Decimal(amount) / 2,
        )
        if sale_date:
            Sale.objects.filter(pk=sale.pk).update(date=sale_date)
        SaleItem.objects.create(
            sale=sale,
            product=product,
            quantity=2,
            unit_cost=Decimal(amount) / 4,
            unit_price=Decimal(amount) / 2,
            subtotal=Decimal(amount),
            cost_total=Decimal(amount) / 2,
            profit=Decimal(amount) / 2,
        )
        return sale

    def test_partial_month_comparison_and_insight_evidence_use_recorded_sales(self):
        today = timezone.localdate()
        prior_month_start = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
        prior_day = min(today.day, calendar.monthrange(prior_month_start.year, prior_month_start.month)[1])
        product = Product.objects.create(
            user=self.user, name="Coffee", sku="COF-1", stock=10, reorder_level=2,
            price=Decimal("10.00"), cost_price=Decimal("5.00"),
        )
        self.create_sale(product, "100.00")
        self.create_sale(product, "50.00", prior_month_start.replace(day=prior_day))

        response = self.client.get("/api/v1/reports/insights/")

        self.assertEqual(response.status_code, 200, response.data)
        by_rule = {item["rule_key"]: item for item in response.data["items"]}
        self.assertIn("sales.mtd_trend", by_rule)
        trend = by_rule["sales.mtd_trend"]
        self.assertIn("both partial periods", trend["period_label"])
        self.assertEqual(trend["supporting_figures"]["current_net_sales"], "100.00")
        self.assertEqual(trend["supporting_figures"]["previous_matching_period_net_sales"], "50.00")
        self.assertEqual(by_rule["sales.best_seller"]["supporting_figures"]["product"], "Coffee")
        self.assertIn("partial day", by_rule["sales.today_performance"]["period_label"])

    def test_insight_state_is_persisted_and_history_is_user_scoped(self):
        product = Product.objects.create(
            user=self.user, name="Tea", sku="TEA-1", stock=8, reorder_level=1,
            price=Decimal("8.00"), cost_price=Decimal("3.00"),
        )
        self.create_sale(product, "80.00")

        first = self.client.get("/api/v1/reports/insights/")
        insight = next(item for item in first.data["items"] if item["rule_key"] == "sales.best_seller")
        dismissed_insight = next(item for item in first.data["items"] if item["rule_key"] == "sales.today_performance")
        acknowledged = self.client.post(
            f"/api/v1/reports/insights/{insight['id']}/acknowledge/",
            {},
            format="json",
        )
        dismissed = self.client.post(
            f"/api/v1/reports/insights/{dismissed_insight['id']}/dismiss/",
            {},
            format="json",
        )
        active = self.client.get("/api/v1/reports/insights/")
        history = self.client.get("/api/v1/reports/insights/", {"status": "all"})

        self.assertEqual(acknowledged.status_code, 200, acknowledged.data)
        self.assertEqual(dismissed.status_code, 200, dismissed.data)
        self.assertNotIn(insight["id"], {item["id"] for item in active.data["items"]})
        history_item = next(item for item in history.data["items"] if item["id"] == insight["id"])
        dismissed_item = next(item for item in history.data["items"] if item["id"] == dismissed_insight["id"])
        self.assertEqual(history_item["status"], "acknowledged")
        self.assertEqual(dismissed_item["status"], "dismissed")
        self.assertIsNotNone(history_item["acknowledged_at"])
        self.assertEqual(history.data["history_count"], first.data["history_count"])

        other_user = self.create_business_user("other-insight-owner")
        self.client.force_authenticate(other_user)
        hidden = self.client.post(
            f"/api/v1/reports/insights/{insight['id']}/dismiss/",
            {},
            format="json",
        )
        self.assertEqual(hidden.status_code, 404)

    def test_declining_product_insight_compares_net_units_in_complete_periods(self):
        today = timezone.localdate()
        product = Product.objects.create(
            user=self.user, name="Dried beans", sku="BEANS-DOWN", stock=20,
            price=Decimal("10.00"), cost_price=Decimal("6.00"),
        )
        for _ in range(3):
            self.create_sale(product, "20.00", today - timedelta(days=45))
        self.create_sale(product, "20.00", today - timedelta(days=5))

        response = self.client.get("/api/v1/reports/insights/")

        self.assertEqual(response.status_code, 200, response.data)
        insight = next(
            item for item in response.data["items"]
            if item["rule_key"] == "sales.declining_products"
        )
        figures = insight["supporting_figures"]["products"][0]
        self.assertEqual(figures["product"], "Dried beans")
        self.assertEqual(figures["previous_30_day_net_units"], 6)
        self.assertEqual(figures["current_30_day_net_units"], 2)
        self.assertEqual(figures["units_decreased"], 4)
        self.assertEqual(figures["decline_percent"], "66.67")
        self.assertIn("complete 30-day", insight["explanation"])

    def test_customer_debt_and_account_activity_use_saved_records(self):
        yesterday = timezone.localdate() - timedelta(days=1)
        category = ExpenseCategory.objects.create(name="Utilities")
        Expense.objects.create(
            created_by=self.user, description="Electricity", amount=Decimal("25.00"),
            amount_base=Decimal("25.00"), date=yesterday, category=category,
        )
        Product.objects.create(
            user=self.user, name="Rice", sku="RICE-LOW", stock=1, reorder_level=4,
            price=Decimal("6.00"), cost_price=Decimal("2.50"),
        )
        Customer.objects.create(
            user=self.user, name="Credit customer", debt_amount=Decimal("75.00"),
            debt_due_date=yesterday,
        )
        account = BankAccount.objects.create(
            user=self.user, name="Cash", account_type="cash", currency=self.user.currency,
        )
        AccountTransaction.objects.create(
            user=self.user, account=account, direction="in", entry_type="manual",
            amount=Decimal("100.00"), fx_rate_to_base=Decimal("1"),
            amount_base=Decimal("100.00"), transaction_date=yesterday,
            description="Recorded receipt", created_by=self.user,
        )

        response = self.client.get("/api/v1/reports/insights/")

        self.assertEqual(response.status_code, 200, response.data)
        by_rule = {item["rule_key"]: item for item in response.data["items"]}
        self.assertEqual(by_rule["financial.customer_debt"]["supporting_figures"]["overdue_balance"], "75.00")
        self.assertEqual(by_rule["financial.account_cash_flow"]["supporting_figures"]["current_received"], "100.00")
        self.assertEqual(by_rule["expenses.top_category"]["supporting_figures"]["category"], "Utilities")
        self.assertEqual(by_rule["inventory.low_stock"]["supporting_figures"]["count"], 1)

    def test_no_insight_is_generated_without_supporting_records(self):
        response = self.client.get("/api/v1/reports/insights/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["items"], [])
        self.assertEqual(response.data["history_count"], 0)

    def test_over_budget_expense_insight_includes_budget_and_actual_figures(self):
        today = timezone.localdate()
        category = ExpenseCategory.objects.create(name="Internet")
        budget = ExpenseBudget.objects.create(
            user=self.user,
            created_by=self.user,
            category=category,
            period_start=today.replace(day=1),
            period_end=today,
            amount_base=Decimal("100.00"),
            expense_type="operating",
        )
        Expense.objects.create(
            created_by=self.user,
            category=category,
            description="Monthly internet",
            amount=Decimal("125.00"),
            amount_base=Decimal("125.00"),
            expense_type="operating",
            date=today,
        )

        response = self.client.get("/api/v1/reports/insights/")

        self.assertEqual(response.status_code, 200, response.data)
        overrun = next(
            item for item in response.data["items"]
            if item["rule_key"] == f"expenses.budget_overrun.{budget.pk}"
        )
        self.assertEqual(overrun["supporting_figures"]["budget_amount"], "100.00")
        self.assertEqual(overrun["supporting_figures"]["spent_amount"], "125.00")
        self.assertEqual(overrun["supporting_figures"]["over_budget_amount"], "25.00")

    def test_branch_profitability_and_expense_comparison_use_open_days(self):
        today = timezone.localdate()
        first_branch = Branch.objects.create(
            user=self.user, name="Central", opening_date=today - timedelta(days=60),
        )
        newer_branch = Branch.objects.create(
            user=self.user, name="New shop", opening_date=today - timedelta(days=10),
        )
        first_employee = Staff.objects.create(user=self.user, name="Alicia", role="Salesperson", status=Staff.ACTIVE)
        second_employee = Staff.objects.create(user=self.user, name="Tawanda", role="Salesperson", status=Staff.ACTIVE)
        first_till = TillSession.objects.create(
            user=self.user, branch=first_branch, opened_by_staff=first_employee,
            cashier_name="Alicia", status="closed",
        )
        second_till = TillSession.objects.create(
            user=self.user, branch=newer_branch, opened_by_staff=second_employee,
            cashier_name="Tawanda", status="closed",
        )
        first_sale = Sale.objects.create(
            created_by=self.user, branch=first_branch, till_session=first_till,
            total=Decimal("200.00"), total_cost=Decimal("100.00"), gross_profit=Decimal("100.00"),
        )
        second_sale = Sale.objects.create(
            created_by=self.user, branch=newer_branch, till_session=second_till,
            total=Decimal("50.00"), total_cost=Decimal("25.00"), gross_profit=Decimal("25.00"),
        )
        Sale.objects.filter(pk__in=[first_sale.pk, second_sale.pk]).update(date=today - timedelta(days=5))
        Expense.objects.create(
            created_by=self.user, branch=first_branch, description="Central rent",
            amount=Decimal("90.00"), amount_base=Decimal("90.00"), date=today - timedelta(days=5),
        )
        Expense.objects.create(
            created_by=self.user, branch=newer_branch, description="New shop utilities",
            amount=Decimal("20.00"), amount_base=Decimal("20.00"), date=today - timedelta(days=5),
        )

        response = self.client.get("/api/v1/reports/insights/")

        self.assertEqual(response.status_code, 200, response.data)
        by_rule = {item["rule_key"]: item for item in response.data["items"]}
        profitability = by_rule["financial.branch_profitability"]["supporting_figures"]["branches"]
        new_shop = next(row for row in profitability if row["branch"] == "New shop")
        self.assertEqual(new_shop["active_days"], 10)
        self.assertEqual(new_shop["net_profit"], "5.00")
        expenses = by_rule["expenses.branch_differences"]["supporting_figures"]["branches"]
        newer_expenses = next(row for row in expenses if row["branch"] == "New shop")
        self.assertEqual(newer_expenses["active_days"], 10)
        self.assertEqual(newer_expenses["average_expense_per_active_day"], "2.00")
        self.assertIn("sales.top_employee", by_rule)

    def test_supplier_debt_insight_includes_received_legacy_purchase_quantities(self):
        supplier = Supplier.objects.create(user=self.user, name="Legacy supplier")
        product = Product.objects.create(user=self.user, name="Legacy item", sku="LEGACY-ITEM", stock=6)
        order = PurchaseOrder.objects.create(user=self.user, supplier=supplier, status="partially_received")
        PurchaseOrderItem.objects.create(
            purchase_order=order, product=product, quantity_ordered=6, quantity_received=6,
            unit_cost=Decimal("10.00"), unit_cost_base=Decimal("10.00"),
        )
        SupplierPayment.objects.create(
            user=self.user, supplier=supplier, purchase_order=order,
            amount=Decimal("20.00"), currency=self.user.currency,
            amount_base=Decimal("20.00"), payment_date=timezone.localdate(), created_by=self.user,
        )

        response = self.client.get("/api/v1/reports/insights/")

        self.assertEqual(response.status_code, 200, response.data)
        by_rule = {item["rule_key"]: item for item in response.data["items"]}
        self.assertEqual(by_rule["financial.supplier_debt"]["supporting_figures"]["outstanding_balance"], "40.00")
