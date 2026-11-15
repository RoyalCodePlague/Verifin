from decimal import Decimal

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.activity import log_staff_activity
from accounts.models import ApprovalSettings, Staff, StaffActivityLog
from billing.models import FeatureLimit, Plan, Subscription
from inventory.models import Branch, Product, PurchaseOrder, PurchaseOrderItem, StockMovement, Supplier
from sales.models import Sale, SaleItem


User = get_user_model()


class StaffAccountabilityTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="owner@example.com",
            email="owner@example.com",
            password="StrongPass123!",
            business_name="Audit Shop",
            is_active=True,
            email_verified=True,
        )
        plan, _ = Plan.objects.get_or_create(code=Plan.BUSINESS, defaults={"name": "Business"})
        FeatureLimit.objects.update_or_create(
            plan=plan,
            key="staff_activity_logs",
            defaults={"label": "Staff activity logs", "enabled": True},
        )
        Subscription.objects.update_or_create(user=self.user, defaults={"plan": plan})
        self.client = APIClient()

    def staff_client(self, staff):
        refresh = RefreshToken.for_user(self.user)
        refresh["staff_id"] = staff.id
        refresh["staff_role"] = staff.role
        refresh["staff_permissions"] = staff.permissions
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
        return client

    def test_activity_log_records_staff_actor_and_is_read_only(self):
        staff = Staff.objects.create(
            user=self.user,
            name="Tariro Cashier",
            role=Staff.CASHIER,
            permissions=["sales"],
            username="tariro",
            login_enabled=True,
        )
        request = APIRequestFactory().post("/api/v1/sales/", HTTP_USER_AGENT="Verifin POS/2.1")
        request.user = self.user
        request.staff_member = staff

        log = log_staff_activity(
            self.user,
            "sale_created",
            "Recorded receipt R-000001",
            actor=self.user,
            request=request,
            object_type="sale",
            object_id="1",
            metadata={"before": {"stock": 2}, "after": {"stock": 1}},
        )

        self.assertEqual(log.staff_actor, staff)
        self.assertEqual(log.actor_name, "Tariro Cashier")
        self.assertEqual(log.metadata["source"]["user_agent"], "Verifin POS/2.1")
        self.assertEqual(log.metadata["before"], {"stock": 2})

        self.client.force_authenticate(user=self.user)
        response = self.client.get("/api/v1/accounts/activity-logs/")
        self.assertEqual(response.status_code, 200)
        log_data = response.data.get("results", response.data)[0]
        self.assertEqual(log_data["staff_actor_name"], "Tariro Cashier")
        self.assertEqual(log_data["actor_name"], "Tariro Cashier")
        self.assertEqual(log_data["metadata"]["after"], {"stock": 1})

        denied = self.client.post("/api/v1/accounts/activity-logs/", {"summary": "Tampering"}, format="json")
        self.assertEqual(denied.status_code, 405)
        self.assertEqual(StaffActivityLog.objects.count(), 1)

    def test_owner_can_configure_approval_thresholds_and_change_is_audited(self):
        self.client.force_authenticate(user=self.user)
        response = self.client.patch(
            "/api/v1/accounts/approval-settings/",
            {"discount_percent_threshold": "15.00", "supplier_payment_amount_base_threshold": None},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["discount_percent_threshold"], "15.00")
        self.assertIsNone(response.data["supplier_payment_amount_base_threshold"])
        log = StaffActivityLog.objects.get(action="approval_settings_updated")
        self.assertEqual(log.metadata["after"]["discount_percent_threshold"], "15.00")

        administrator = Staff.objects.create(
            user=self.user, name="Site Administrator", role=Staff.ADMINISTRATOR,
            permissions=["settings"], username="site-administrator", login_enabled=True,
        )
        forbidden = self.staff_client(administrator).patch(
            "/api/v1/accounts/approval-settings/", {"discount_percent_threshold": "5.00"}, format="json"
        )
        self.assertEqual(forbidden.status_code, 403, forbidden.data)

    def test_cashier_area_access_does_not_allow_sale_void_without_action_permission(self):
        branch = Branch.objects.create(user=self.user, name="Central")
        product = Product.objects.create(
            user=self.user,
            branch=branch,
            name="Tea",
            sku="TEA-1",
            stock=4,
            price=Decimal("10.00"),
            cost_price=Decimal("5.00"),
        )
        sale = Sale.objects.create(
            created_by=self.user,
            branch=branch,
            total=Decimal("10.00"),
            total_cost=Decimal("5.00"),
            gross_profit=Decimal("5.00"),
        )
        SaleItem.objects.create(
            sale=sale,
            product=product,
            quantity=1,
            unit_cost=Decimal("5.00"),
            unit_price=Decimal("10.00"),
            subtotal=Decimal("10.00"),
            cost_total=Decimal("5.00"),
            profit=Decimal("5.00"),
        )
        cashier = Staff.objects.create(
            user=self.user,
            name="Tariro Cashier",
            role=Staff.CASHIER,
            branch=branch,
            permissions=["sales"],
            username="tariro",
            login_enabled=True,
        )

        response = self.staff_client(cashier).delete(f"/api/v1/sales/{sale.id}/")

        self.assertEqual(response.status_code, 403)
        sale.refresh_from_db()
        self.assertFalse(sale.is_deleted)

    def test_named_sensitive_permission_allows_authorized_sale_void(self):
        branch = Branch.objects.create(user=self.user, name="East")
        product = Product.objects.create(
            user=self.user,
            branch=branch,
            name="Coffee",
            sku="COF-1",
            stock=4,
            price=Decimal("10.00"),
            cost_price=Decimal("5.00"),
        )
        sale = Sale.objects.create(
            created_by=self.user,
            branch=branch,
            total=Decimal("10.00"),
            total_cost=Decimal("5.00"),
            gross_profit=Decimal("5.00"),
        )
        SaleItem.objects.create(
            sale=sale,
            product=product,
            quantity=1,
            unit_cost=Decimal("5.00"),
            unit_price=Decimal("10.00"),
            subtotal=Decimal("10.00"),
            cost_total=Decimal("5.00"),
            profit=Decimal("5.00"),
        )
        cashier = Staff.objects.create(
            user=self.user,
            name="Approved Cashier",
            role=Staff.CASHIER,
            branch=branch,
            permissions=["sales", "sales.void"],
            username="approved-cashier",
            login_enabled=True,
        )

        response = self.staff_client(cashier).delete(f"/api/v1/sales/{sale.id}/")

        self.assertEqual(response.status_code, 204)
        sale.refresh_from_db()
        self.assertTrue(sale.is_deleted)

    def test_large_discount_requires_configured_approver(self):
        branch = Branch.objects.create(user=self.user, name="West")
        product = Product.objects.create(
            user=self.user,
            branch=branch,
            name="Sugar",
            sku="SUG-1",
            stock=5,
            price=Decimal("10.00"),
            cost_price=Decimal("5.00"),
        )
        cashier = Staff.objects.create(
            user=self.user,
            branch=branch,
            name="Discount Cashier",
            role=Staff.CASHIER,
            permissions=["sales"],
            username="discount-cashier",
            login_enabled=True,
        )
        approval_settings, _ = ApprovalSettings.objects.get_or_create(user=self.user)
        approval_settings.discount_percent_threshold = Decimal("10.00")
        approval_settings.save(update_fields=["discount_percent_threshold", "updated_at"])
        payload = {
            "integration_id": "approval-discount-01",
            "payment_method": "Cash",
            "items": [{"product": product.id, "quantity": 1, "unit_price": "10.00", "discount_amount": "2.00"}],
        }

        blocked = self.staff_client(cashier).post("/api/v1/sales/", payload, format="json")
        self.assertEqual(blocked.status_code, 403, blocked.data)
        self.assertFalse(Sale.objects.filter(integration_id=payload["integration_id"]).exists())

        approval_settings.discount_percent_threshold = Decimal("20.00")
        approval_settings.save(update_fields=["discount_percent_threshold", "updated_at"])
        approved = self.staff_client(cashier).post("/api/v1/sales/", payload, format="json")
        self.assertEqual(approved.status_code, 201, approved.data)
        self.assertEqual(approved.data["total"], "8.00")

    def test_high_value_refund_needs_explicit_approver_permission(self):
        branch = Branch.objects.create(user=self.user, name="North")
        product = Product.objects.create(
            user=self.user,
            branch=branch,
            name="Soap",
            sku="SOAP-1",
            stock=4,
            price=Decimal("10.00"),
            cost_price=Decimal("5.00"),
        )
        sale = Sale.objects.create(
            created_by=self.user,
            branch=branch,
            total=Decimal("10.00"),
            total_cost=Decimal("5.00"),
            gross_profit=Decimal("5.00"),
        )
        sale_item = SaleItem.objects.create(
            sale=sale,
            product=product,
            quantity=1,
            unit_cost=Decimal("5.00"),
            unit_price=Decimal("10.00"),
            subtotal=Decimal("10.00"),
            cost_total=Decimal("5.00"),
            profit=Decimal("5.00"),
        )
        settings_record, _ = ApprovalSettings.objects.get_or_create(user=self.user)
        settings_record.refund_amount_base_threshold = Decimal("5.00")
        settings_record.save(update_fields=["refund_amount_base_threshold", "updated_at"])
        cashier = Staff.objects.create(
            user=self.user, branch=branch, name="Refund Cashier", role=Staff.CASHIER,
            permissions=["sales"], username="refund-cashier", login_enabled=True,
        )
        payload = {"sale_item": sale_item.id, "quantity": 1, "refund_method": "Cash"}

        blocked = self.staff_client(cashier).post(f"/api/v1/sales/{sale.id}/returns/", payload, format="json")
        self.assertEqual(blocked.status_code, 403, blocked.data)

        approver = Staff.objects.create(
            user=self.user, branch=branch, name="Refund Approver", role=Staff.CASHIER,
            permissions=["sales", "sales.refund"], username="refund-approver", login_enabled=True,
        )
        approved = self.staff_client(approver).post(f"/api/v1/sales/{sale.id}/returns/", payload, format="json")
        self.assertEqual(approved.status_code, 201, approved.data)
        self.assertEqual(approved.data["refund_amount"], "10.00")

    def test_stock_adjustment_above_threshold_requires_approver_role(self):
        branch = Branch.objects.create(user=self.user, name="South")
        product = Product.objects.create(
            user=self.user,
            branch=branch,
            name="Rice",
            sku="RICE-1",
            stock=5,
            price=Decimal("10.00"),
            cost_price=Decimal("5.00"),
        )
        settings_record, _ = ApprovalSettings.objects.get_or_create(user=self.user)
        settings_record.stock_adjustment_units_threshold = 1
        settings_record.save(update_fields=["stock_adjustment_units_threshold", "updated_at"])
        cashier = Staff.objects.create(
            user=self.user, branch=branch, name="Inventory Cashier", role=Staff.CASHIER,
            permissions=["inventory"], username="inventory-cashier", login_enabled=True,
        )

        blocked = self.staff_client(cashier).patch(
            f"/api/v1/inventory/products/{product.id}/", {"stock": 7}, format="json"
        )
        self.assertEqual(blocked.status_code, 403, blocked.data)

        stock_manager = Staff.objects.create(
            user=self.user, branch=branch, name="Stock Manager", role=Staff.STOCK_MANAGER,
            permissions=["inventory"], username="stock-manager", login_enabled=True,
        )
        approved = self.staff_client(stock_manager).patch(
            f"/api/v1/inventory/products/{product.id}/", {"stock": 7}, format="json"
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(StockMovement.objects.filter(product=product, movement_type="adjustment").count(), 1)

    def test_large_supplier_payment_requires_authorized_approver(self):
        branch = Branch.objects.create(user=self.user, name="Purchasing")
        supplier = Supplier.objects.create(user=self.user, name="Bulk supplier")
        product = Product.objects.create(
            user=self.user, branch=branch, name="Beans", sku="BEANS-1", stock=20,
            price=Decimal("20.00"), cost_price=Decimal("10.00"),
        )
        order = PurchaseOrder.objects.create(
            user=self.user, supplier=supplier, branch=branch, order_number="PO-APPROVAL-1",
            status=PurchaseOrder.STATUS_PARTIALLY_RECEIVED,
        )
        PurchaseOrderItem.objects.create(
            purchase_order=order, product=product, quantity_ordered=100, quantity_received=100,
            unit_cost=Decimal("10.00"), unit_cost_base=Decimal("10.00"),
        )
        cashier = Staff.objects.create(
            user=self.user, branch=branch, name="Payments Clerk", role=Staff.CASHIER,
            permissions=["inventory", "suppliers"], username="payments-clerk", login_enabled=True,
        )
        payload = {
            "supplier": supplier.id,
            "purchase_order": order.id,
            "amount": "700.00",
            "currency": self.user.currency,
            "payment_date": "2026-11-10",
            "method": "bank",
            "idempotency_key": "supplier-payment-approval-1",
        }

        blocked = self.staff_client(cashier).post("/api/v1/inventory/supplier-payments/", payload, format="json")
        self.assertEqual(blocked.status_code, 403, blocked.data)

        manager = Staff.objects.create(
            user=self.user, branch=branch, name="Finance Manager", role=Staff.MANAGER,
            permissions=["inventory", "suppliers"], username="finance-manager", login_enabled=True,
        )
        approved = self.staff_client(manager).post("/api/v1/inventory/supplier-payments/", payload, format="json")
        self.assertEqual(approved.status_code, 201, approved.data)
        self.assertEqual(approved.data["amount_base"], "700.00")

    def test_large_purchase_order_approval_requires_authorized_approver(self):
        branch = Branch.objects.create(user=self.user, name="Procurement")
        supplier = Supplier.objects.create(user=self.user, name="Equipment supplier")
        order = PurchaseOrder.objects.create(
            user=self.user, supplier=supplier, branch=branch, order_number="PO-APPROVAL-2",
            status=PurchaseOrder.STATUS_SUBMITTED, total_cost_base=Decimal("1200.00"),
        )
        stock_manager = Staff.objects.create(
            user=self.user, branch=branch, name="Stock Clerk", role=Staff.STOCK_MANAGER,
            permissions=["inventory", "suppliers"], username="stock-clerk", login_enabled=True,
        )

        blocked = self.staff_client(stock_manager).post(f"/api/v1/inventory/purchase-orders/{order.id}/approve/", {}, format="json")
        self.assertEqual(blocked.status_code, 403, blocked.data)

        branch_manager = Staff.objects.create(
            user=self.user, branch=branch, name="Branch Lead", role=Staff.BRANCH_MANAGER,
            permissions=["inventory", "suppliers"], username="branch-lead", login_enabled=True,
        )
        approved = self.staff_client(branch_manager).post(f"/api/v1/inventory/purchase-orders/{order.id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(approved.data["status"], PurchaseOrder.STATUS_APPROVED)
