from decimal import Decimal
from types import SimpleNamespace

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import ApprovalRequest, ApprovalSettings, Staff
from accounts.branch_access import require_staff_operation
from billing.models import FeatureLimit, Plan, Subscription
from inventory.models import Branch, Product
from sales.models import Sale, SaleItem
from rest_framework.exceptions import PermissionDenied


User = get_user_model()


class ApprovalRequestWorkflowTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="approval-owner@example.com",
            email="approval-owner@example.com",
            password="StrongPass123!",
            business_name="Approval Shop",
            is_active=True,
            email_verified=True,
        )
        self.branch = Branch.objects.create(user=self.user, name="Central")
        business_plan, _ = Plan.objects.get_or_create(code=Plan.BUSINESS, defaults={"name": "Business"})
        FeatureLimit.objects.update_or_create(
            plan=business_plan,
            key="multi_branch",
            defaults={"label": "Multi-branch controls", "enabled": True},
        )
        Subscription.objects.update_or_create(user=self.user, defaults={"plan": business_plan})
        self.product = Product.objects.create(
            user=self.user,
            branch=self.branch,
            name="Tea",
            sku="APP-TEA",
            stock=4,
            price=Decimal("10.00"),
            cost_price=Decimal("5.00"),
        )
        self.requester = Staff.objects.create(
            user=self.user,
            branch=self.branch,
            name="Till Cashier",
            role=Staff.CASHIER,
            permissions=["sales"],
            username="approval-cashier",
            login_enabled=True,
        )

    def staff_client(self, staff):
        refresh = RefreshToken.for_user(self.user)
        refresh["staff_id"] = staff.id
        refresh["staff_role"] = staff.role
        refresh["staff_permissions"] = staff.permissions
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
        return client

    def make_sale(self):
        sale = Sale.objects.create(
            created_by=self.user,
            branch=self.branch,
            total=Decimal("10.00"),
            total_cost=Decimal("5.00"),
            gross_profit=Decimal("5.00"),
        )
        SaleItem.objects.create(
            sale=sale,
            product=self.product,
            quantity=1,
            unit_cost=Decimal("5.00"),
            unit_price=Decimal("10.00"),
            subtotal=Decimal("10.00"),
            cost_total=Decimal("5.00"),
            profit=Decimal("5.00"),
        )
        return sale

    def test_atomic_denial_persists_request_owner_approves_and_exact_retry_consumes(self):
        sale = self.make_sale()
        void_url = f"/api/v1/sales/{sale.id}/"

        blocked = self.staff_client(self.requester).delete(void_url)

        self.assertEqual(blocked.status_code, 403, blocked.data)
        approval = ApprovalRequest.objects.get()
        self.assertIn(f"#{approval.id}", blocked.data["detail"])
        self.assertEqual(approval.status, ApprovalRequest.STATUS_PENDING)
        self.assertEqual(approval.payload["request"]["path"], void_url)
        self.assertEqual(approval.payload["request"]["method"], "DELETE")
        sale.refresh_from_db()
        self.assertFalse(sale.is_deleted)

        own_decision = self.staff_client(self.requester).post(
            f"/api/v1/accounts/approval-requests/{approval.id}/approve/", {}, format="json"
        )
        self.assertEqual(own_decision.status_code, 403, own_decision.data)

        owner_client = APIClient()
        owner_client.force_authenticate(user=self.user)
        inbox = owner_client.get("/api/v1/accounts/approval-requests/?status=pending")
        self.assertEqual(inbox.status_code, 200, inbox.data)
        self.assertEqual(inbox.data["results"][0]["requested_by_staff"], self.requester.id)
        decided = owner_client.post(
            f"/api/v1/accounts/approval-requests/{approval.id}/approve/",
            {"decision_note": "Reviewed receipt"},
            format="json",
        )
        self.assertEqual(decided.status_code, 200, decided.data)
        self.assertEqual(decided.data["status"], ApprovalRequest.STATUS_APPROVED)

        replayed = self.staff_client(self.requester).delete(void_url)
        self.assertEqual(replayed.status_code, 204, replayed.data)
        approval.refresh_from_db()
        sale.refresh_from_db()
        self.assertEqual(approval.status, ApprovalRequest.STATUS_CONSUMED)
        self.assertTrue(sale.is_deleted)

    def test_approval_is_bound_to_resource_path_and_cannot_be_replayed_on_another_sale(self):
        first_sale = self.make_sale()
        second_sale = self.make_sale()
        first_url = f"/api/v1/sales/{first_sale.id}/"
        second_url = f"/api/v1/sales/{second_sale.id}/"
        requester = self.staff_client(self.requester)

        blocked = requester.delete(first_url)
        self.assertEqual(blocked.status_code, 403, blocked.data)
        approval = ApprovalRequest.objects.get()
        owner = APIClient()
        owner.force_authenticate(user=self.user)
        approved = owner.post(f"/api/v1/accounts/approval-requests/{approval.id}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)

        different_target = requester.delete(second_url)
        self.assertEqual(different_target.status_code, 403, different_target.data)
        self.assertEqual(ApprovalRequest.objects.filter(status=ApprovalRequest.STATUS_PENDING).count(), 1)

        exact_target = requester.delete(first_url)
        self.assertEqual(exact_target.status_code, 204, exact_target.data)
        first_sale.refresh_from_db()
        second_sale.refresh_from_db()
        self.assertTrue(first_sale.is_deleted)
        self.assertFalse(second_sale.is_deleted)

    def test_branch_reviewers_can_only_decide_requests_from_their_branch(self):
        sale = self.make_sale()
        self.staff_client(self.requester).delete(f"/api/v1/sales/{sale.id}/")
        approval = ApprovalRequest.objects.get()
        other_branch = Branch.objects.create(user=self.user, name="North")
        other_manager = Staff.objects.create(
            user=self.user,
            branch=other_branch,
            name="Other Branch Manager",
            role=Staff.MANAGER,
            permissions=["dashboard"],
            username="other-branch-manager",
            login_enabled=True,
        )

        hidden = self.staff_client(other_manager).get("/api/v1/accounts/approval-requests/")
        self.assertEqual(hidden.status_code, 200, hidden.data)
        self.assertEqual(hidden.data["results"], [])
        denied = self.staff_client(other_manager).post(
            f"/api/v1/accounts/approval-requests/{approval.id}/approve/", {}, format="json"
        )
        self.assertEqual(denied.status_code, 404, denied.data)

        same_branch_manager = Staff.objects.create(
            user=self.user,
            branch=self.branch,
            name="Central Manager",
            role=Staff.MANAGER,
            permissions=["dashboard"],
            username="central-manager",
            login_enabled=True,
        )
        approved = self.staff_client(same_branch_manager).post(
            f"/api/v1/accounts/approval-requests/{approval.id}/approve/", {}, format="json"
        )
        self.assertEqual(approved.status_code, 200, approved.data)

    def test_changed_payload_needs_a_separate_approval(self):
        settings_record, _ = ApprovalSettings.objects.get_or_create(user=self.user)
        settings_record.discount_percent_threshold = Decimal("10.00")
        settings_record.save(update_fields=["discount_percent_threshold", "updated_at"])
        payload = {
            "integration_id": "exact-payload-approval",
            "payment_method": "Cash",
            "items": [{"product": self.product.id, "quantity": 1, "unit_price": "10.00", "discount_amount": "2.00"}],
        }
        requester = self.staff_client(self.requester)
        blocked = requester.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(blocked.status_code, 403, blocked.data)
        self.assertEqual(ApprovalRequest.objects.count(), 1, blocked.data)
        first_approval = ApprovalRequest.objects.get()
        owner = APIClient()
        owner.force_authenticate(user=self.user)
        approved = owner.post(
            f"/api/v1/accounts/approval-requests/{first_approval.id}/approve/", {}, format="json"
        )
        self.assertEqual(approved.status_code, 200, approved.data)

        changed_payload = {
            **payload,
            "items": [{"product": self.product.id, "quantity": 1, "unit_price": "10.00", "discount_amount": "3.00"}],
        }
        changed = requester.post("/api/v1/sales/", changed_payload, format="json")
        self.assertEqual(changed.status_code, 403, changed.data)
        self.assertEqual(ApprovalRequest.objects.filter(status=ApprovalRequest.STATUS_PENDING).count(), 1)
        self.assertFalse(Sale.objects.filter(integration_id=payload["integration_id"]).exists())

        exact_retry = requester.post("/api/v1/sales/", payload, format="json")
        self.assertEqual(exact_retry.status_code, 201, exact_retry.data)
        first_approval.refresh_from_db()
        self.assertEqual(first_approval.status, ApprovalRequest.STATUS_CONSUMED)


class ApprovalApiKeyRestrictionsTests(TestCase):
    def test_api_keys_cannot_execute_high_value_or_financial_approval_operations(self):
        request = SimpleNamespace(api_key=object())
        blocked_actions = {
            "financial.adjust", "inventory.adjust", "purchasing.approve", "suppliers.pay",
            "till.review", "sales.discount_approve",
        }
        for action_name in blocked_actions:
            with self.subTest(action=action_name), self.assertRaises(PermissionDenied):
                require_staff_operation(request, action_name)
