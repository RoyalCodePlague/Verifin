from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class PurchaseHistoryMigrationTests(TransactionTestCase):
    reset_sequences = True

    migrate_from = ("inventory", "0010_stocktransfer_batch_stocktransfer_target_product")
    migrate_to = ("inventory", "0011_purchaseorder_additional_charges_and_more")

    def migrate_inventory(self, target):
        executor = MigrationExecutor(connection)
        # Keep the historical model state paired with the schema at that exact
        # migration. Including unrelated app leaf nodes can pull inventory
        # forward through their dependencies while this test still asks for
        # the older inventory models.
        executor.migrate([target])
        return executor.loader.project_state([target]).apps

    def test_legacy_order_status_and_receipt_cost_are_preserved(self):
        old_apps = self.migrate_inventory(self.migrate_from)
        user = get_user_model().objects.create_user(
            username="legacy-purchase-owner", email="legacy-purchase@example.com",
        )
        Supplier = old_apps.get_model("inventory", "Supplier")
        Product = old_apps.get_model("inventory", "Product")
        PurchaseOrder = old_apps.get_model("inventory", "PurchaseOrder")
        PurchaseOrderItem = old_apps.get_model("inventory", "PurchaseOrderItem")

        supplier = Supplier.objects.create(user_id=user.pk, name="Legacy supplier")
        product = Product.objects.create(
            user_id=user.pk, name="Legacy product", sku="LEGACY", stock=3,
            cost_price="2.50", cost_currency=user.currency, cost_fx_rate_to_base="1.000000",
        )
        order = PurchaseOrder.objects.create(
            user_id=user.pk, supplier_id=supplier.pk, order_number="PO-LEGACY",
            status="received", currency=user.currency, fx_rate_to_base="1.000000",
        )
        PurchaseOrderItem.objects.create(
            purchase_order_id=order.pk,
            product_id=product.pk,
            quantity_ordered=5,
            quantity_received=3,
            unit_cost="2.50",
            unit_cost_base="2.50",
            line_total="12.50",
            line_total_base="12.50",
        )
        original_updated_at = order.updated_at

        new_apps = self.migrate_inventory(self.migrate_to)
        MigratedOrder = new_apps.get_model("inventory", "PurchaseOrder")
        MigratedNote = new_apps.get_model("inventory", "GoodsReceivedNote")
        MigratedNoteItem = new_apps.get_model("inventory", "GoodsReceivedNoteItem")
        MigratedCost = new_apps.get_model("inventory", "PurchaseCostHistory")

        migrated_order = MigratedOrder.objects.get(pk=order.pk)
        note = MigratedNote.objects.get(purchase_order_id=order.pk)
        line = MigratedNoteItem.objects.get(goods_received_note_id=note.pk)
        cost = MigratedCost.objects.get(goods_received_note_item_id=line.pk)
        self.assertEqual(migrated_order.status, "fully_received")
        self.assertEqual(note.status, "confirmed")
        self.assertEqual(line.quantity_delivered, 3)
        self.assertEqual(line.stock_movement_id, None)
        self.assertEqual(cost.quantity, 3)
        self.assertEqual(cost.unit_cost_base, Decimal("2.50"))
        self.assertEqual(cost.created_at, original_updated_at)

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()
