from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from inventory.models import Branch, Product, ProductBatch, PurchaseOrder, PurchaseOrderItem, StockMovement, StockTransfer, Supplier


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


class BranchWorkflowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog
        sync_plan_catalog(force=True)

    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="branch-owner", email="branch@example.com")
        from billing.models import Plan
        from billing.services import get_or_create_subscription
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.source_branch = Branch.objects.create(user=self.user, name="Source")
        self.target_branch = Branch.objects.create(user=self.user, name="Target")
        self.product = Product.objects.create(
            user=self.user, branch=self.source_branch, name="Milk", sku="MILK", stock=5
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_batch_transfer_moves_stock_and_creates_target_batch(self):
        batch = ProductBatch.objects.create(
            product=self.product,
            batch_number="MILK-LOT-1",
            quantity_received=5,
            quantity_remaining=5,
            unit_cost_base=Decimal("1.25"),
        )

        response = self.client.post(
            f"/api/v1/inventory/products/{self.product.id}/transfer/",
            {"to_branch": self.target_branch.id, "quantity": 3, "batch": batch.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.product.refresh_from_db()
        batch.refresh_from_db()
        target = Product.objects.get(user=self.user, branch=self.target_branch, sku=self.product.sku)
        target_batch = ProductBatch.objects.get(product=target, batch_number=batch.batch_number)
        transfer = StockTransfer.objects.get()
        self.assertEqual(self.product.stock, 2)
        self.assertEqual(batch.quantity_remaining, 2)
        self.assertEqual(target.stock, 3)
        self.assertEqual(target_batch.quantity_remaining, 3)
        self.assertEqual(transfer.target_product_id, target.id)
        self.assertEqual(transfer.batch_id, batch.id)

    def test_untracked_stock_can_be_transferred_when_product_also_has_batches(self):
        ProductBatch.objects.create(
            product=self.product,
            batch_number="MILK-LOT-1",
            quantity_received=5,
            quantity_remaining=5,
        )
        self.product.stock = 7
        self.product.save()

        response = self.client.post(
            f"/api/v1/inventory/products/{self.product.id}/transfer/",
            {"to_branch": self.target_branch.id, "quantity": 2},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.product.refresh_from_db()
        target = Product.objects.get(user=self.user, branch=self.target_branch, sku=self.product.sku)
        transfer = StockTransfer.objects.get()
        self.assertEqual(self.product.stock, 5)
        self.assertEqual(target.stock, 2)
        self.assertIsNone(transfer.batch_id)

    def test_transfer_cannot_use_untracked_stock_to_exceed_available_untracked_quantity(self):
        ProductBatch.objects.create(
            product=self.product,
            batch_number="MILK-LOT-1",
            quantity_received=5,
            quantity_remaining=5,
        )

        response = self.client.post(
            f"/api/v1/inventory/products/{self.product.id}/transfer/",
            {"to_branch": self.target_branch.id, "quantity": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(StockTransfer.objects.exists())

    def test_branch_with_products_cannot_be_deleted(self):
        response = self.client.delete(f"/api/v1/inventory/branches/{self.source_branch.id}/")

        self.assertEqual(response.status_code, 400, response.data)
        self.assertFalse(Branch.objects.get(pk=self.source_branch.id).is_deleted)

    def test_purchase_order_rejects_products_from_another_assigned_branch(self):
        supplier = Supplier.objects.create(user=self.user, name="Supplier")

        response = self.client.post(
            "/api/v1/inventory/purchase-orders/",
            {
                "supplier": supplier.id,
                "branch": self.target_branch.id,
                "items": [{"product": self.product.id, "quantity_ordered": 2, "unit_cost": "1.00"}],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)


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
