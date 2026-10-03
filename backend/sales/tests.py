from decimal import Decimal
from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from accounts.models import ApiKey
from inventory.models import Product
from inventory.models import Branch
from sales.models import Sale, SaleItem


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
