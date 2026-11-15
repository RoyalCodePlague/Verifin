from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Staff
from billing.models import Plan
from billing.services import get_or_create_subscription, sync_plan_catalog
from expenses.models import Expense, ExpenseBudget, ExpenseCategory, RecurringExpense
from inventory.models import Branch
from reports.models import AccountTransaction


class ExpensePlanningTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="expense-planning-owner",
            email="expense-planning@example.com",
            currency="ZAR",
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.category = ExpenseCategory.objects.create(name="Rent")

    def test_budget_actual_is_scoped_to_its_category_type_and_date_range(self):
        today = timezone.localdate()
        start = today.replace(day=1)
        end = today
        budget_response = self.client.post("/api/v1/expenses/budgets/", {
            "category": self.category.id,
            "expense_type": "operating",
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "amount_base": "100.00",
            "note": "Monthly rent allowance",
        }, format="json")
        self.assertEqual(budget_response.status_code, 201, budget_response.data)

        Expense.objects.create(
            created_by=self.user, category=self.category, description="Current rent",
            amount=Decimal("60.00"), amount_base=Decimal("60.00"), expense_type="operating",
            date=today,
        )
        Expense.objects.create(
            created_by=self.user, category=self.category, description="Prior rent",
            amount=Decimal("20.00"), amount_base=Decimal("20.00"), expense_type="operating",
            date=start - timedelta(days=1),
        )
        Expense.objects.create(
            created_by=self.user, category=self.category, description="Other rent",
            amount=Decimal("15.00"), amount_base=Decimal("15.00"), expense_type="other",
            date=today,
        )

        listed = self.client.get("/api/v1/expenses/budgets/")
        duplicate = self.client.post("/api/v1/expenses/budgets/", {
            "category": self.category.id,
            "expense_type": "operating",
            "period_start": start.isoformat(),
            "period_end": end.isoformat(),
            "amount_base": "100.00",
        }, format="json")

        self.assertEqual(listed.status_code, 200)
        budget_data = listed.data.get("results", listed.data)[0]
        self.assertEqual(Decimal(budget_data["spent_base"]), Decimal("60.00"))
        self.assertEqual(Decimal(budget_data["remaining_base"]), Decimal("40.00"))
        self.assertEqual(Decimal(budget_data["percent_used"]), Decimal("60.00"))
        self.assertEqual(duplicate.status_code, 400, duplicate.data)

    def test_recurring_generation_is_due_dated_and_idempotent(self):
        today = timezone.localdate()
        first_due = today.replace(day=1)
        schedule_response = self.client.post("/api/v1/expenses/recurring/", {
            "description": "Office rent",
            "amount": "35.00",
            "expense_type": "operating",
            "currency": "ZAR",
            "category": self.category.id,
            "frequency": "monthly",
            "first_due_date": first_due.isoformat(),
            "end_date": today.isoformat(),
        }, format="json")
        self.assertEqual(schedule_response.status_code, 201, schedule_response.data)

        first_run = self.client.post("/api/v1/expenses/recurring/generate-due/", {}, format="json")
        retry_run = self.client.post("/api/v1/expenses/recurring/generate-due/", {}, format="json")
        schedule = RecurringExpense.objects.get(pk=schedule_response.data["id"])
        occurrences = Expense.objects.filter(recurring_schedule=schedule, is_deleted=False)

        self.assertEqual(first_run.status_code, 200, first_run.data)
        self.assertEqual(first_run.data["created_count"], 1)
        self.assertEqual(retry_run.status_code, 200, retry_run.data)
        self.assertEqual(retry_run.data["created_count"], 0)
        self.assertEqual(occurrences.count(), 1)
        occurrence = occurrences.get()
        self.assertEqual(occurrence.date, first_due)
        self.assertEqual(occurrence.recurrence_date, first_due)
        self.assertEqual(occurrence.amount_base, Decimal("35.00"))
        self.assertFalse(schedule.is_active)

    def test_budget_and_recurring_records_are_business_scoped(self):
        other = get_user_model().objects.create_user(
            username="other-expense-owner", email="other-expense@example.com", currency="ZAR",
        )
        response = self.client.post("/api/v1/expenses/budgets/", {
            "period_start": timezone.localdate().isoformat(),
            "period_end": timezone.localdate().isoformat(),
            "amount_base": "10.00",
        }, format="json")
        budget = ExpenseBudget.objects.get(pk=response.data["id"])
        schedule = RecurringExpense.objects.create(
            user=other, created_by=other, description="Other rent", amount=Decimal("10.00"),
            currency="ZAR", fx_rate_to_base=Decimal("1"), amount_base=Decimal("10.00"),
            frequency="weekly", first_due_date=timezone.localdate(), next_due_date=timezone.localdate(),
        )

        budgets = self.client.get(f"/api/v1/expenses/budgets/{budget.id}/")
        schedules = self.client.get("/api/v1/expenses/recurring/")
        foreign_schedule = self.client.get(f"/api/v1/expenses/recurring/{schedule.id}/")

        self.assertEqual(budgets.status_code, 200)
        self.assertEqual(schedules.status_code, 200)
        self.assertEqual(schedules.data.get("results", schedules.data), [])
        self.assertEqual(foreign_schedule.status_code, 404)

    def test_removing_a_schedule_preserves_its_generated_occurrence_history(self):
        today = timezone.localdate()
        schedule = RecurringExpense.objects.create(
            user=self.user,
            created_by=self.user,
            description="Internet",
            amount=Decimal("20.00"),
            currency="ZAR",
            fx_rate_to_base=Decimal("1"),
            amount_base=Decimal("20.00"),
            frequency="monthly",
            first_due_date=today,
            next_due_date=today,
        )
        expense = Expense.objects.create(
            created_by=self.user,
            description="Internet",
            amount=Decimal("20.00"),
            amount_base=Decimal("20.00"),
            date=today,
            recurring_schedule=schedule,
            recurrence_date=today,
        )

        removed = self.client.delete(f"/api/v1/expenses/recurring/{schedule.id}/")

        schedule.refresh_from_db()
        expense.refresh_from_db()
        self.assertEqual(removed.status_code, 204)
        self.assertTrue(schedule.is_deleted)
        self.assertFalse(schedule.is_active)
        self.assertEqual(expense.recurring_schedule_id, schedule.id)


class ExpenseApprovalTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        sync_plan_catalog(force=True)

    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="expense-approval-owner",
            email="expense-approval@example.com",
            currency="ZAR",
        )
        subscription = get_or_create_subscription(self.user)
        subscription.plan = Plan.objects.get(code="business")
        subscription.status = "active"
        subscription.save()
        self.branch = Branch.objects.create(user=self.user, name="Approval branch")
        self.staff = Staff.objects.create(
            user=self.user,
            branch=self.branch,
            name="Expense clerk",
            role=Staff.MANAGER,
            status=Staff.ACTIVE,
            login_enabled=True,
            permissions=["expenses"],
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.today = timezone.localdate().isoformat()
        account = self.client.post("/api/v1/reports/accounts/", {
            "name": "Petty cash",
            "account_type": "cash",
            "currency": "ZAR",
            "opening_balance": "100.00",
            "opening_date": self.today,
        }, format="json")
        self.assertEqual(account.status_code, 201, account.data)
        self.account_id = account.data["id"]

    def create_staff_expense(self, amount="10.00"):
        with patch("expenses.serializers.get_staff_member", return_value=self.staff):
            return self.client.post("/api/v1/expenses/", {
                "description": "Branch supplies",
                "amount": amount,
                "currency": "ZAR",
                "date": self.today,
                "branch": self.branch.id,
                "payment_allocations": [{
                    "currency": "ZAR",
                    "amount": amount,
                    "account": self.account_id,
                }],
            }, format="json")

    def test_staff_expense_waits_for_owner_and_approval_posts_once(self):
        created = self.create_staff_expense()
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["approval_status"], "pending")
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 0)

        with patch("expenses.views.get_staff_member", return_value=self.staff):
            denied = self.client.post(f"/api/v1/expenses/{created.data['id']}/approve/", {}, format="json")
        self.assertEqual(denied.status_code, 403)

        approved = self.client.post(f"/api/v1/expenses/{created.data['id']}/approve/", {"note": "Receipt checked"}, format="json")
        replay = self.client.post(f"/api/v1/expenses/{created.data['id']}/approve/", {}, format="json")
        self.assertEqual(approved.status_code, 200, approved.data)
        self.assertEqual(approved.data["approval_status"], "approved")
        self.assertEqual(approved.data["approval_note"], "Receipt checked")
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(AccountTransaction.objects.filter(user=self.user, entry_type="expense_payment").count(), 1)
        report = self.client.get("/api/v1/reports/profit-loss/", {"period": "today"})
        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["current"]["operating_expenses"], Decimal("10.00"))

    def test_rejected_expense_is_excluded_from_profit_loss_and_account_ledger(self):
        created = self.create_staff_expense("12.00")
        self.assertEqual(created.status_code, 201, created.data)

        rejected = self.client.post(f"/api/v1/expenses/{created.data['id']}/reject/", {"note": "Missing receipt"}, format="json")
        self.assertEqual(rejected.status_code, 200, rejected.data)
        self.assertEqual(rejected.data["approval_status"], "rejected")
        self.assertEqual(AccountTransaction.objects.filter(user=self.user).count(), 0)
        report = self.client.get("/api/v1/reports/profit-loss/", {"period": "today"})
        self.assertEqual(report.status_code, 200, report.data)
        self.assertEqual(report.data["current"]["operating_expenses"], Decimal("0.00"))

    def test_expense_analysis_groups_by_subcategory_employee_and_branch(self):
        today = timezone.localdate()
        category = ExpenseCategory.objects.create(name="Office costs")
        subcategory = ExpenseCategory.objects.create(name="Stationery", parent=category)
        previous = today.replace(day=1) - timedelta(days=1)
        Expense.objects.create(
            created_by=self.user, created_by_staff=self.staff, branch=self.branch,
            category=subcategory, description="Last month", amount=Decimal("5.00"),
            amount_base=Decimal("5.00"), date=previous,
        )
        Expense.objects.create(
            created_by=self.user, created_by_staff=self.staff, branch=self.branch,
            category=subcategory, description="Approved supplies", amount=Decimal("25.00"),
            amount_base=Decimal("25.00"), date=today,
        )
        Expense.objects.create(
            created_by=self.user, created_by_staff=self.staff, branch=self.branch,
            category=subcategory, description="Awaiting review", amount=Decimal("90.00"),
            amount_base=Decimal("90.00"), date=today, approval_status="pending",
        )

        response = self.client.get("/api/v1/reports/expense-analysis/", {
            "start_date": today.replace(day=1).isoformat(),
            "end_date": today.isoformat(),
            "branch": self.branch.id,
        })

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["total_expenses"], Decimal("25.00"))
        self.assertEqual(response.data["comparison"]["previous_total"], Decimal("5.00"))
        self.assertEqual(response.data["comparison"]["change"], Decimal("20.00"))
        self.assertEqual(response.data["by_category"][0]["category"], "Office costs / Stationery")
        self.assertEqual(response.data["by_employee"][0]["employee"], "Expense clerk")
        self.assertEqual(response.data["by_branch"][0]["branch"], "Approval branch")

    def test_expense_categories_support_subcategories_and_limit_depth(self):
        parent = self.client.post("/api/v1/expenses/categories/", {"name": "Travel"}, format="json")
        child = self.client.post("/api/v1/expenses/categories/", {"name": "Fuel", "parent": parent.data["id"]}, format="json")
        invalid_grandchild = self.client.post("/api/v1/expenses/categories/", {"name": "Parking", "parent": child.data["id"]}, format="json")

        self.assertEqual(parent.status_code, 201, parent.data)
        self.assertEqual(child.status_code, 201, child.data)
        self.assertEqual(child.data["parent_name"], "Travel")
        self.assertEqual(invalid_grandchild.status_code, 400, invalid_grandchild.data)
