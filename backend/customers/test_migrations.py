from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone


class CustomerReceivableMigrationTests(TransactionTestCase):
    reset_sequences = True
    migrate_from = [
        ("customers", "0007_credittransaction_payment_allocations"),
        ("sales", "0010_tillsession_opened_by_staff_tillsession_review_note_and_more"),
    ]
    migrate_to = [
        ("customers", "0008_credittransaction_due_date_credittransaction_sale_and_more"),
        ("sales", "0010_tillsession_opened_by_staff_tillsession_review_note_and_more"),
    ]

    def migrate_customers(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate(target)
        return executor.loader.project_state(target).apps

    def test_existing_sale_debt_is_linked_and_manual_balance_is_carried_forward(self):
        old_apps = self.migrate_customers(self.migrate_from)
        User = get_user_model()
        user = User.objects.create_user(
            username="legacy-debtor",
            email="legacy-debtor@example.test",
        )
        Customer = old_apps.get_model("customers", "Customer")
        CreditTransaction = old_apps.get_model("customers", "CreditTransaction")
        Sale = old_apps.get_model("sales", "Sale")
        due_date = timezone.localdate() - timedelta(days=3)
        customer = Customer.objects.create(
            user_id=user.pk,
            name="Legacy debtor",
            debt_amount=Decimal("150.00"),
            debt_due_date=due_date,
        )
        sale = Sale.objects.create(
            created_by_id=user.pk,
            customer_id=customer.pk,
            total=Decimal("100.00"),
            amount_paid_base=Decimal("0.00"),
            balance_due=Decimal("100.00"),
            due_date=due_date,
        )
        CreditTransaction.objects.create(
            customer_id=customer.pk,
            amount=Decimal("100.00"),
            type="debt",
            reason="Credit sale INV-LEGACY",
            idempotency_key=f"sale:{sale.pk}:debt",
        )
        CreditTransaction.objects.create(
            customer_id=customer.pk,
            amount=Decimal("50.00"),
            type="debt",
            reason="Manual tab",
        )

        new_apps = self.migrate_customers(self.migrate_to)
        NewCreditTransaction = new_apps.get_model("customers", "CreditTransaction")
        NewSale = new_apps.get_model("sales", "Sale")
        invoice_debt = NewCreditTransaction.objects.get(idempotency_key=f"sale:{sale.pk}:debt")
        manual_debt = NewCreditTransaction.objects.get(reason="Manual tab")

        self.assertEqual(invoice_debt.sale_id, sale.pk)
        self.assertEqual(invoice_debt.due_date, due_date)
        self.assertEqual(invoice_debt.settled_amount, Decimal("0.00"))
        self.assertIsNone(manual_debt.sale_id)
        self.assertEqual(manual_debt.settled_amount, Decimal("0.00"))
        self.assertEqual(NewSale.objects.get(pk=sale.pk).balance_due, Decimal("100.00"))

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()
