from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from audits.models import Audit, Discrepancy, StockCount
from billing.services import activate_plan
from inventory.models import Product
from sales.models import Sale
from sync.models import ProcessedSyncAction


User = get_user_model()


class RobustnessTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            email="robustness@example.com",
            username="robustness@example.com",
            password="password123",
            currency="ZAR",
            currency_symbol="R",
        )
        activate_plan(self.user, "business")
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.product = Product.objects.create(
            user=self.user,
            name="Bread",
            sku="BRD-001",
            stock=10,
            reorder_level=2,
            cost_price=Decimal("40.00"),
            price=Decimal("99.00"),
        )

    def test_negative_credit_mutations_are_rejected(self):
        customer = self.client.post("/api/v1/customers/", {"name": "Customer"}, format="json").json()
        customer_id = customer["id"]

        add_response = self.client.post(f"/api/v1/customers/{customer_id}/add-credit/", {"amount": "-10"}, format="json")
        redeem_response = self.client.post(f"/api/v1/customers/{customer_id}/redeem-credit/", {"amount": "-10"}, format="json")

        self.assertEqual(add_response.status_code, 400)
        self.assertEqual(redeem_response.status_code, 400)

    def test_sale_total_and_subtotal_are_calculated_by_server(self):
        response = self.client.post(
            "/api/v1/sales/",
            {
                "payment_method": "Cash",
                "payment_currency": "ZAR",
                "payment_allocations": [{"currency": "ZAR", "amount": "198.00"}],
                "sale_items": [
                    {
                        "product": self.product.id,
                        "quantity": 2,
                        "unit_price": "99.00",
                        "subtotal": "1.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201)
        sale = Sale.objects.get()
        self.assertEqual(sale.total, Decimal("198.00"))
        self.assertEqual(sale.sale_items.get().subtotal, Decimal("198.00"))
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 8)

    def test_offline_action_replay_is_idempotent(self):
        action = {
            "id": "offline-product-1",
            "type": "product_create",
            "payload": {
                "local_id": "local-product-1",
                "name": "Cooking Oil",
                "sku": "OIL-001",
                "categoryName": "Groceries",
                "stock": 5,
                "reorder_level": 1,
                "cost_price": "20.00",
                "price": "35.00",
            },
        }

        first = self.client.post("/api/v1/sync/push/", {"actions": [action]}, format="json")
        second = self.client.post("/api/v1/sync/push/", {"actions": [action]}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.json()["processed"], 1)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json()["processed"], 0)
        self.assertEqual(Product.objects.filter(user=self.user, sku="OIL-001").count(), 1)
        self.assertTrue(ProcessedSyncAction.objects.filter(user=self.user, action_id="offline-product-1").exists())

    def test_offline_sale_reconciles_stock_once(self):
        action = {
            "id": "offline-sale-1",
            "type": "sale",
            "payload": {
                "payment_method": "Cash",
                "payment_currency": "ZAR",
                "payment_allocations": [{"currency": "ZAR", "amount": "99.00"}],
                "sale_items": [{
                    "product": self.product.id,
                    "product_name": self.product.name,
                    "quantity": 1,
                    "unit_price": "99.00",
                    "subtotal": "1.00",
                }],
            },
        }

        first = self.client.post("/api/v1/sync/push/", {"actions": [action]}, format="json")
        second = self.client.post("/api/v1/sync/push/", {"actions": [action]}, format="json")

        self.assertEqual(first.json()["processed"], 1)
        self.assertEqual(second.json()["processed"], 0)
        self.assertEqual(Sale.objects.filter(created_by=self.user).count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 9)

    def test_repeating_audit_completion_does_not_duplicate_discrepancies(self):
        audit = Audit.objects.create(conductor=self.user, status="in_progress")
        StockCount.objects.create(audit=audit, product=self.product, counted_quantity=8, counted_by=self.user)

        first = self.client.post(f"/api/v1/audits/{audit.id}/complete/", {}, format="json")
        second = self.client.post(f"/api/v1/audits/{audit.id}/complete/", {}, format="json")

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(Discrepancy.objects.filter(audit=audit).count(), 1)
        audit.refresh_from_db()
        self.assertEqual(audit.discrepancies_found, 1)
