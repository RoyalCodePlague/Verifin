from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from billing.models import Plan
from billing.services import get_or_create_subscription, sync_plan_catalog
from customers.models import Customer
from expenses.models import Expense
from inventory.models import Product, PurchaseOrder, PurchaseOrderItem, Supplier, SupplierPayment
from reports.models import AccountBalanceReconciliation, AccountReconciliationEvent, AccountTransaction, AccountTransfer


class FinancialAccountTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="account-owner",
            email="accounts@example.com",
            currency="ZAR",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate().isoformat()

    def create_account(self, name, currency="ZAR", opening_balance="0.00", **extra):
        payload = {
            "name": name,
            "account_type": "cash",
            "currency": currency,
            "opening_balance": opening_balance,
            **extra,
        }
        return self.client.post("/api/v1/reports/accounts/", payload, format="json")

    def test_manual_transactions_use_fixed_rates_and_idempotency(self):
        account_response = self.create_account("Till", opening_balance="100.00")
        self.assertEqual(account_response.status_code, 201, account_response.data)
        account_id = account_response.data["id"]

        payload = {
            "account": account_id,
            "direction": "in",
            "amount": "25.00",
            "transaction_date": self.today,
            "description": "Cash received",
            "reference": "RCPT-1",
            "idempotency_key": "receipt-1",
        }
        first = self.client.post("/api/v1/reports/account-transactions/", payload, format="json")
        replay = self.client.post("/api/v1/reports/account-transactions/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(replay.status_code, 201, replay.data)
        self.assertEqual(first.data["id"], replay.data["id"])
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 1)
        conflicting_replay = self.client.post(
            "/api/v1/reports/account-transactions/",
            {**payload, "amount": "26.00"},
            format="json",
        )
        self.assertEqual(conflicting_replay.status_code, 400, conflicting_replay.data)

        outflow = self.client.post(
            "/api/v1/reports/account-transactions/",
            {
                "account": account_id,
                "direction": "out",
                "amount": "15.00",
                "transaction_date": self.today,
                "description": "Petty cash",
            },
            format="json",
        )
        self.assertEqual(outflow.status_code, 201, outflow.data)
        account = self.client.get(f"/api/v1/reports/accounts/{account_id}/")
        self.assertEqual(Decimal(account.data["current_balance"]), Decimal("110.00"))

        insufficient = self.client.post(
            "/api/v1/reports/account-transactions/",
            {
                "account": account_id,
                "direction": "out",
                "amount": "111.00",
                "transaction_date": self.today,
                "description": "Too much",
            },
            format="json",
        )
        self.assertEqual(insufficient.status_code, 400, insufficient.data)
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 2)

    def test_foreign_currency_requires_a_transaction_time_rate(self):
        missing_opening_rate = self.create_account("USD wallet", "USD", "10.00")
        self.assertEqual(missing_opening_rate.status_code, 400, missing_opening_rate.data)

        account_response = self.create_account(
            "USD wallet", "USD", "100.00", opening_fx_rate_to_base="18.000000"
        )
        self.assertEqual(account_response.status_code, 201, account_response.data)
        transaction_response = self.client.post(
            "/api/v1/reports/account-transactions/",
            {
                "account": account_response.data["id"],
                "direction": "in",
                "amount": "10.00",
                "transaction_date": self.today,
                "description": "USD deposit",
            },
            format="json",
        )
        self.assertEqual(transaction_response.status_code, 400, transaction_response.data)

        transaction_response = self.client.post(
            "/api/v1/reports/account-transactions/",
            {
                "account": account_response.data["id"],
                "direction": "in",
                "amount": "10.00",
                "fx_rate_to_base": "18.250000",
                "transaction_date": self.today,
                "description": "USD deposit",
            },
            format="json",
        )
        self.assertEqual(transaction_response.status_code, 201, transaction_response.data)
        self.assertEqual(Decimal(transaction_response.data["amount_base"]), Decimal("182.50"))

    def test_cross_currency_transfer_posts_balanced_entries_with_saved_rates(self):
        source_response = self.create_account(
            "USD wallet", "USD", "100.00", opening_fx_rate_to_base="18.000000"
        )
        destination_response = self.create_account("Till", opening_balance="100.00")
        self.assertEqual(source_response.status_code, 201, source_response.data)
        self.assertEqual(destination_response.status_code, 201, destination_response.data)

        payload = {
            "from_account": source_response.data["id"],
            "to_account": destination_response.data["id"],
            "amount_from": "10.00",
            "exchange_rate": "18.000000",
            "fx_rate_to_base": "18.000000",
            "transaction_date": self.today,
            "description": "Exchange cash",
            "idempotency_key": "transfer-1",
        }
        response = self.client.post("/api/v1/reports/account-transfers/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(Decimal(response.data["amount_to"]), Decimal("180.00"))
        self.assertEqual(Decimal(response.data["amount_base"]), Decimal("180.00"))
        self.assertEqual(AccountTransfer.objects.filter(user=self.user).count(), 1)
        self.assertEqual(AccountTransaction.objects.filter(transfer_id=response.data["id"]).count(), 2)

        source_balance = self.client.get(f"/api/v1/reports/accounts/{source_response.data['id']}/").data
        destination_balance = self.client.get(f"/api/v1/reports/accounts/{destination_response.data['id']}/").data
        self.assertEqual(Decimal(source_balance["current_balance"]), Decimal("90.00"))
        self.assertEqual(Decimal(source_balance["current_balance_base"]), Decimal("1620.00"))
        self.assertEqual(Decimal(destination_balance["current_balance"]), Decimal("280.00"))

        missing_rate = dict(payload, idempotency_key="transfer-2")
        missing_rate.pop("exchange_rate")
        rejected = self.client.post("/api/v1/reports/account-transfers/", missing_rate, format="json")
        self.assertEqual(rejected.status_code, 400, rejected.data)

    def test_reconciliation_changes_are_recorded_and_accounts_are_scoped(self):
        account_response = self.create_account("Till")
        transaction_response = self.client.post(
            "/api/v1/reports/account-transactions/",
            {
                "account": account_response.data["id"],
                "direction": "in",
                "amount": "20.00",
                "transaction_date": self.today,
                "description": "Cash sale",
            },
            format="json",
        )
        reconcile = self.client.post(
            f"/api/v1/reports/account-transactions/{transaction_response.data['id']}/reconcile/",
            {"reconciled": True, "note": "Till counted"},
            format="json",
        )
        self.assertEqual(reconcile.status_code, 200, reconcile.data)
        self.assertTrue(reconcile.data["is_reconciled"])
        self.assertEqual(AccountReconciliationEvent.objects.count(), 1)
        other_user = get_user_model().objects.create_user(username="other-account-owner", email="other@example.com")
        other_client = APIClient()
        other_client.force_authenticate(other_user)
        self.assertEqual(other_client.get(f"/api/v1/reports/accounts/{account_response.data['id']}/").status_code, 404)

    def test_balance_reconciliation_adjustment_is_traceable_and_idempotent(self):
        account_response = self.create_account("Counted till", opening_balance="100.00")
        account_id = account_response.data["id"]
        payload = {
            "as_of": self.today,
            "actual_balance": "90.00",
            "note": "Till count",
            "post_adjustment": True,
            "idempotency_key": "till-count-2026-01",
        }

        first = self.client.post(f"/api/v1/reports/accounts/{account_id}/reconcile-balance/", payload, format="json")
        replay = self.client.post(f"/api/v1/reports/accounts/{account_id}/reconcile-balance/", payload, format="json")
        balance = self.client.get(f"/api/v1/reports/accounts/{account_id}/balance/", {"as_of": self.today})

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(first.data["difference"], Decimal("-10.00"))
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.data["id"], first.data["id"])
        self.assertEqual(balance.status_code, 200, balance.data)
        self.assertEqual(balance.data["balance"], Decimal("90.00"))
        self.assertEqual(len(balance.data["reconciliation_history"]), 1)
        self.assertEqual(AccountBalanceReconciliation.objects.count(), 1)
        adjustment = AccountTransaction.objects.get(entry_type="adjustment")
        self.assertEqual(adjustment.amount, Decimal("10.00"))
        self.assertEqual(adjustment.direction, "out")

    def test_foreign_currency_adjustments_require_an_explicit_rate(self):
        account = self.create_account("USD wallet", "USD", opening_balance="10.00", opening_fx_rate_to_base="25.000000")
        payload = {
            "as_of": self.today,
            "actual_balance": "8.00",
            "post_adjustment": True,
            "idempotency_key": "usd-count-1",
        }
        missing_rate = self.client.post(f"/api/v1/reports/accounts/{account.data['id']}/reconcile-balance/", payload, format="json")
        with_rate = self.client.post(
            f"/api/v1/reports/accounts/{account.data['id']}/reconcile-balance/",
            {**payload, "fx_rate_to_base": "30.000000"},
            format="json",
        )

        self.assertEqual(missing_rate.status_code, 400, missing_rate.data)
        self.assertEqual(with_rate.status_code, 201, with_rate.data)
        adjustment = AccountTransaction.objects.get(entry_type="adjustment")
        self.assertEqual(adjustment.fx_rate_to_base, Decimal("30.000000"))
        self.assertEqual(adjustment.amount_base, Decimal("60.00"))

    def test_staff_cannot_post_financial_reconciliation_adjustments(self):
        account = self.create_account("Till", opening_balance="10.00")
        with patch("reports.account_views.get_staff_member", return_value=object()):
            response = self.client.post(
                f"/api/v1/reports/accounts/{account.data['id']}/reconcile-balance/",
                {
                    "as_of": self.today,
                    "actual_balance": "9.00",
                    "post_adjustment": True,
                    "idempotency_key": "staff-till-count",
                },
                format="json",
            )
        self.assertEqual(response.status_code, 403, response.data)

    def test_historical_closing_balance_respects_account_opening_date(self):
        response = self.create_account(
            "Later account",
            opening_balance="50.00",
            opening_date="2026-06-20",
        )
        self.assertEqual(response.status_code, 201, response.data)
        before_opening = self.client.get(
            f"/api/v1/reports/accounts/{response.data['id']}/balance/?as_of=2026-06-19"
        )
        after_opening = self.client.get(
            f"/api/v1/reports/accounts/{response.data['id']}/balance/?as_of=2026-06-20"
        )
        self.assertEqual(Decimal(before_opening.data["balance"]), Decimal("0.00"))
        self.assertEqual(Decimal(after_opening.data["balance"]), Decimal("50.00"))

    def test_sale_receipts_are_idempotent_and_voids_post_reversals(self):
        account = self.create_account("Till", opening_balance="50.00")
        product = Product.objects.create(
            user=self.user, name="Bread", sku="BREAD-LEDGER", stock=5, price="10.00", cost_price="4.00"
        )
        payload = {
            "integration_id": "ledger-sale-001",
            "payment_method": "Cash",
            "payment_currency": "ZAR",
            "payment_allocations": [{"account": account.data["id"], "currency": "ZAR", "amount": "10.00"}],
            "sale_items": [{"product": product.id, "quantity": 1, "unit_price": "10.00"}],
        }
        first = self.client.post("/api/v1/sales/", payload, format="json")
        replay = self.client.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(first.data["id"], replay.data["id"])
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 1)
        self.assertEqual(Decimal(self.client.get(f"/api/v1/reports/accounts/{account.data['id']}/").data["current_balance"]), Decimal("60.00"))

        deleted = self.client.delete(f"/api/v1/sales/{first.data['id']}/")
        self.assertEqual(deleted.status_code, 204)
        reversal = AccountTransaction.objects.get(reversal_of__isnull=False)
        self.assertEqual(reversal.entry_type, "reversal")
        self.assertEqual(reversal.direction, "out")
        self.assertEqual(Decimal(self.client.get(f"/api/v1/reports/accounts/{account.data['id']}/").data["current_balance"]), Decimal("50.00"))

    def test_expense_edits_and_deletes_preserve_posted_account_history(self):
        account = self.create_account("Business bank", opening_balance="100.00")
        payload = {
            "description": "Delivery fuel",
            "amount": "10.00",
            "currency": "ZAR",
            "date": self.today,
            "payment_allocations": [{"account": account.data["id"], "currency": "ZAR", "amount": "10.00"}],
        }
        created = self.client.post("/api/v1/expenses/", payload, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 1)

        updated = self.client.patch(
            f"/api/v1/expenses/{created.data['id']}/",
            {
                "amount": "12.00",
                "payment_allocations": [{"account": account.data["id"], "currency": "ZAR", "amount": "12.00"}],
            },
            format="json",
        )
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 3)
        self.assertEqual(Decimal(self.client.get(f"/api/v1/reports/accounts/{account.data['id']}/").data["current_balance"]), Decimal("88.00"))

        deleted = self.client.delete(f"/api/v1/expenses/{created.data['id']}/")
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 4)
        self.assertEqual(AccountTransaction.objects.filter(reversal_of__isnull=False).count(), 2)
        self.assertEqual(Decimal(self.client.get(f"/api/v1/reports/accounts/{account.data['id']}/").data["current_balance"]), Decimal("100.00"))

    def test_customer_collection_retry_posts_once_to_selected_account(self):
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        account = self.create_account("Collections")
        customer = Customer.objects.create(user=self.user, name="A customer", debt_amount="20.00")
        payload = {
            "amount": "5.00",
            "idempotency_key": "customer-payment-001",
            "payment_allocations": [{"account": account.data["id"], "currency": "ZAR", "amount": "5.00"}],
        }
        first = self.client.post(f"/api/v1/customers/{customer.id}/record-payment/", payload, format="json")
        replay = self.client.post(f"/api/v1/customers/{customer.id}/record-payment/", payload, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.get("Idempotent-Replay"), "true")
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 1)
        customer.refresh_from_db()
        self.assertEqual(customer.debt_amount, Decimal("15.00"))
        self.assertEqual(Decimal(self.client.get(f"/api/v1/reports/accounts/{account.data['id']}/").data["current_balance"]), Decimal("5.00"))

    def test_supplier_payment_retry_posts_one_account_outflow(self):
        account = self.create_account("Supplier payments", opening_balance="30.00")
        supplier = Supplier.objects.create(user=self.user, name="Flour supplier")
        product = Product.objects.create(user=self.user, name="Flour", sku="FLOUR-LEDGER", stock=0)
        order = PurchaseOrder.objects.create(
            user=self.user,
            supplier=supplier,
            status=PurchaseOrder.STATUS_PARTIALLY_RECEIVED,
        )
        PurchaseOrderItem.objects.create(
            purchase_order=order,
            product=product,
            quantity_ordered=2,
            quantity_received=2,
            unit_cost="5.00",
            unit_cost_base="5.00",
        )
        payload = {
            "supplier": supplier.id,
            "purchase_order": order.id,
            "amount": "5.00",
            "currency": "ZAR",
            "payment_date": self.today,
            "method": "bank",
            "financial_account": account.data["id"],
            "idempotency_key": "supplier-payment-001",
        }
        first = self.client.post("/api/v1/inventory/supplier-payments/", payload, format="json")
        replay = self.client.post("/api/v1/inventory/supplier-payments/", payload, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(replay.status_code, 201, replay.data)
        self.assertEqual(first.data["id"], replay.data["id"])
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 1)
        self.assertEqual(AccountTransaction.objects.get().direction, "out")
        self.assertEqual(Decimal(self.client.get(f"/api/v1/reports/accounts/{account.data['id']}/").data["current_balance"]), Decimal("25.00"))
