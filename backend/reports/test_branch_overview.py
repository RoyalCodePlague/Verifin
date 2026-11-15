from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import Staff
from billing.models import Plan
from billing.services import get_or_create_subscription, sync_plan_catalog
from customers.models import Customer
from expenses.models import Expense
from inventory.models import (
    Branch,
    GoodsReceivedNote,
    GoodsReceivedNoteItem,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    Supplier,
    SupplierPayment,
)
from sales.models import Sale


class BranchOverviewTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="branch-report-owner",
            email="branch-report@example.com",
            password="Secure123!",
            currency="ZAR",
        )
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.today = timezone.localdate()
        self.branch_one = Branch.objects.create(
            user=self.user, name="Central", opening_date=self.today - timedelta(days=90),
        )
        self.branch_two = Branch.objects.create(
            user=self.user, name="New shop", opening_date=self.today - timedelta(days=10),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_consolidated_and_selected_branch_figures_include_open_days_and_financial_balances(self):
        branch_one_product = Product.objects.create(
            user=self.user, branch=self.branch_one, name="Central stock", sku="BR-CENTRAL",
            stock=4, cost_price=Decimal("5.00"), price=Decimal("8.00"),
        )
        branch_two_product = Product.objects.create(
            user=self.user, branch=self.branch_two, name="New shop stock", sku="BR-NEW",
            stock=2, cost_price=Decimal("5.00"), price=Decimal("8.00"),
        )
        self.assertIsNotNone(branch_one_product.pk)
        self.assertIsNotNone(branch_two_product.pk)

        sales = [
            Sale.objects.create(
                created_by=self.user, branch=self.branch_one, total=Decimal("200.00"),
                total_cost=Decimal("100.00"), gross_profit=Decimal("100.00"),
            ),
            Sale.objects.create(
                created_by=self.user, branch=self.branch_two, total=Decimal("50.00"),
                total_cost=Decimal("25.00"), gross_profit=Decimal("25.00"),
            ),
            Sale.objects.create(
                created_by=self.user, total=Decimal("25.00"), total_cost=Decimal("10.00"),
                gross_profit=Decimal("15.00"),
            ),
        ]
        Sale.objects.filter(pk__in=[sale.pk for sale in sales]).update(date=self.today - timedelta(days=3))
        Expense.objects.create(
            created_by=self.user, branch=self.branch_one, description="Central rent",
            amount=Decimal("20.00"), amount_base=Decimal("20.00"), date=self.today - timedelta(days=3),
        )
        Expense.objects.create(
            created_by=self.user, branch=self.branch_two, description="New shop power",
            amount=Decimal("5.00"), amount_base=Decimal("5.00"), date=self.today - timedelta(days=3),
        )
        Expense.objects.create(
            created_by=self.user, description="Business fee", amount=Decimal("2.00"),
            amount_base=Decimal("2.00"), date=self.today - timedelta(days=3),
        )
        Customer.objects.create(user=self.user, branch=self.branch_one, name="Central debtor", debt_amount=Decimal("15.00"))
        Customer.objects.create(user=self.user, branch=self.branch_two, name="New shop debtor", debt_amount=Decimal("20.00"))

        supplier = Supplier.objects.create(user=self.user, name="Mixed receipts supplier")
        order = PurchaseOrder.objects.create(
            user=self.user, supplier=supplier, branch=self.branch_two,
            order_number="PO-BR-MIXED", status=PurchaseOrder.STATUS_PARTIALLY_RECEIVED,
        )
        order_item = PurchaseOrderItem.objects.create(
            purchase_order=order, product=branch_two_product,
            quantity_ordered=8, quantity_received=6,
            unit_cost=Decimal("10.00"), unit_cost_base=Decimal("10.00"),
        )
        note = GoodsReceivedNote.objects.create(
            user=self.user, purchase_order=order, grn_number="GRN-BR-MIXED",
            status=GoodsReceivedNote.STATUS_CONFIRMED,
        )
        GoodsReceivedNoteItem.objects.create(
            goods_received_note=note, purchase_order_item=order_item,
            quantity_delivered=2, unit_cost=Decimal("15.00"),
            unit_cost_base=Decimal("15.00"), total_cost_base=Decimal("30.00"),
        )
        SupplierPayment.objects.create(
            user=self.user, supplier=supplier, purchase_order=order,
            amount=Decimal("20.00"), amount_base=Decimal("20.00"),
            currency=self.user.currency, payment_date=self.today, created_by=self.user,
        )

        consolidated = self.client.get("/api/v1/reports/branch-overview/", {"period": "this_month", "branches": "all"})

        self.assertEqual(consolidated.status_code, 200, consolidated.data)
        self.assertTrue(consolidated.data["includes_unassigned_records"])
        self.assertEqual(Decimal(str(consolidated.data["total"]["net_sales"])), Decimal("275.00"))
        self.assertEqual(Decimal(str(consolidated.data["total"]["operating_expenses"])), Decimal("27.00"))
        self.assertEqual(Decimal(str(consolidated.data["customer_outstanding"])), Decimal("35.00"))
        self.assertEqual(Decimal(str(consolidated.data["supplier_outstanding"])), Decimal("50.00"))
        self.assertEqual(Decimal(str(consolidated.data["inventory"]["cost_value"])), Decimal("30.00"))
        new_shop = next(row for row in consolidated.data["branches"] if row["id"] == self.branch_two.id)
        expected_operating_days = (self.today + timedelta(days=1) - self.branch_two.opening_date).days
        self.assertEqual(new_shop["current_operating_days"], expected_operating_days)
        self.assertFalse(new_shop["comparisons"]["sales"]["comparison_available"])
        self.assertEqual(Decimal(str(new_shop["supplier_outstanding"])), Decimal("50.00"))

        selected = self.client.get(
            "/api/v1/reports/branch-overview/",
            {"period": "this_month", "branches": str(self.branch_two.id)},
        )
        self.assertEqual(selected.status_code, 200, selected.data)
        self.assertFalse(selected.data["includes_unassigned_records"])
        self.assertEqual(selected.data["selected_branches"], [self.branch_two.id])
        self.assertEqual(Decimal(str(selected.data["total"]["net_sales"])), Decimal("50.00"))

    def test_staff_cannot_select_or_report_another_branch(self):
        Product.objects.create(user=self.user, branch=self.branch_one, name="Central stock", sku="ACCESS-CENTRAL")
        assigned_product = Product.objects.create(
            user=self.user, branch=self.branch_two, name="New shop stock", sku="ACCESS-NEW",
        )
        staff = Staff.objects.create(
            user=self.user, branch=self.branch_two, name="New shop manager",
            role=Staff.MANAGER, status=Staff.ACTIVE, login_enabled=True,
            permissions=["reports", "inventory"],
        )
        refresh = RefreshToken.for_user(self.user)
        refresh["staff_id"] = staff.pk
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")

        response = client.get(
            "/api/v1/reports/branch-overview/",
            {"period": "this_month", "branches": str(self.branch_one.id)},
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["selected_branches"], [self.branch_two.id])
        self.assertEqual([row["id"] for row in response.data["branches"]], [self.branch_two.id])
        self.assertFalse(response.data["includes_unassigned_records"])

        products = client.get("/api/v1/inventory/products/")
        self.assertEqual(products.status_code, 200, products.data)
        self.assertEqual({row["id"] for row in products.data["results"]}, {assigned_product.id})

    def test_owner_cannot_select_a_branch_from_another_business(self):
        foreign_user = get_user_model().objects.create_user(
            username="foreign-branch-owner", email="foreign-branch@example.com",
        )
        foreign_branch = Branch.objects.create(user=foreign_user, name="Private location")

        response = self.client.get(
            "/api/v1/reports/branch-overview/",
            {"period": "this_month", "branches": str(foreign_branch.id)},
        )

        self.assertEqual(response.status_code, 400, response.data)
