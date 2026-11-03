from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from inventory.models import Product, ProductBatch, PurchaseOrder, PurchaseOrderItem, StockMovement, Supplier


class PurchaseOrderNumberingTests(TestCase):
    def test_order_numbers_use_the_order_primary_key(self):
        user = get_user_model().objects.create_user(
            username="order-owner", email="order@example.com", password="test-pass-123",
        )
        supplier = Supplier.objects.create(user=user, name="Test supplier")

        first = PurchaseOrder.objects.create(user=user, supplier=supplier)
        second = PurchaseOrder.objects.create(user=user, supplier=supplier)

        self.assertEqual(first.order_number, f"PO-{first.pk:05d}")
        self.assertEqual(second.order_number, f"PO-{second.pk:05d}")
        self.assertNotEqual(first.order_number, second.order_number)


class ProductBatchTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="batch-owner", email="batch@example.com")
        self.product = Product.objects.create(user=self.user, name="Milk", sku="MILK", stock=2)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_receiving_batch_updates_product_stock_and_movement_history(self):
        response = self.client.post(
            "/api/v1/inventory/batches/receive/",
            {
                "product": self.product.id,
                "batch_number": "MILK-LOT-1",
                "expiry_date": "2027-01-31",
                "quantity_received": 6,
                "unit_cost_base": "1.25",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.product.refresh_from_db()
        batch = ProductBatch.objects.get(product=self.product)
        movement = StockMovement.objects.get(product=self.product, batch=batch)
        self.assertEqual(self.product.stock, 8)
        self.assertEqual(batch.quantity_remaining, 6)
        self.assertEqual(movement.quantity, 6)
        self.assertEqual(movement.movement_type, "in")

    def test_batch_number_must_be_unique_per_product(self):
        ProductBatch.objects.create(
            product=self.product,
            batch_number="DUPLICATE",
            quantity_received=2,
            quantity_remaining=2,
        )

        response = self.client.post(
            "/api/v1/inventory/batches/receive/",
            {
                "product": self.product.id,
                "batch_number": "DUPLICATE",
                "quantity_received": 1,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 2)

    def test_product_stock_cannot_be_reduced_below_tracked_batches(self):
        ProductBatch.objects.create(
            product=self.product,
            batch_number="TRACKED",
            quantity_received=3,
            quantity_remaining=3,
        )

        response = self.client.patch(
            f"/api/v1/inventory/products/{self.product.id}/",
            {"stock": 2},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 2)


class SupplierPaymentTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="pay-owner", email="pay@example.com")
        self.supplier = Supplier.objects.create(user=self.user, name="Flour supplier")
        self.product = Product.objects.create(user=self.user, name="Flour", sku="FLOUR", stock=6)
        self.order = PurchaseOrder.objects.create(
            user=self.user,
            supplier=self.supplier,
            status="partially_received",
        )
        PurchaseOrderItem.objects.create(
            purchase_order=self.order,
            product=self.product,
            quantity_ordered=10,
            quantity_received=6,
            unit_cost=5,
            unit_cost_base=5,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_payments_reduce_supplier_balance_and_cannot_overpay_received_goods(self):
        response = self.client.post(
            "/api/v1/inventory/supplier-payments/",
            {
                "supplier": self.supplier.id,
                "purchase_order": self.order.id,
                "amount": "20.00",
                "currency": self.user.currency,
                "payment_date": "2026-11-04",
                "method": "bank",
                "reference": "BANK-001",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        balances = self.client.get("/api/v1/inventory/supplier-payments/balances/")
        self.assertEqual(balances.status_code, 200, balances.data)
        balance = balances.data["items"][0]
        self.assertEqual(Decimal(str(balance["received_total_base"])), Decimal("30.00"))
        self.assertEqual(Decimal(str(balance["paid_total_base"])), Decimal("20.00"))
        self.assertEqual(Decimal(str(balance["outstanding_base"])), Decimal("10.00"))

        overpayment = self.client.post(
            "/api/v1/inventory/supplier-payments/",
            {
                "supplier": self.supplier.id,
                "purchase_order": self.order.id,
                "amount": "10.01",
                "currency": self.user.currency,
                "payment_date": "2026-11-04",
                "method": "cash",
            },
            format="json",
        )
        self.assertEqual(overpayment.status_code, 400, overpayment.data)

    def test_purchase_order_receipt_can_record_an_expiry_batch(self):
        item = self.order.items.get()
        self.order.status = "ordered"
        self.order.save(update_fields=["status"])

        response = self.client.post(
            f"/api/v1/inventory/purchase-orders/{self.order.id}/receive/",
            {"batches": {str(item.id): {"batch_number": "FLOUR-LOT", "expiry_date": "2027-01-31"}}},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        batch = ProductBatch.objects.get(product=self.product, batch_number="FLOUR-LOT")
        self.assertEqual(batch.quantity_remaining, 4)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 10)
