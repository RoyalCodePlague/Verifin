from decimal import Decimal
from datetime import date

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient
from django.utils import timezone

from expenses.models import Expense
from inventory.models import PurchaseOrder, Supplier, SupplierPayment
from sales.models import Sale
from reports.models import BankAccount, BankStatementLine


class BankReconciliationTests(TestCase):
    def setUp(self):
        user_model = get_user_model()
        self.user = user_model.objects.create_user(username="bank-owner", email="bank@example.com")
        self.other_user = user_model.objects.create_user(username="other-bank-owner", email="other-bank@example.com")
        self.account = BankAccount.objects.create(user=self.user, name="Main account", currency="ZAR")
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_csv_import_skips_duplicate_statement_lines(self):
        csv_file = SimpleUploadedFile(
            "statement.csv",
            b"date,description,amount,reference\n2025-03-10,Customer EFT,125.5,REF-1\n2025-03-10,Customer EFT,125.50,REF-1\n",
            content_type="text/csv",
        )

        response = self.client.post(
            f"/api/v1/reports/bank-accounts/{self.account.id}/import-statement/",
            {"file": csv_file},
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data, {"created": 1, "skipped": 1})
        self.assertEqual(BankStatementLine.objects.filter(account=self.account).count(), 1)

    def test_csv_import_rejects_ambiguous_decimal_comma_without_partial_import(self):
        csv_file = SimpleUploadedFile(
            "statement.csv",
            b'date,description,amount\n2025-03-10,Valid deposit,25.00\n2025-03-10,"Ambiguous amount","1,23"\n',
            content_type="text/csv",
        )

        response = self.client.post(
            f"/api/v1/reports/bank-accounts/{self.account.id}/import-statement/",
            {"file": csv_file},
            format="multipart",
        )

        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(BankStatementLine.objects.filter(account=self.account).count(), 0)

    def test_statement_line_matches_exact_tenant_sale_amount_and_currency(self):
        sale = Sale.objects.create(
            created_by=self.user,
            total=Decimal("125.50"),
            payment_method="EFT",
            payment_currency="MIXED",
            payment_allocations=[{
                "currency": "ZAR",
                "amount": "125.50",
                "amount_base": "125.50",
                "fx_rate_to_base": "1.000000",
            }],
        )
        line = BankStatementLine.objects.create(
            account=self.account,
            transaction_date=sale.date,
            description="Customer EFT",
            amount=Decimal("125.50"),
        )

        response = self.client.post(
            f"/api/v1/reports/bank-statement-lines/{line.id}/match/",
            {"transaction_type": "sale", "transaction_id": sale.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        line.refresh_from_db()
        self.assertEqual(line.matched_sale_id, sale.id)
        self.assertIsNotNone(line.matched_at)

    def test_cannot_match_another_accounts_sale(self):
        sale = Sale.objects.create(
            created_by=self.other_user,
            total=Decimal("125.50"),
            payment_method="EFT",
            payment_allocations=[{"currency": "ZAR", "amount": "125.50"}],
        )
        line = BankStatementLine.objects.create(
            account=self.account,
            transaction_date=sale.date,
            description="Customer EFT",
            amount=Decimal("125.50"),
        )

        response = self.client.post(
            f"/api/v1/reports/bank-statement-lines/{line.id}/match/",
            {"transaction_type": "sale", "transaction_id": sale.id},
            format="json",
        )

        self.assertEqual(response.status_code, 400, response.data)
        line.refresh_from_db()
        self.assertIsNone(line.matched_at)

    def test_negative_statement_line_matches_expense(self):
        transaction_date = timezone.localdate()
        expense = Expense.objects.create(
            created_by=self.user,
            description="Internet",
            amount=Decimal("45.00"),
            amount_base=Decimal("45.00"),
            currency="ZAR",
            date=transaction_date,
            payment_allocations=[{"currency": "ZAR", "amount": "45.00"}],
        )
        line = BankStatementLine.objects.create(
            account=self.account,
            transaction_date=expense.date,
            description="Internet payment",
            amount=Decimal("-45.00"),
        )

        response = self.client.post(
            f"/api/v1/reports/bank-statement-lines/{line.id}/match/",
            {"transaction_type": "expense", "transaction_id": expense.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        line.refresh_from_db()
        self.assertEqual(line.matched_expense_id, expense.id)

    def test_negative_statement_line_matches_bank_supplier_payment(self):
        transaction_date = timezone.localdate()
        supplier = Supplier.objects.create(user=self.user, name="Supplier")
        order = PurchaseOrder.objects.create(user=self.user, supplier=supplier, order_number="PO-BANK")
        payment = SupplierPayment.objects.create(
            user=self.user,
            supplier=supplier,
            purchase_order=order,
            amount=Decimal("75.00"),
            currency="ZAR",
            amount_base=Decimal("75.00"),
            payment_date=transaction_date,
            method="bank",
            created_by=self.user,
        )
        line = BankStatementLine.objects.create(
            account=self.account,
            transaction_date=payment.payment_date,
            description="Supplier payment",
            amount=Decimal("-75.00"),
        )

        response = self.client.post(
            f"/api/v1/reports/bank-statement-lines/{line.id}/match/",
            {"transaction_type": "supplier_payment", "transaction_id": payment.id},
            format="json",
        )

        self.assertEqual(response.status_code, 200, response.data)
        line.refresh_from_db()
        self.assertEqual(line.matched_supplier_payment_id, payment.id)

    def test_account_balance_includes_imported_lines_and_only_shows_owner_data(self):
        transaction_date = timezone.localdate()
        BankStatementLine.objects.create(
            account=self.account,
            transaction_date=transaction_date,
            description="Deposit",
            amount=Decimal("100.00"),
        )
        other_account = BankAccount.objects.create(user=self.other_user, name="Other account", currency="ZAR")
        BankStatementLine.objects.create(
            account=other_account,
            transaction_date=date(2025, 3, 10),
            description="Private deposit",
            amount=Decimal("999.00"),
        )

        response = self.client.get("/api/v1/reports/cash-flow/")

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["accounts"], [{
            "id": self.account.id,
            "name": self.account.name,
            "currency": self.account.currency,
            "balance": "100.00",
            "unreconciled_count": 1,
        }])
        self.assertNotIn(other_account.id, [account["id"] for account in response.data["accounts"]])
        self.assertEqual(response.data["monthly"], [{
            "account_id": self.account.id,
            "account_name": self.account.name,
            "currency": self.account.currency,
            "month": transaction_date.replace(day=1).isoformat(),
            "inflows": "100.00",
            "outflows": "0.00",
            "net": "100.00",
        }])
