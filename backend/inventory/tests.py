from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db.models import Sum
from django.test import TestCase
from django.utils.timezone import localdate
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Staff

from inventory.models import (
    Branch,
    GoodsReceivedNote,
    GoodsReceivedNoteItem,
    Product,
    ProductBatch,
    PurchaseCostHistory,
    PurchaseOrder,
    PurchaseOrderItem,
    StockMovement,
    StockTransfer,
    Supplier,
    SupplierReturn,
)
from sales.models import Sale, SaleItem, SaleReturn


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

        self.assertEqual(response.status_code, 201, response.data)
        transfer_id = response.data["transfer"]["id"]
        self.product.refresh_from_db()
        batch.refresh_from_db()
        self.assertEqual(self.product.stock, 5)
        self.assertEqual(batch.quantity_remaining, 5)

        approved = self.client.post(f"/api/v1/inventory/transfers/{transfer_id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        dispatched = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/dispatch/", {"quantity": 3}, format="json"
        )
        self.assertEqual(dispatched.status_code, 200, dispatched.data)
        received = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/receive/", {"quantity": 3}, format="json"
        )
        self.assertEqual(received.status_code, 200, received.data)

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

    def test_partial_transfer_receipt_records_discrepancy_without_creating_stock(self):
        request_response = self.client.post(
            f"/api/v1/inventory/products/{self.product.id}/transfer/",
            {"to_branch": self.target_branch.id, "quantity": 4},
            format="json",
        )
        self.assertEqual(request_response.status_code, 201, request_response.data)
        transfer_id = request_response.data["transfer"]["id"]
        approved = self.client.post(f"/api/v1/inventory/transfers/{transfer_id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        dispatched = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/dispatch/", {"quantity": 4}, format="json"
        )
        self.assertEqual(dispatched.status_code, 200, dispatched.data)
        transfer = StockTransfer.objects.get(pk=transfer_id)
        target = Product.objects.get(user=self.user, branch=self.target_branch, sku=self.product.sku)
        self.assertEqual(transfer.quantity_in_transit, 4)
        self.assertEqual(target.stock, 0)

        partial = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/receive/",
            {"quantity": 2},
            format="json",
        )
        self.assertEqual(partial.status_code, 200, partial.data)
        self.assertEqual(partial.data["status"], StockTransfer.STATUS_PARTIALLY_RECEIVED)
        self.assertEqual(partial.data["quantity_in_transit"], 2)
        target.refresh_from_db()
        self.assertEqual(target.stock, 2)

        final = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/receive/",
            {"quantity": 1, "discrepant_quantity": 1, "discrepancy_note": "One unit missing"},
            format="json",
        )
        self.assertEqual(final.status_code, 200, final.data)
        self.assertEqual(final.data["status"], StockTransfer.STATUS_COMPLETED)
        self.assertEqual(final.data["quantity_received"], 3)
        self.assertEqual(final.data["quantity_discrepant"], 1)
        self.assertEqual(final.data["discrepancy_note"], "One unit missing")
        self.assertEqual(final.data["quantity_in_transit"], 0)
        self.assertEqual(StockTransfer.objects.get(pk=transfer_id).events.count(), 5)
        target.refresh_from_db()
        self.product.refresh_from_db()
        self.assertEqual(target.stock, 3)
        self.assertEqual(self.product.stock, 1)

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

        self.assertEqual(response.status_code, 201, response.data)
        transfer_id = response.data["transfer"]["id"]
        approved = self.client.post(f"/api/v1/inventory/transfers/{transfer_id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        dispatched = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/dispatch/", {"quantity": 2}, format="json"
        )
        self.assertEqual(dispatched.status_code, 200, dispatched.data)
        received = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/receive/", {"quantity": 2}, format="json"
        )
        self.assertEqual(received.status_code, 200, received.data)
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

        request_response = self.client.post(
            f"/api/v1/inventory/products/{self.product.id}/transfer/",
            {"to_branch": self.target_branch.id, "quantity": 1},
            format="json",
        )

        self.assertEqual(request_response.status_code, 201, request_response.data)
        transfer_id = request_response.data["transfer"]["id"]
        approved = self.client.post(f"/api/v1/inventory/transfers/{transfer_id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        dispatch = self.client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/dispatch/", {"quantity": 1}, format="json"
        )
        self.assertEqual(dispatch.status_code, 400, dispatch.data)
        self.assertEqual(StockTransfer.objects.count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 5)

    def test_destination_staff_cannot_dispatch_a_transfer_for_the_source_branch(self):
        request_response = self.client.post(
            f"/api/v1/inventory/products/{self.product.id}/transfer/",
            {"to_branch": self.target_branch.id, "quantity": 1},
            format="json",
        )
        self.assertEqual(request_response.status_code, 201, request_response.data)
        transfer_id = request_response.data["transfer"]["id"]
        approved = self.client.post(f"/api/v1/inventory/transfers/{transfer_id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)

        staff = Staff.objects.create(
            user=self.user, branch=self.target_branch, name="Receiving clerk",
            role=Staff.MANAGER, status=Staff.ACTIVE, login_enabled=True,
            permissions=["inventory"],
        )
        refresh = RefreshToken.for_user(self.user)
        refresh["staff_id"] = staff.pk
        staff_client = APIClient()
        staff_client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
        response = staff_client.post(
            f"/api/v1/inventory/transfers/{transfer_id}/dispatch/",
            {"quantity": 1},
            format="json",
        )

        self.assertEqual(response.status_code, 403, response.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 5)

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
                "idempotency_key": "payment-bank-001",
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
                "idempotency_key": "payment-overpay-001",
            },
            format="json",
        )
        self.assertEqual(overpayment.status_code, 400, overpayment.data)

    def test_required_supplier_invoice_payment_example_leaves_correct_balance(self):
        item = self.order.items.get()
        item.quantity_received = 10
        item.unit_cost = Decimal("20.00")
        item.unit_cost_base = Decimal("20.00")
        item.save(update_fields=["quantity_received", "unit_cost", "unit_cost_base"])
        response = self.client.post(
            "/api/v1/inventory/supplier-payments/",
            {
                "supplier": self.supplier.id,
                "purchase_order": self.order.id,
                "amount": "75.00",
                "currency": self.user.currency,
                "payment_date": localdate().isoformat(),
                "method": "bank",
                "reference": "SUPPLIER-200-75",
                "idempotency_key": "supplier-example-200-payment-75",
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        balances = self.client.get("/api/v1/inventory/supplier-payments/balances/")
        self.assertEqual(balances.status_code, 200, balances.data)
        self.assertEqual(Decimal(str(balances.data["items"][0]["received_total_base"])), Decimal("200.00"))
        self.assertEqual(Decimal(str(balances.data["items"][0]["paid_total_base"])), Decimal("75.00"))
        self.assertEqual(Decimal(str(balances.data["items"][0]["outstanding_base"])), Decimal("125.00"))

    def test_payment_retries_are_idempotent_and_conflicts_do_not_post_twice(self):
        payload = {
            "supplier": self.supplier.id,
            "purchase_order": self.order.id,
            "amount": "10.00",
            "currency": self.user.currency,
            "payment_date": "2026-11-04",
            "method": "bank",
            "reference": "BANK-RETRY-1",
            "idempotency_key": "payment-retry-001",
        }
        first = self.client.post("/api/v1/inventory/supplier-payments/", payload, format="json")
        retry = self.client.post("/api/v1/inventory/supplier-payments/", payload, format="json")
        conflict = self.client.post(
            "/api/v1/inventory/supplier-payments/",
            {**payload, "amount": "11.00"},
            format="json",
        )

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(retry.status_code, 201, retry.data)
        self.assertEqual(first.data["id"], retry.data["id"])
        self.assertEqual(conflict.status_code, 400, conflict.data)
        balances = self.client.get("/api/v1/inventory/supplier-payments/balances/")
        self.assertEqual(Decimal(str(balances.data["items"][0]["paid_total_base"])), Decimal("10.00"))

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

    def test_supplier_balance_lists_received_invoice_when_past_due(self):
        self.order.due_date = localdate() - timedelta(days=1)
        self.order.supplier_invoice_number = "INV-OVERDUE"
        self.order.save(update_fields=["due_date", "supplier_invoice_number"])

        response = self.client.get("/api/v1/inventory/supplier-payments/balances/")

        self.assertEqual(response.status_code, 200, response.data)
        invoice = response.data["overdue_invoices"][0]
        self.assertEqual(invoice["invoice_number"], "INV-OVERDUE")
        self.assertEqual(Decimal(str(invoice["outstanding_base"])), Decimal("30.00"))

    def test_supplier_statement_shows_invoice_balance_and_payment_activity(self):
        payment = self.client.post(
            "/api/v1/inventory/supplier-payments/",
            {
                "supplier": self.supplier.id,
                "purchase_order": self.order.id,
                "amount": "20.00",
                "currency": self.user.currency,
                "payment_date": localdate().isoformat(),
                "method": "bank",
                "reference": "SUPPLIER-REF-20",
                "idempotency_key": "supplier-statement-payment-20",
            },
            format="json",
        )
        self.assertEqual(payment.status_code, 201, payment.data)

        statement = self.client.get(f"/api/v1/inventory/suppliers/{self.supplier.id}/statement/")

        self.assertEqual(statement.status_code, 200, statement.data)
        self.assertEqual(Decimal(str(statement.data["totals"]["received_total_base"])), Decimal("30.00"))
        self.assertEqual(Decimal(str(statement.data["totals"]["paid_total_base"])), Decimal("20.00"))
        self.assertEqual(Decimal(str(statement.data["totals"]["outstanding_base"])), Decimal("10.00"))
        self.assertEqual(statement.data["invoices"][0]["order_number"], self.order.order_number)
        self.assertEqual(statement.data["invoices"][0]["status"], "open")
        self.assertEqual([row["type"] for row in statement.data["activity"]], ["invoice", "payment"])
        self.assertEqual(Decimal(str(statement.data["activity"][-1]["balance_base"])), Decimal("10.00"))

        foreign_supplier = Supplier.objects.create(
            user=get_user_model().objects.create_user(username="other-supplier-owner", email="other-supplier@example.com"),
            name="Private supplier",
        )
        forbidden_statement = self.client.get(f"/api/v1/inventory/suppliers/{foreign_supplier.id}/statement/")
        self.assertEqual(forbidden_statement.status_code, 404)

    def test_supplier_balances_include_legacy_and_grn_receipts_for_the_same_order(self):
        order_item = self.order.items.get()
        order_item.quantity_received = 8
        order_item.save(update_fields=["quantity_received"])
        note = GoodsReceivedNote.objects.create(
            user=self.user,
            purchase_order=self.order,
            grn_number="GRN-MIXED-1",
            status=GoodsReceivedNote.STATUS_CONFIRMED,
            delivery_date=localdate(),
        )
        GoodsReceivedNoteItem.objects.create(
            goods_received_note=note,
            purchase_order_item=order_item,
            quantity_delivered=2,
            quantity_damaged=0,
            quantity_missing=0,
            unit_cost=Decimal("5.00"),
            unit_cost_base=Decimal("5.00"),
            total_cost_base=Decimal("10.00"),
        )

        balances = self.client.get("/api/v1/inventory/supplier-payments/balances/")
        statement = self.client.get(f"/api/v1/inventory/suppliers/{self.supplier.id}/statement/")

        self.assertEqual(balances.status_code, 200, balances.data)
        self.assertEqual(statement.status_code, 200, statement.data)
        self.assertEqual(Decimal(str(balances.data["items"][0]["received_total_base"])), Decimal("40.00"))
        self.assertEqual(Decimal(str(statement.data["totals"]["received_total_base"])), Decimal("40.00"))
        self.assertEqual(
            Decimal(str(statement.data["invoices"][0]["outstanding_base"])),
            Decimal("40.00"),
        )


class GoodsReceivedNoteWorkflowTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="grn-owner", email="grn@example.com")
        self.supplier = Supplier.objects.create(user=self.user, name="Goods supplier")
        self.product = Product.objects.create(user=self.user, name="Tea", sku="TEA", stock=0)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        response = self.client.post(
            "/api/v1/inventory/purchase-orders/",
            {
                "supplier": self.supplier.id,
                "items": [{"product": self.product.id, "quantity_ordered": 5, "unit_cost": "4.00"}],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.order_id = response.data["id"]
        self.item_id = response.data["items"][0]["id"]

    def _approve_order(self):
        response = self.client.post(f"/api/v1/inventory/purchase-orders/{self.order_id}/submit/")
        self.assertEqual(response.status_code, 200, response.data)
        response = self.client.post(f"/api/v1/inventory/purchase-orders/{self.order_id}/approve/")
        self.assertEqual(response.status_code, 200, response.data)

    def _create_and_confirm_grn(self, quantity, damaged=0):
        response = self.client.post(
            f"/api/v1/inventory/purchase-orders/{self.order_id}/goods-received-notes/",
            {
                "items": [{
                    "purchase_order_item": self.item_id,
                    "quantity_delivered": quantity,
                    "quantity_damaged": damaged,
                    "unit_cost": "4.00",
                }],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.data)
        note_id = response.data["id"]
        response = self.client.post(f"/api/v1/inventory/goods-received-notes/{note_id}/confirm/")
        self.assertEqual(response.status_code, 200, response.data)
        return note_id

    def test_partial_deliveries_only_stock_accepted_goods_and_confirmation_is_idempotent(self):
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 0)
        self._approve_order()

        first_note_id = self._create_and_confirm_grn(2, damaged=1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 1)
        first_note = GoodsReceivedNote.objects.get(pk=first_note_id)
        first_line = first_note.items.get()
        self.assertEqual(first_line.quantity_accepted, 1)
        self.assertTrue(first_line.stock_movement_id)

        response = self.client.post(f"/api/v1/inventory/goods-received-notes/{first_note_id}/confirm/")
        self.assertEqual(response.status_code, 200, response.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 1)
        self.assertEqual(StockMovement.objects.filter(product=self.product).count(), 1)

        self._create_and_confirm_grn(3)
        self.product.refresh_from_db()
        order = PurchaseOrder.objects.get(pk=self.order_id)
        self.assertEqual(self.product.stock, 4)
        self.assertEqual(order.status, PurchaseOrder.STATUS_FULLY_RECEIVED)
        self.assertEqual(PurchaseCostHistory.objects.filter(product=self.product).aggregate(
            total=Sum("quantity")
        )["total"], 4)
        self.assertEqual(StockMovement.objects.filter(product=self.product).count(), 2)

    def test_supplier_return_reduces_stock_and_same_idempotency_key_does_not_repeat_it(self):
        self._approve_order()
        note_id = self._create_and_confirm_grn(5)
        line = GoodsReceivedNoteItem.objects.get(goods_received_note_id=note_id)
        payload = {
            "purchase_order": self.order_id,
            "reason": "damaged",
            "idempotency_key": "return-001",
            "items": [{"goods_received_note_item": line.id, "quantity": 2}],
        }

        response = self.client.post("/api/v1/inventory/supplier-returns/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        return_id = response.data["id"]
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 3)
        self.assertEqual(StockMovement.objects.filter(product=self.product, movement_type="out").count(), 1)

        response = self.client.post("/api/v1/inventory/supplier-returns/", payload, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["id"], return_id)
        self.assertEqual(SupplierReturn.objects.count(), 1)
        self.assertEqual(StockMovement.objects.filter(product=self.product, movement_type="out").count(), 1)

    def test_returning_goods_rejected_as_damaged_does_not_change_stock_twice_or_create_movement(self):
        self._approve_order()
        note_id = self._create_and_confirm_grn(5, damaged=2)
        line = GoodsReceivedNoteItem.objects.get(goods_received_note_id=note_id)
        response = self.client.post(
            "/api/v1/inventory/supplier-returns/",
            {
                "purchase_order": self.order_id,
                "reason": "damaged",
                "idempotency_key": "damaged-return-001",
                "items": [{
                    "goods_received_note_item": line.id,
                    "quantity": 0,
                    "quantity_damaged": 2,
                }],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["items"][0]["quantity_damaged"], 2)
        self.assertEqual(Decimal(str(response.data["total_amount_base"])), Decimal("0.00"))
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 3)
        self.assertEqual(StockMovement.objects.filter(product=self.product, movement_type="out").count(), 0)


class InventoryIntelligenceTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="insights-owner", email="insights@example.com")
        self.product = Product.objects.create(
            user=self.user, name="Coffee", sku="COFFEE", stock=2,
            cost_price=Decimal("4.00"), cost_fx_rate_to_base=Decimal("1.5"),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_inventory_intelligence_uses_sales_returns_batches_and_historical_costs(self):
        supplier = Supplier.objects.create(user=self.user, name="Coffee supplier")
        order = PurchaseOrder.objects.create(user=self.user, supplier=supplier)
        order_item = PurchaseOrderItem.objects.create(
            purchase_order=order, product=self.product, quantity_ordered=1, quantity_received=1,
        )
        note = GoodsReceivedNote.objects.create(
            user=self.user, purchase_order=order, grn_number="GRN-INSIGHTS", status="confirmed",
        )
        line = GoodsReceivedNoteItem.objects.create(
            goods_received_note=note,
            purchase_order_item=order_item,
            quantity_delivered=1,
            unit_cost=Decimal("5.00"),
            unit_cost_base=Decimal("8.00"),
            total_cost_base=Decimal("8.00"),
        )
        ProductBatch.objects.create(
            product=self.product,
            batch_number="COFFEE-LOT",
            quantity_received=1,
            quantity_remaining=1,
            unit_cost_base=Decimal("8.00"),
        )
        PurchaseCostHistory.objects.create(
            product=self.product, supplier=supplier, purchase_order=order,
            goods_received_note_item=line, quantity=1, unit_cost=Decimal("5.00"),
            currency=self.user.currency, fx_rate_to_base=Decimal("1.6"), unit_cost_base=Decimal("8.00"),
        )
        sale = Sale.objects.create(created_by=self.user, total=Decimal("50.00"))
        sale_item = SaleItem.objects.create(
            sale=sale, product=self.product, quantity=5, unit_cost=Decimal("4.00"),
            unit_price=Decimal("10.00"), subtotal=Decimal("50.00"), cost_total=Decimal("20.00"),
            profit=Decimal("30.00"),
        )
        SaleReturn.objects.create(
            sale_item=sale_item, quantity=1, refund_amount=Decimal("10.00"),
            cost_amount=Decimal("4.00"), created_by=self.user,
        )

        response = self.client.get("/api/v1/inventory/intelligence/?days=90")

        self.assertEqual(response.status_code, 200, response.data)
        item = response.data["items"][0]
        self.assertEqual(item["net_sold_quantity"], 4)
        self.assertEqual(Decimal(str(item["net_revenue"])), Decimal("40.00"))
        self.assertEqual(Decimal(str(item["gross_profit"])), Decimal("24.00"))
        self.assertEqual(Decimal(str(item["inventory_value_base"])), Decimal("14.00"))
        self.assertEqual(Decimal(str(item["average_purchase_cost_base"])), Decimal("8.00"))
        self.assertEqual(item["movement_class"], "slow")
        self.assertEqual(item["untracked_quantity"], 1)
