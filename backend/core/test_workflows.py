from decimal import Decimal
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from inventory.models import Product, SupplyEntry, Supplier, PurchaseOrder, PurchaseOrderItem
from sales.models import Sale
from customers.models import Customer
from accounts.models import Staff
from audits.models import Audit


class ConnectedWorkflowTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        from billing.services import sync_plan_catalog
        sync_plan_catalog(force=True)

    def setUp(self):
        self.owner = get_user_model().objects.create_user(username="owner", email="owner@example.test", password="test-only", currency="USD", enabled_currencies=["USD", "ZAR"], exchange_rates={"ZAR": "0.05"})
        from billing.services import get_or_create_subscription
        from billing.models import Plan
        subscription = get_or_create_subscription(self.owner)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.product = Product.objects.create(user=self.owner, name="Bread", sku="BREAD", stock=100, price=10, cost_price=4)
        self.customer = Customer.objects.create(user=self.owner, name="Customer")

    def sale_payload(self, **changes):
        return {"payment_method": "Cash", "customer": self.customer.id, "sale_items": [{"product": self.product.id, "quantity": 3, "unit_price": "10.00"}], **changes}

    def supply_payload(self, **changes):
        return {"requestId": "supply-1", "productId": str(self.product.id), "direction": "incoming", "paymentStatus": "paid", "partnerName": "Supplier", "partnerCategory": "supplier", "quantity": 5, "unitPrice": 10, "unitCost": 40, "currency": "ZAR", "fxRateToBase": "0.05", "movementDate": "2026-09-15", "movementTime": "12:30", **changes}

    def staff_client(self, permissions):
        staff = Staff.objects.create(user=self.owner, name="Cashier", username="cashier", role="Cashier", permissions=permissions, login_enabled=True)
        token = RefreshToken.for_user(self.owner)
        token["staff_id"] = staff.id
        token["staff_permissions"] = ["*"]  # Stale claims must not grant permissions.
        self.client.force_authenticate(user=None)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {token.access_token}")
        return staff

    def test_sale_and_reversal_restore_stock_and_customer(self):
        response = self.client.post("/api/v1/sales/", self.sale_payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        sale_id = response.data["id"]
        self.product.refresh_from_db(); self.customer.refresh_from_db()
        self.assertEqual(self.product.stock, 97)
        self.assertEqual(response.data["gross_profit"], "18.00")
        self.assertEqual(self.customer.loyalty_points, 3)
        self.assertEqual(self.client.delete(f"/api/v1/sales/{sale_id}/").status_code, 204)
        self.product.refresh_from_db(); self.customer.refresh_from_db()
        self.assertEqual(self.product.stock, 100)
        self.assertEqual(self.customer.total_spent, 0)
        self.assertEqual(self.customer.visits, 0)
        self.assertEqual(self.customer.loyalty_points, 0)
        self.assertTrue(Sale.objects.get(pk=sale_id).is_deleted)
        self.assertEqual(self.client.delete(f"/api/v1/sales/{sale_id}/").status_code, 404)

    def test_selected_currency_is_preserved_without_allocations(self):
        response = self.client.post("/api/v1/sales/", self.sale_payload(payment_currency="ZAR"), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["payment_currency"], "ZAR")
        self.assertEqual(response.data["payment_allocations"][0]["amount"], "600.00")
        self.assertEqual(response.data["total"], "30.00")

    def test_mixed_payments_and_custom_rate(self):
        allocations = [{"currency": "USD", "amount": "10"}, {"currency": "ZAR", "amount": "200", "fx_rate_to_base": "0.1"}]
        response = self.client.post("/api/v1/sales/", self.sale_payload(payment_allocations=allocations), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["payment_currency"], "MIXED")
        self.assertEqual(sum(Decimal(r["amount_base"]) for r in response.data["payment_allocations"]), Decimal("30"))

    def test_invalid_payment_rolls_back_stock_and_sale(self):
        response = self.client.post("/api/v1/sales/", self.sale_payload(payment_allocations=[{"currency": "USD", "amount": "1"}]), format="json")
        self.assertEqual(response.status_code, 400)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 100)
        self.assertFalse(Sale.objects.exists())

    def test_staff_cannot_bypass_area_permissions_through_sync(self):
        self.staff_client(["sales"])
        response = self.client.post("/api/v1/sync/push/", {"actions": [{"id": "allowed", "type": "sale", "payload": self.sale_payload()}, {"id": "denied", "type": "product_delete", "payload": {"id": self.product.id}}]}, format="json")
        self.assertEqual(response.status_code, 403, response.data)
        self.product.refresh_from_db()
        self.assertFalse(self.product.is_deleted)
        self.assertFalse(Sale.objects.exists())
        self.assertEqual(self.client.patch("/api/v1/accounts/me/", {"business_name": "Changed"}, format="json").status_code, 403)

    def test_disabled_staff_token_is_rejected(self):
        staff = self.staff_client(["sales"])
        staff.login_enabled = False; staff.save()
        self.assertEqual(self.client.get("/api/v1/sales/").status_code, 403)

    def test_authorized_offline_sale_is_applied_once(self):
        self.staff_client(["sales"])
        payload = {"actions": [{"id": "offline-sale", "type": "sale", "payload": self.sale_payload(payment_currency="ZAR")}]}
        first = self.client.post("/api/v1/sync/push/", payload, format="json")
        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data["processed"], 1, first.data)
        second = self.client.post("/api/v1/sync/push/", payload, format="json")
        self.assertEqual(second.data["processed"], 0)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 97)
        self.assertEqual(Sale.objects.get().payment_currency, "ZAR")

    def test_supply_persists_updates_stock_and_is_idempotent(self):
        response = self.client.post("/api/v1/inventory/supply-entries/", self.supply_payload(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        again = self.client.post("/api/v1/inventory/supply-entries/", self.supply_payload(), format="json")
        self.assertEqual(again.data["id"], response.data["id"])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 105)
        self.assertEqual(self.product.cost_price, Decimal("2"))
        self.assertEqual(SupplyEntry.objects.count(), 1)
        updated = self.client.patch(f"/api/v1/inventory/supply-entries/{response.data['id']}/", {"paymentStatus": "pending"}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 105)

    def test_supply_rejects_insufficient_stock_and_foreign_products(self):
        response = self.client.post("/api/v1/inventory/supply-entries/", self.supply_payload(direction="outgoing", quantity=101), format="json")
        self.assertEqual(response.status_code, 400)
        other = get_user_model().objects.create_user(username="other", email="other@example.test")
        foreign = Product.objects.create(user=other, name="Other", sku="OTHER")
        response = self.client.post("/api/v1/inventory/supply-entries/", self.supply_payload(productId=foreign.id), format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(SupplyEntry.objects.exists())

    def test_offline_supply_and_payment_update(self):
        payload = {"actions": [{"id": "supply-create", "type": "supply_create", "payload": self.supply_payload()}, {"id": "supply-update", "type": "supply_update", "payload": {"requestId": "supply-1", "paymentStatus": "pending"}}]}
        response = self.client.post("/api/v1/sync/push/", payload, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["processed"], 2, response.data)
        self.assertEqual(SupplyEntry.objects.get().payment_status, "pending")
        self.assertEqual(self.client.post("/api/v1/sync/push/", payload, format="json").data["processed"], 0)
        self.product.refresh_from_db(); self.assertEqual(self.product.stock, 105)

    def test_audit_saves_matching_counts_and_completes_once(self):
        audit = Audit.objects.create(conductor=self.owner)
        url = f"/api/v1/audits/{audit.id}/complete/"
        response = self.client.post(url, {"counts": [{"product": self.product.id, "counted_quantity": 100}]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        audit.refresh_from_db()
        self.assertEqual(audit.items_counted, 1)
        self.assertIsNotNone(audit.completed_at)
        self.assertEqual(audit.stock_counts.count(), 1)
        self.assertEqual(audit.discrepancies_found, 0)
        self.client.post(url, {"counts": [{"product": self.product.id, "counted_quantity": 0}]}, format="json")
        self.assertEqual(audit.stock_counts.get().counted_quantity, 100)

    def test_audit_discrepancy_and_offline_completion(self):
        response = self.client.post("/api/v1/sync/push/", {"actions": [{"id": "audit-create", "type": "audit_create", "payload": {"local_id": "local-audit"}}, {"id": "audit-complete", "type": "audit_complete", "payload": {"local_id": "local-audit", "counts": [{"product": self.product.id, "counted_quantity": 95}]}}]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["processed"], 2, response.data)
        audit = Audit.objects.get()
        self.assertEqual(audit.discrepancies_found, 1)
        self.assertEqual(audit.discrepancies.get().difference, -5)

    def test_empty_audit_cannot_be_marked_completed(self):
        audit = Audit.objects.create(conductor=self.owner)
        response = self.client.patch(f"/api/v1/audits/{audit.id}/", {"status": "completed"}, format="json")
        self.assertEqual(response.status_code, 400)
        audit.refresh_from_db(); self.assertEqual(audit.status, "in_progress")

    def test_purchase_order_receiving_updates_stock_once(self):
        supplier = Supplier.objects.create(user=self.owner, name="Vendor")
        order = PurchaseOrder.objects.create(user=self.owner, supplier=supplier)
        PurchaseOrderItem.objects.create(purchase_order=order, product=self.product, quantity_ordered=5, unit_cost=2, unit_cost_base=2)
        url = f"/api/v1/inventory/purchase-orders/{order.id}/receive/"
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 200)
        self.assertEqual(self.client.post(url, {}, format="json").status_code, 200)
        self.product.refresh_from_db(); self.assertEqual(self.product.stock, 105)

    def test_reversed_sales_are_excluded_from_profit_reports(self):
        response = self.client.post("/api/v1/sales/", self.sale_payload(), format="json")
        self.client.delete(f"/api/v1/sales/{response.data['id']}/")
        report = self.client.get("/api/v1/reports/profit-loss/")
        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["sales"], 0)
        self.assertEqual(report.data["gross_profit"], 0)

    def test_paid_supply_invoices_include_cost_in_profit_report(self):
        response = self.client.post("/api/v1/inventory/supply-entries/", self.supply_payload(direction="outgoing", currency="USD", fxRateToBase=1, unitPrice=10, unitCost=4), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        report = self.client.get("/api/v1/reports/profit-loss/")
        self.assertEqual(report.data["sales"], Decimal("50"))
        self.assertEqual(report.data["cost_of_goods"], Decimal("20"))
        self.assertEqual(report.data["gross_profit"], Decimal("30"))

    def test_stale_offline_stock_edit_creates_conflict(self):
        payload = {"actions": [{"id": "stale-stock", "type": "product_update", "payload": {"id": self.product.id, "stock": 110, "expected_stock": 90}}]}
        response = self.client.post("/api/v1/sync/push/", payload, format="json")
        self.assertEqual(response.data["processed"], 0)
        self.assertEqual(len(response.data["conflicts"]), 1)
        self.product.refresh_from_db(); self.assertEqual(self.product.stock, 100)

    def test_staff_can_read_feature_access_without_billing_permission(self):
        self.staff_client(["sales"])
        self.assertEqual(self.client.get("/api/v1/billing/subscriptions/features/").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/billing/subscriptions/current/").status_code, 403)

    def test_retired_assistant_and_protected_sync_conflicts(self):
        self.staff_client(["sales"])
        self.assertEqual(self.client.post("/api/v1/assistant/command/", {"command": "expenses"}, format="json").status_code, 404)
        self.assertEqual(self.client.get("/api/v1/sync/conflicts/").status_code, 403)

    def test_retry_restores_local_product_mapping(self):
        create = {"id": "local-product", "type": "product_create", "payload": {"name": "New", "sku": "NEW", "local_id": "offline-new", "stock": 5, "price": "10", "cost_price": "4"}}
        first = self.client.post("/api/v1/sync/push/", {"actions": [create]}, format="json")
        self.assertEqual(first.data["processed"], 1, first.data)
        supply = {"id": "local-supply", "type": "supply_create", "payload": self.supply_payload(productId="offline-new")}
        retry = self.client.post("/api/v1/sync/push/", {"actions": [create, supply]}, format="json")
        self.assertEqual(retry.data["processed"], 1, retry.data)
        self.assertEqual(Product.objects.get(sku="NEW").stock, 10)

    def test_offline_sale_validation_failure_does_not_leave_partial_writes(self):
        bad = self.sale_payload(sale_items=[{"product": self.product.id, "quantity": 101, "unit_price": "10"}])
        response = self.client.post("/api/v1/sync/push/", {"actions": [{"id": "oversold", "type": "sale", "payload": bad}]}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["processed"], 0)
        self.assertEqual(len(response.data["errors"]), 1)
        self.assertFalse(Sale.objects.exists())
        self.product.refresh_from_db(); self.assertEqual(self.product.stock, 100)

    def test_retired_assistant_routes_are_not_available(self):
        for route in ("command", "chat", "history", "insights", "whatsapp-summary"):
            self.assertEqual(self.client.get(f"/api/v1/assistant/{route}/").status_code, 404)
        features = self.client.get("/api/v1/billing/subscriptions/features/").data["features"]
        self.assertFalse({"ai_assistant", "command_assistant"} & {feature["key"] for feature in features})

    def test_business_summaries_remain_available_without_assistant(self):
        insights = self.client.get("/api/v1/reports/insights/")
        summary = self.client.get("/api/v1/reports/whatsapp-summary/")
        self.assertEqual(insights.status_code, 200, insights.data)
        self.assertIn("insights", insights.data)
        self.assertEqual(summary.status_code, 200, summary.data)
        self.assertIn("message", summary.data)

    def test_receipt_scanning_still_uses_the_expense_workflow(self):
        from reports.business_services import parse_receipt_ocr_text
        parsed = parse_receipt_ocr_text("Corner Shop\n2026-09-15\nTotal 25.00")
        self.assertEqual(parsed["status"], "ocr_parsed")
        self.assertEqual(parsed["parsed"]["amount"], 25.0)
        response = self.client.post("/api/v1/expenses/ocr-receipt/", {}, format="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "manual_review")
