from django.contrib.auth import get_user_model
from django.test import TestCase

from inventory.models import PurchaseOrder, Supplier


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
