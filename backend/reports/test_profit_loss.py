from datetime import date, timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from billing.models import Plan
from billing.services import get_or_create_subscription, sync_plan_catalog
from customers.models import CreditTransaction, Customer
from expenses.models import Expense
from inventory.models import Product, PurchaseOrder, Supplier, SupplierPayment
from sales.models import Sale


class ProfitLossTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="finance-owner",
            email="finance@example.com",
            password="Secure123!",
            currency="ZAR",
        )
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_profit_loss_uses_sale_cost_returns_expense_types_and_other_income(self):
        product = Product.objects.create(
            user=self.user, name="Coffee", sku="COF-1", stock=5,
            price=Decimal("10.00"), cost_price=Decimal("5.00"),
        )
        sale_response = self.client.post("/api/v1/sales/", {
            "integration_id": "finance-sale-1",
            "payment_method": "Cash",
            "items": [{
                "product": product.id,
                "quantity": 2,
                "unit_price": "10.00",
                "discount_amount": "2.00",
            }],
        }, format="json")
        self.assertEqual(sale_response.status_code, 201, sale_response.data)
        sale_item = sale_response.data["items"][0]
        self.client.post(
            f"/api/v1/sales/{sale_response.data['id']}/returns/",
            {"sale_item": sale_item["id"], "quantity": 1, "refund_method": "Cash"},
            format="json",
        )
        product.refresh_from_db()
        product.cost_price = Decimal("99.00")
        product.save(update_fields=["cost_price"])
        today = timezone.localdate()
        Expense.objects.create(
            created_by=self.user, description="Rent", amount=Decimal("2.00"),
            amount_base=Decimal("2.00"), date=today, expense_type="operating",
        )
        Expense.objects.create(
            created_by=self.user, description="Bank fee", amount=Decimal("1.00"),
            amount_base=Decimal("1.00"), date=today, expense_type="other",
        )
        income_response = self.client.post("/api/v1/expenses/other-income/", {
            "description": "Interest",
            "amount": "4.00",
            "currency": "ZAR",
            "date": today.isoformat(),
        }, format="json")
        supplier = Supplier.objects.create(user=self.user, name="Coffee supplier")
        order = PurchaseOrder.objects.create(
            user=self.user, supplier=supplier, order_number="PO-FIN-1",
        )
        SupplierPayment.objects.create(
            user=self.user,
            supplier=supplier,
            purchase_order=order,
            amount=Decimal("12.00"),
            currency="ZAR",
            amount_base=Decimal("12.00"),
            payment_date=today,
            created_by=self.user,
        )

        report = self.client.get("/api/v1/reports/profit-loss/", {"period": "today"})

        self.assertEqual(sale_response.status_code, 201, sale_response.data)
        self.assertEqual(income_response.status_code, 201, income_response.data)
        self.assertEqual(report.status_code, 200, report.data)
        current = report.data["current"]
        self.assertEqual(current["gross_sales"], Decimal("20.00"))
        self.assertEqual(current["discounts"], Decimal("4.00"))
        self.assertEqual(current["sales_returns"], Decimal("8.00"))
        self.assertEqual(current["net_sales"], Decimal("8.00"))
        self.assertEqual(current["cost_of_goods_sold"], Decimal("5.00"))
        self.assertEqual(current["gross_profit"], Decimal("3.00"))
        self.assertEqual(current["operating_expenses"], Decimal("2.00"))
        self.assertEqual(current["other_income"], Decimal("4.00"))
        self.assertEqual(current["other_expenses"], Decimal("1.00"))
        self.assertEqual(current["net_profit"], Decimal("4.00"))
        self.assertEqual(current["cash_received"], Decimal("12.00"))
        self.assertEqual(current["supplier_payments"], Decimal("12.00"))

    def test_custom_range_requires_valid_inclusive_dates(self):
        missing_range = self.client.get("/api/v1/reports/profit-loss/", {"period": "custom"})
        invalid_range = self.client.get("/api/v1/reports/profit-loss/", {
            "period": "custom", "start_date": "2026-03-02", "end_date": "2026-03-01",
        })
        valid_range = self.client.get("/api/v1/reports/profit-loss/", {
            "period": "custom", "start_date": "2026-03-01", "end_date": "2026-03-02",
        })

        self.assertEqual(missing_range.status_code, 400)
        self.assertEqual(invalid_range.status_code, 400)
        self.assertEqual(valid_range.status_code, 200, valid_range.data)
        self.assertEqual(valid_range.data["start_date"], date(2026, 3, 1))
        self.assertEqual(valid_range.data["end_date"], date(2026, 3, 2))

    def test_required_profit_calculation_uses_historical_unit_cost(self):
        product = Product.objects.create(
            user=self.user,
            name="Margin test item",
            sku="MARGIN-10",
            stock=10,
            price=Decimal("8.00"),
            cost_price=Decimal("5.00"),
        )
        sale = self.client.post("/api/v1/sales/", {
            "integration_id": "required-profit-example-10",
            "payment_method": "Cash",
            "items": [{"product": product.id, "quantity": 10, "unit_price": "8.00"}],
        }, format="json")
        if sale.status_code == 201:
            Sale.objects.filter(pk=sale.data["id"]).update(date=timezone.localdate())

        report = self.client.get("/api/v1/reports/profit-loss/", {"period": "today"})

        self.assertEqual(sale.status_code, 201, sale.data)
        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["current"]["gross_sales"], Decimal("80.00"))
        self.assertEqual(report.data["current"]["cost_of_goods_sold"], Decimal("50.00"))
        self.assertEqual(report.data["current"]["gross_profit"], Decimal("30.00"))

    def test_previous_month_compares_adjacent_calendar_months(self):
        today = timezone.localdate()
        this_month_start = today.replace(day=1)
        previous_month_start = (this_month_start - timedelta(days=1)).replace(day=1)
        preceding_month_start = (previous_month_start - timedelta(days=1)).replace(day=1)

        report = self.client.get("/api/v1/reports/profit-loss/", {"period": "previous_month"})

        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["start_date"], previous_month_start)
        self.assertEqual(report.data["end_date"], this_month_start - timedelta(days=1))
        self.assertEqual(report.data["previous_start_date"], preceding_month_start)
        self.assertEqual(report.data["previous_end_date"], previous_month_start - timedelta(days=1))

    def test_credit_sale_and_partial_collection_keep_customer_and_invoice_balances_aligned(self):
        customer = Customer.objects.create(
            user=self.user,
            name="Credit customer",
            credit_limit=Decimal("150.00"),
        )
        product = Product.objects.create(
            user=self.user, name="Service", sku="SERVICE-1", stock=5,
            price=Decimal("100.00"), cost_price=Decimal("40.00"),
        )
        sale_response = self.client.post("/api/v1/sales/", {
            "integration_id": "credit-sale-1",
            "payment_method": "Cash",
            "customer": customer.id,
            "due_date": (timezone.localdate() + timedelta(days=14)).isoformat(),
            "payment_allocations": [{"currency": "ZAR", "amount": "40.00"}],
            "items": [{"product": product.id, "quantity": 1, "unit_price": "100.00"}],
        }, format="json")

        self.assertEqual(sale_response.status_code, 201, sale_response.data)
        self.assertEqual(sale_response.data["total"], "100.00")
        self.assertEqual(sale_response.data["amount_paid_base"], "40.00")
        self.assertEqual(sale_response.data["balance_due"], "60.00")
        customer.refresh_from_db()
        self.assertEqual(customer.debt_amount, Decimal("60.00"))

        payload = {
            "amount": "40.00",
            "reason": "Counter collection",
            "idempotency_key": "collection-1",
        }
        first = self.client.post(
            f"/api/v1/customers/{customer.id}/record-payment/", payload, format="json"
        )
        retry = self.client.post(
            f"/api/v1/customers/{customer.id}/record-payment/", payload, format="json"
        )

        customer.refresh_from_db()
        sale = Sale.objects.get(pk=sale_response.data["id"])
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(retry["Idempotent-Replay"], "true")
        self.assertEqual(customer.debt_amount, Decimal("20.00"))
        self.assertEqual(sale.amount_paid_base, Decimal("80.00"))
        self.assertEqual(sale.balance_due, Decimal("20.00"))
        self.assertEqual(CreditTransaction.objects.filter(customer=customer, type="payment").count(), 1)
        profit_loss = self.client.get("/api/v1/reports/profit-loss/", {"period": "today"})
        self.assertEqual(Decimal(str(profit_loss.data["current"]["cash_received"])), Decimal("80.00"))

    def test_credit_limit_and_overpayment_are_rejected_without_balance_changes(self):
        customer = Customer.objects.create(
            user=self.user,
            name="Limited customer",
            credit_limit=Decimal("25.00"),
        )
        product = Product.objects.create(
            user=self.user, name="Item", sku="LIMIT-1", stock=3,
            price=Decimal("30.00"), cost_price=Decimal("10.00"),
        )
        rejected_sale = self.client.post("/api/v1/sales/", {
            "payment_method": "Credit",
            "customer": customer.id,
            "items": [{"product": product.id, "quantity": 1, "unit_price": "30.00"}],
        }, format="json")
        self.assertEqual(rejected_sale.status_code, 400, rejected_sale.data)
        self.assertFalse(Sale.objects.filter(customer=customer).exists())

        customer.debt_amount = Decimal("10.00")
        customer.save(update_fields=["debt_amount"])
        overpayment = self.client.post(
            f"/api/v1/customers/{customer.id}/record-payment/",
            {"amount": "11.00", "idempotency_key": "overpay-1"},
            format="json",
        )
        customer.refresh_from_db()
        self.assertEqual(overpayment.status_code, 400)
        self.assertEqual(customer.debt_amount, Decimal("10.00"))

    def test_receivables_due_date_rolls_forward_and_statement_shows_open_invoice_balances(self):
        customer = Customer.objects.create(
            user=self.user,
            name="Statement customer",
            credit_limit=Decimal("300.00"),
        )
        product = Product.objects.create(
            user=self.user,
            name="Service",
            sku="STATEMENT-1",
            stock=10,
            price=Decimal("100.00"),
            cost_price=Decimal("40.00"),
        )
        today = timezone.localdate()
        due_dates = [today - timedelta(days=5), today + timedelta(days=15)]
        created_sales = []
        for index, due_date in enumerate(due_dates):
            response = self.client.post("/api/v1/sales/", {
                "integration_id": f"statement-sale-{index}",
                "payment_method": "Credit",
                "customer": customer.id,
                "due_date": due_date.isoformat(),
                "items": [{"product": product.id, "quantity": 1, "unit_price": "100.00"}],
            }, format="json")
            self.assertEqual(response.status_code, 201, response.data)
            created_sales.append(response.data)

        manual_due = today + timedelta(days=7)
        added = self.client.post(
            f"/api/v1/customers/{customer.id}/add-debt/",
            {"amount": "50.00", "reason": "Manual tab", "due_date": manual_due.isoformat(), "idempotency_key": "statement-manual-1"},
            format="json",
        )
        self.assertEqual(added.status_code, 200, added.data)

        first_payment = self.client.post(
            f"/api/v1/customers/{customer.id}/record-payment/",
            {"amount": "100.00", "idempotency_key": "statement-payment-1"},
            format="json",
        )
        customer.refresh_from_db()
        self.assertEqual(first_payment.status_code, 200, first_payment.data)
        self.assertEqual(customer.debt_due_date, manual_due)
        self.assertEqual(customer.debt_amount, Decimal("150.00"))

        statement = self.client.get(f"/api/v1/customers/{customer.id}/statement/")
        self.assertEqual(statement.status_code, 200, statement.data)
        invoice_rows = {row["id"]: row for row in statement.data["invoices"]}
        self.assertEqual(len(invoice_rows), 2)
        self.assertEqual(invoice_rows[created_sales[0]["id"]]["due_date"], due_dates[0])
        self.assertEqual(invoice_rows[created_sales[0]["id"]]["balance_due"], Decimal("0.00"))
        self.assertEqual(invoice_rows[created_sales[1]["id"]]["balance_due"], Decimal("100.00"))
        self.assertEqual(len([row for row in statement.data["transactions"] if row["type"] == "payment"]), 1)

        second_payment = self.client.post(
            f"/api/v1/customers/{customer.id}/record-payment/",
            {"amount": "150.00", "idempotency_key": "statement-payment-2"},
            format="json",
        )
        customer.refresh_from_db()
        manual_debt = CreditTransaction.objects.get(customer=customer, reason="Manual tab")
        self.assertEqual(second_payment.status_code, 200, second_payment.data)
        self.assertEqual(customer.debt_amount, Decimal("0.00"))
        self.assertIsNone(customer.debt_due_date)
        self.assertEqual(manual_debt.settled_amount, Decimal("50.00"))
