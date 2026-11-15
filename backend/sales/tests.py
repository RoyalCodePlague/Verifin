from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.test import APIClient
from accounts.models import ApiKey
from inventory.models import Product
from inventory.models import Branch
from accounts.models import Staff
from sales.models import Sale, SaleItem, TillSession


class PosApiIntegrationTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="pos-owner", email="pos@example.com", password="Secret123!",
            business_name="POS Shop", is_active=True, email_verified=True,
        )
        self.product = Product.objects.create(
            user=self.user, name="Tea", sku="TEA-1", barcode="6001234567890",
            stock=5, price=Decimal("15.00"), cost_price=Decimal("8.00"),
        )
        key = ApiKey(user=self.user, created_by=self.user, name="POS", key_prefix="", key_hash="", permissions=["inventory", "sales"])
        self.api_key = "vf_live_pos_test_key"
        key.set_key(self.api_key)
        key.save()
        self.client = APIClient()
        self.client.credentials(HTTP_X_API_KEY=self.api_key)

    def test_pos_catalog_and_barcode_lookup_use_inventory_scope(self):
        catalog = self.client.get("/api/v1/inventory/products/pos-catalog/")
        barcode = self.client.get("/api/v1/inventory/products/pos-barcode-lookup/", {"code": self.product.barcode})

        self.assertEqual(catalog.status_code, 200)
        self.assertEqual(catalog.data["results"][0]["id"], self.product.id)
        self.assertEqual(barcode.status_code, 200)
        self.assertEqual(barcode.data["price"], "15.00")

    def test_branch_catalog_includes_shared_and_matching_branch_products(self):
        branch = Branch.objects.create(user=self.user, name="Downtown")
        branch_product = Product.objects.create(
            user=self.user, branch=branch, name="Coffee", sku="COF-1", stock=2,
            price=Decimal("20.00"), cost_price=Decimal("12.00"),
        )
        response = self.client.get("/api/v1/inventory/products/pos-catalog/", {"branch": branch.id})

        self.assertEqual(response.status_code, 200)
        result_ids = {item["id"] for item in response.data["results"]}
        self.assertEqual(result_ids, {self.product.id, branch_product.id})

    def test_sale_items_payload_and_idempotent_retry_deduct_stock_once(self):
        payload = {
            "integration_id": "terminal-1:receipt-100045",
            "payment_method": "Cash",
            "items": [{"product": self.product.id, "quantity": 2, "unit_price": "15.00"}],
        }
        first = self.client.post("/api/v1/sales/", payload, format="json")
        retry = self.client.post("/api/v1/sales/", payload, format="json")

        self.product.refresh_from_db()
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(retry["Idempotent-Replay"], "true")
        self.assertEqual(Sale.objects.filter(created_by=self.user).count(), 1)
        self.assertEqual(SaleItem.objects.filter(sale__created_by=self.user).count(), 1)
        self.assertEqual(self.product.stock, 3)
        self.assertEqual(first.data["items"][0]["product"], self.product.id)

    def test_discount_is_saved_and_returns_refund_at_the_sale_price_and_restock(self):
        created = self.client.post("/api/v1/sales/", {
            "integration_id": "discount-return-1",
            "payment_method": "Cash",
            "items": [{
                "product": self.product.id,
                "quantity": 2,
                "unit_price": "15.00",
                "discount_amount": "2.00",
            }],
        }, format="json")
        self.assertEqual(created.status_code, 201, created.data)
        sale_item = created.data["items"][0]

        self.product.refresh_from_db()
        self.product.cost_price = Decimal("99.00")
        self.product.save(update_fields=["cost_price"])
        returned = self.client.post(
            f"/api/v1/sales/{created.data['id']}/returns/",
            {"sale_item": sale_item["id"], "quantity": 1, "refund_method": "Cash"},
            format="json",
        )
        self.product.refresh_from_db()
        duplicate = self.client.post(
            f"/api/v1/sales/{created.data['id']}/returns/",
            {"sale_item": sale_item["id"], "quantity": 2, "refund_method": "Cash"},
            format="json",
        )
        voided = self.client.delete(f"/api/v1/sales/{created.data['id']}/")

        self.assertEqual(created.data["total"], "26.00")
        self.assertEqual(sale_item["discount_amount"], "2.00")
        self.assertEqual(returned.status_code, 201, returned.data)
        self.assertEqual(returned.data["refund_amount"], "13.00")
        self.assertEqual(returned.data["cost_amount"], "8.00")
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(voided.status_code, 204)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 5)

    def test_inventory_only_key_cannot_create_sale(self):
        self.client.credentials()
        key = ApiKey.objects.get(user=self.user)
        key.permissions = ["inventory"]
        key.save(update_fields=["permissions"])
        self.client.credentials(HTTP_X_API_KEY=self.api_key)

        response = self.client.post("/api/v1/sales/", {
            "payment_method": "Cash",
            "items": [{"product": self.product.id, "quantity": 1, "unit_price": "15.00"}],
        }, format="json")

        self.assertEqual(response.status_code, 403)

    def test_duplicate_lines_cannot_oversell_and_rollback_entire_sale(self):
        response = self.client.post("/api/v1/sales/", {
            "payment_method": "Cash",
            "items": [
                {"product": self.product.id, "quantity": 3, "unit_price": "15.00"},
                {"product": self.product.id, "quantity": 3, "unit_price": "15.00"},
            ],
        }, format="json")

        self.product.refresh_from_db()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.product.stock, 5)
        self.assertFalse(Sale.objects.filter(created_by=self.user).exists())

    def test_fractional_quantity_is_rejected_without_changing_stock(self):
        response = self.client.post("/api/v1/sales/", {
            "payment_method": "Cash",
            "items": [{"product": self.product.id, "quantity": 1.5, "unit_price": "15.00"}],
        }, format="json")

        self.product.refresh_from_db()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.product.stock, 5)
        self.assertFalse(Sale.objects.filter(created_by=self.user).exists())

    def test_reused_integration_id_with_different_payload_conflicts(self):
        payload = {
            "integration_id": "terminal-1:receipt-100046",
            "payment_method": "Cash",
            "items": [{"product": self.product.id, "quantity": 1, "unit_price": "15.00"}],
        }
        first = self.client.post("/api/v1/sales/", payload, format="json")
        payload["items"][0]["quantity"] = 2
        retry = self.client.post("/api/v1/sales/", payload, format="json")

        self.product.refresh_from_db()
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(self.product.stock, 4)
        self.assertEqual(Sale.objects.filter(created_by=self.user).count(), 1)

    def test_reused_integration_id_with_different_payment_allocations_conflicts(self):
        payload = {
            "integration_id": "terminal-1:receipt-100047",
            "payment_method": "Cash",
            "items": [{"product": self.product.id, "quantity": 1, "unit_price": "15.00"}],
        }
        first = self.client.post("/api/v1/sales/", payload, format="json")
        payload["payment_allocations"] = [
            {"currency": "ZAR", "amount": "10.00"},
            {"currency": "ZAR", "amount": "5.00"},
        ]
        retry = self.client.post("/api/v1/sales/", payload, format="json")

        self.product.refresh_from_db()
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(self.product.stock, 4)
        self.assertEqual(Sale.objects.filter(created_by=self.user).count(), 1)

    def test_voided_integration_id_cannot_be_reused(self):
        payload = {
            "integration_id": "terminal-1:receipt-100048",
            "payment_method": "Cash",
            "items": [{"product": self.product.id, "quantity": 1, "unit_price": "15.00"}],
        }
        first = self.client.post("/api/v1/sales/", payload, format="json")
        deleted = self.client.delete(f"/api/v1/sales/{first.data['id']}/")
        retry = self.client.post("/api/v1/sales/", payload, format="json")

        self.product.refresh_from_db()
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(deleted.status_code, 204)
        self.assertEqual(retry.status_code, 409)
        self.assertEqual(self.product.stock, 5)
        self.assertEqual(Sale.objects.filter(created_by=self.user).count(), 1)

    def test_sales_key_can_open_summary_and_close_till(self):
        opened = self.client.post("/api/v1/sales/tills/", {
            "opening_cash": "100.00",
            "cashier_name": "Counter 1",
        }, format="json")
        summary = self.client.get("/api/v1/sales/tills/summary/")
        closed = self.client.post(f"/api/v1/sales/tills/{opened.data['id']}/close/", {
            "closing_cash": "100.00",
        }, format="json")

        self.assertEqual(opened.status_code, 201, opened.data)
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.data["open_till"]["id"], opened.data["id"])
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(closed.data["status"], "closed")

    def test_till_reconciliation_counts_collected_amount_and_protects_closed_session(self):
        opened = self.client.post("/api/v1/sales/tills/", {
            "opening_cash": "100.00",
            "cashier_name": "Counter 2",
        }, format="json")
        session = TillSession.objects.get(pk=opened.data["id"])
        Sale.objects.create(
            created_by=self.user,
            till_session=session,
            payment_method="Cash",
            total=Decimal("100.00"),
            amount_paid_base=Decimal("40.00"),
            balance_due=Decimal("60.00"),
        )

        closed = self.client.post(f"/api/v1/sales/tills/{session.id}/close/", {
            "closing_cash": "140.00",
        }, format="json")
        mutation = self.client.patch(f"/api/v1/sales/tills/{session.id}/", {
            "opening_cash": "0.00",
            "closing_cash": "0.00",
            "status": "open",
        }, format="json")

        session.refresh_from_db()
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(Decimal(closed.data["expected_cash"]), Decimal("140.00"))
        self.assertEqual(Decimal(closed.data["cash_variance"]), Decimal("0.00"))
        self.assertEqual(mutation.status_code, 405, mutation.data)
        self.assertEqual(session.opening_cash, Decimal("100.00"))
        self.assertEqual(session.closing_cash, Decimal("140.00"))
        self.assertEqual(session.status, "closed")

    def test_till_cash_expenses_withdrawals_and_deposits_change_expected_close(self):
        self.client.force_authenticate(user=self.user)
        opened = self.client.post("/api/v1/sales/tills/", {
            "opening_cash": "100.00",
            "cashier_name": "Counter movements",
        }, format="json")
        expense = self.client.post("/api/v1/expenses/", {
            "description": "Till receipt paper",
            "amount": "10.00",
            "currency": self.user.currency,
            "date": timezone.localdate().isoformat(),
            "payment_allocations": [{"currency": self.user.currency, "amount": "10.00"}],
        }, format="json")
        self.assertEqual(expense.status_code, 201, expense.data)

        cash_expense = self.client.post(
            f"/api/v1/sales/tills/{opened.data['id']}/cash-movements/",
            {
                "movement_type": "cash_expense",
                "expense": expense.data["id"],
                "note": "Paid from till",
                "idempotency_key": "till-expense-paper-1",
            },
            format="json",
        )
        replay = self.client.post(
            f"/api/v1/sales/tills/{opened.data['id']}/cash-movements/",
            {
                "movement_type": "cash_expense",
                "expense": expense.data["id"],
                "note": "Paid from till",
                "idempotency_key": "till-expense-paper-1",
            },
            format="json",
        )
        withdrawal = self.client.post(
            f"/api/v1/sales/tills/{opened.data['id']}/cash-movements/",
            {"movement_type": "withdrawal", "amount": "8.00", "note": "Bank drop", "idempotency_key": "till-withdrawal-1"},
            format="json",
        )
        deposit = self.client.post(
            f"/api/v1/sales/tills/{opened.data['id']}/cash-movements/",
            {"movement_type": "deposit", "amount": "2.00", "note": "Float top-up", "idempotency_key": "till-deposit-1"},
            format="json",
        )

        self.assertEqual(cash_expense.status_code, 201, cash_expense.data)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(cash_expense.data["id"], replay.data["id"])
        self.assertEqual(withdrawal.status_code, 201, withdrawal.data)
        self.assertEqual(deposit.status_code, 201, deposit.data)
        current = self.client.get("/api/v1/sales/tills/current/")
        self.assertEqual(Decimal(str(current.data["cash_expenses"])), Decimal("10.00"))
        self.assertEqual(Decimal(str(current.data["cash_withdrawals"])), Decimal("8.00"))
        self.assertEqual(Decimal(str(current.data["cash_deposits"])), Decimal("2.00"))
        self.assertEqual(Decimal(str(current.data["expected_cash"])), Decimal("84.00"))

        closed = self.client.post(
            f"/api/v1/sales/tills/{opened.data['id']}/close/",
            {"closing_cash": "84.00"},
            format="json",
        )
        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(Decimal(str(closed.data["expected_cash"])), Decimal("84.00"))
        self.assertEqual(Decimal(str(closed.data["cash_variance"])), Decimal("0.00"))
        self.assertEqual(len(closed.data["cash_movements"]), 3)

    def test_till_history_is_preserved_and_owner_review_is_recorded(self):
        opened = self.client.post("/api/v1/sales/tills/", {
            "opening_cash": "50.00",
            "cashier_name": "Counter 3",
        }, format="json")
        closed = self.client.post(f"/api/v1/sales/tills/{opened.data['id']}/close/", {
            "closing_cash": "50.00",
            "notes": "Count matched.",
        }, format="json")
        deleted = self.client.delete(f"/api/v1/sales/tills/{opened.data['id']}/")

        self.assertEqual(closed.status_code, 200, closed.data)
        self.assertEqual(deleted.status_code, 405)
        self.assertEqual(closed.data["notes"], "Count matched.")
        self.assertIsNone(closed.data["reviewed_at"])

        cashier = Staff.objects.create(
            user=self.user,
            name="Counter staff",
            role="Cashier",
            status=Staff.ACTIVE,
            login_enabled=True,
            permissions=["sales"],
        )
        refresh = RefreshToken.for_user(self.user)
        refresh["staff_id"] = cashier.id
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
        cashier_review = self.client.post(
            f"/api/v1/sales/tills/{opened.data['id']}/review/", {}, format="json"
        )
        self.assertEqual(cashier_review.status_code, 403, cashier_review.data)

        self.client.force_authenticate(user=self.user)
        reviewed = self.client.post(
            f"/api/v1/sales/tills/{opened.data['id']}/review/",
            {"note": "Verified against the drawer count."},
            format="json",
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.data)
        self.assertIsNotNone(reviewed.data["reviewed_at"])
        self.assertEqual(reviewed.data["reviewer_name"], self.user.email)
        self.assertEqual(reviewed.data["review_note"], "Verified against the drawer count.")


class SaleNumberingTests(TestCase):
    def test_receipt_numbers_use_the_sale_primary_key_without_counting_history(self):
        user = get_user_model().objects.create_user(
            username="number-owner", email="number@example.com", password="test-pass-123",
        )

        first = Sale.objects.create(created_by=user)
        second = Sale.objects.create(created_by=user)

        self.assertEqual(first.receipt_number, f"R-{first.pk:06d}")
        self.assertEqual(second.receipt_number, f"R-{second.pk:06d}")
        self.assertNotEqual(first.receipt_number, second.receipt_number)
