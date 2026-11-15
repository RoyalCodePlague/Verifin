import uuid

from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from accounts.activity import log_staff_activity
from accounts.branch_access import get_staff_member, scope_queryset_to_staff_branch
from billing.services import enforce_feature
from reports.business_services import ReceiptScanError, scan_receipt_image
from .financial_services import generate_due_expenses
from .models import Expense, ExpenseBudget, ExpenseCategory, OtherIncome, RecurringExpense
from .serializers import (
    ExpenseBudgetSerializer,
    ExpenseCategorySerializer,
    ExpenseSerializer,
    OtherIncomeSerializer,
    RecurringExpenseSerializer,
)


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    serializer_class = ExpenseCategorySerializer

    def get_queryset(self):
        return ExpenseCategory.objects.filter(is_deleted=False).select_related("parent")

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted", "updated_at"])


class ExpenseBudgetViewSet(viewsets.ModelViewSet):
    serializer_class = ExpenseBudgetSerializer
    filterset_fields = ["branch", "category", "expense_type", "period_start", "period_end"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        queryset = ExpenseBudget.objects.filter(user=self.request.user, is_deleted=False).select_related(
            "branch", "category__parent", "user"
        )
        return scope_queryset_to_staff_branch(self.request, queryset)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user, created_by=self.request.user)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted", "updated_at"])


class RecurringExpenseViewSet(viewsets.ModelViewSet):
    serializer_class = RecurringExpenseSerializer
    filterset_fields = ["branch", "category", "frequency", "is_active"]
    search_fields = ["description"]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        queryset = RecurringExpense.objects.filter(user=self.request.user, is_deleted=False).select_related(
            "branch", "category__parent"
        )
        return scope_queryset_to_staff_branch(self.request, queryset)

    def perform_create(self, serializer):
        first_due_date = serializer.validated_data["first_due_date"]
        serializer.save(
            user=self.request.user,
            created_by=self.request.user,
            next_due_date=first_due_date,
        )

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.is_deleted = True
        instance.save(update_fields=["is_active", "is_deleted", "updated_at"])

    @action(detail=False, methods=["post"], url_path="generate-due")
    def generate_due(self, request):
        return Response(generate_due_expenses(user=request.user))



class ExpenseViewSet(viewsets.ModelViewSet):
    serializer_class = ExpenseSerializer
    filterset_fields = ["category", "date"]
    search_fields = ["description"]

    def get_queryset(self):
        queryset = Expense.objects.filter(created_by=self.request.user, is_deleted=False).select_related(
            "category__parent", "branch", "created_by_staff", "reviewed_by"
        )
        return scope_queryset_to_staff_branch(self.request, queryset)

    @transaction.atomic
    def perform_create(self, serializer):
        expense = serializer.save(
            created_by=self.request.user,
            created_by_staff=get_staff_member(self.request),
        )
        from core.analytics import record_activation_event
        record_activation_event(self.request.user, "first_expense_recorded")
        from accounts.webhooks import enqueue_webhook_event
        enqueue_webhook_event(self.request.user, "expense.created", {
            "expense_id": expense.id,
            "description": expense.description,
            "amount": str(expense.amount),
            "currency": expense.currency,
            "date": expense.date.isoformat(),
        })
        log_staff_activity(
            self.request.user, "expense_created", f"Recorded expense {expense.description}",
            actor=self.request.user, request=self.request, object_type="expense", object_id=expense.id,
            metadata={"after": {
                "amount": str(expense.amount), "amount_base": str(expense.amount_base),
                "date": expense.date.isoformat(), "branch_id": expense.branch_id,
                "approval_status": expense.approval_status, "category_id": expense.category_id,
            }},
        )

    @transaction.atomic
    def perform_update(self, serializer):
        from reports.financial_services import post_allocations_to_accounts, reverse_source_account_postings

        expense = Expense.objects.select_for_update().get(pk=serializer.instance.pk, created_by=self.request.user)
        before = {
            "description": expense.description, "amount": str(expense.amount),
            "amount_base": str(expense.amount_base), "date": expense.date.isoformat(),
            "branch_id": expense.branch_id, "category_id": expense.category_id,
            "approval_status": expense.approval_status,
        }
        if get_staff_member(self.request) and expense.approval_status != "pending":
            raise PermissionDenied("Staff can only edit expenses awaiting approval.")
        if expense.account_posting_key:
            reverse_source_account_postings(
                user=self.request.user,
                source_key=expense.account_posting_key,
                reversal_key=f"expense:{expense.pk}:edit:{uuid.uuid4().hex[:12]}",
                transaction_date=timezone.localdate(),
                reason="Expense updated",
                created_by=self.request.user,
            )
        expense = serializer.save()
        from reports.automation_engine import automation_requires_expense_approval, queue_automation_event
        if expense.approval_status == "approved" and automation_requires_expense_approval(self.request.user, expense.amount_base):
            expense.approval_status = "pending"
            expense.reviewed_by = None
            expense.reviewed_at = None
            expense.approval_note = ""
            expense.save(update_fields=["approval_status", "reviewed_by", "reviewed_at", "approval_note", "updated_at"])
        after = {
            "description": expense.description, "amount": str(expense.amount),
            "amount_base": str(expense.amount_base), "date": expense.date.isoformat(),
            "branch_id": expense.branch_id, "category_id": expense.category_id,
            "approval_status": expense.approval_status,
        }
        log_staff_activity(
            self.request.user, "expense_updated", f"Updated expense {expense.description}",
            actor=self.request.user, request=self.request, object_type="expense", object_id=expense.id,
            metadata={"before": before, "after": after},
        )
        if expense.approval_status != "approved":
            queue_automation_event(
                self.request.user, "expense_exceeds_limit",
                f"expense:{expense.pk}:update:{expense.updated_at.isoformat()}", "expense", expense.pk,
                {"amount_base": str(expense.amount_base)},
            )
            return
        source_key = f"expense:{expense.pk}:revision:{uuid.uuid4().hex[:12]}"
        post_allocations_to_accounts(
            user=self.request.user,
            allocations=expense.payment_allocations,
            direction="out",
            entry_type="expense_payment",
            transaction_date=expense.date,
            description=f"Expense: {expense.description}",
            source_key=source_key,
            created_by=self.request.user,
        )
        expense.account_posting_key = source_key
        expense.save(update_fields=["account_posting_key", "updated_at"])

    @transaction.atomic
    def perform_destroy(self, instance):
        from reports.financial_services import reverse_source_account_postings

        expense = Expense.objects.select_for_update().get(pk=instance.pk, created_by=self.request.user)
        if get_staff_member(self.request) and expense.approval_status != "pending":
            raise PermissionDenied("Staff can only delete expenses awaiting approval.")
        if expense.account_posting_key:
            reverse_source_account_postings(
                user=self.request.user,
                source_key=expense.account_posting_key,
                reversal_key=f"expense:{expense.pk}:delete",
                transaction_date=timezone.localdate(),
                reason="Expense deleted",
                created_by=self.request.user,
            )
        expense.is_deleted = True
        expense.save(update_fields=["is_deleted", "updated_at"])
        log_staff_activity(
            self.request.user, "expense_deleted", f"Deleted expense {expense.description}",
            actor=self.request.user, request=self.request, object_type="expense", object_id=expense.id,
            metadata={"before": {"description": expense.description, "amount_base": str(expense.amount_base),
                                  "approval_status": expense.approval_status}, "after": {"is_deleted": True}},
        )

    @action(detail=True, methods=["post"], url_path="approve")
    @transaction.atomic
    def approve(self, request, pk=None):
        if get_staff_member(request):
            raise PermissionDenied("Only the business owner can approve expenses.")
        expense = Expense.objects.select_for_update().get(
            pk=self.get_object().pk, created_by=request.user, is_deleted=False
        )
        if expense.approval_status == "approved":
            return Response(ExpenseSerializer(expense, context={"request": request}).data)
        if expense.approval_status != "pending":
            return Response({"approval_status": "Rejected expenses cannot be approved."}, status=400)

        expense.approval_status = "approved"
        expense.reviewed_by = request.user
        expense.reviewed_at = timezone.now()
        expense.approval_note = str(request.data.get("note", ""))[:2000]
        source_key = f"expense:{expense.pk}:payment"
        from reports.financial_services import post_allocations_to_accounts

        post_allocations_to_accounts(
            user=request.user,
            allocations=expense.payment_allocations,
            direction="out",
            entry_type="expense_payment",
            transaction_date=expense.date,
            description=f"Expense: {expense.description}",
            source_key=source_key,
            created_by=request.user,
        )
        expense.account_posting_key = source_key
        expense.save(update_fields=["approval_status", "reviewed_by", "reviewed_at", "approval_note", "account_posting_key", "updated_at"])
        log_staff_activity(
            request.user, "expense_approved", f"Approved expense {expense.description}",
            actor=request.user, request=request, object_type="expense", object_id=expense.id,
            metadata={"before": {"approval_status": "pending"},
                      "after": {"approval_status": "approved", "amount_base": str(expense.amount_base),
                                "note": expense.approval_note}},
        )
        return Response(ExpenseSerializer(expense, context={"request": request}).data)

    @action(detail=True, methods=["post"], url_path="reject")
    @transaction.atomic
    def reject(self, request, pk=None):
        if get_staff_member(request):
            raise PermissionDenied("Only the business owner can reject expenses.")
        expense = Expense.objects.select_for_update().get(
            pk=self.get_object().pk, created_by=request.user, is_deleted=False
        )
        if expense.approval_status == "rejected":
            return Response(ExpenseSerializer(expense, context={"request": request}).data)
        if expense.approval_status != "pending":
            return Response({"approval_status": "Approved expenses cannot be rejected."}, status=400)

        expense.approval_status = "rejected"
        expense.reviewed_by = request.user
        expense.reviewed_at = timezone.now()
        expense.approval_note = str(request.data.get("note", ""))[:2000]
        expense.save(update_fields=["approval_status", "reviewed_by", "reviewed_at", "approval_note", "updated_at"])
        log_staff_activity(
            request.user, "expense_rejected", f"Rejected expense {expense.description}",
            actor=request.user, request=request, object_type="expense", object_id=expense.id,
            metadata={"before": {"approval_status": "pending"},
                      "after": {"approval_status": "rejected", "note": expense.approval_note}},
        )
        return Response(ExpenseSerializer(expense, context={"request": request}).data)

    @action(detail=False, methods=["get"], url_path="todays-expenses")
    def todays_expenses(self, request):
        today = timezone.now().date()
        expenses = self.get_queryset().filter(date=today)
        total = sum([float(e.amount) for e in expenses])
        return Response({
            "total": total,
            "expenses": ExpenseSerializer(expenses, many=True).data
        })

    @action(detail=False, methods=["post"], url_path="ocr-receipt")
    def ocr_receipt(self, request):
        enforce_feature(request.user, "receipt_ocr")
        upload = request.FILES.get("receipt")
        try:
            return Response(scan_receipt_image(upload))
        except ReceiptScanError as exc:
            status_code = 503 if "not configured" in str(exc).lower() else 400
            return Response({"detail": str(exc)}, status=status_code)


class OtherIncomeViewSet(viewsets.ModelViewSet):
    serializer_class = OtherIncomeSerializer
    filterset_fields = ["date"]
    search_fields = ["description"]

    def get_queryset(self):
        queryset = OtherIncome.objects.filter(created_by=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset)

    @transaction.atomic
    def perform_create(self, serializer):
        income = serializer.save(created_by=self.request.user)

    @transaction.atomic
    def perform_update(self, serializer):
        from reports.financial_services import post_allocations_to_accounts, reverse_source_account_postings

        income = OtherIncome.objects.select_for_update().get(pk=serializer.instance.pk, created_by=self.request.user)
        if income.account_posting_key:
            reverse_source_account_postings(
                user=self.request.user,
                source_key=income.account_posting_key,
                reversal_key=f"income:{income.pk}:edit:{uuid.uuid4().hex[:12]}",
                transaction_date=timezone.localdate(),
                reason="Other income updated",
                created_by=self.request.user,
            )
        income = serializer.save()
        source_key = f"income:{income.pk}:revision:{uuid.uuid4().hex[:12]}"
        post_allocations_to_accounts(
            user=self.request.user,
            allocations=income.payment_allocations,
            direction="in",
            entry_type="income_receipt",
            transaction_date=income.date,
            description=f"Other income: {income.description}",
            source_key=source_key,
            created_by=self.request.user,
        )
        income.account_posting_key = source_key
        income.save(update_fields=["account_posting_key", "updated_at"])

    @transaction.atomic
    def perform_destroy(self, instance):
        from reports.financial_services import reverse_source_account_postings

        income = OtherIncome.objects.select_for_update().get(pk=instance.pk, created_by=self.request.user)
        if income.account_posting_key:
            reverse_source_account_postings(
                user=self.request.user,
                source_key=income.account_posting_key,
                reversal_key=f"income:{income.pk}:delete",
                transaction_date=timezone.localdate(),
                reason="Other income deleted",
                created_by=self.request.user,
            )
        income.is_deleted = True
        income.save(update_fields=["is_deleted", "updated_at"])
