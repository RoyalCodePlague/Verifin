from decimal import Decimal

from django.utils import timezone
from django.db import transaction
from rest_framework import serializers
from accounts.branch_access import get_staff_member, require_staff_branch
from billing.services import enforce_feature
from core.currency import get_rate_to_base, normalize_allocations
from inventory.models import Branch
from .financial_services import get_budget_actual
from .models import Expense, ExpenseBudget, ExpenseCategory, OtherIncome, RecurringExpense


class ExpenseCategorySerializer(serializers.ModelSerializer):
    parent_name = serializers.CharField(source="parent.name", read_only=True, allow_null=True)

    class Meta:
        model = ExpenseCategory
        fields = ["id", "name", "parent", "parent_name", "is_deleted", "created_at", "updated_at"]

    def validate(self, attrs):
        parent = attrs.get("parent", getattr(self.instance, "parent", None))
        if self.instance and parent and parent.pk == self.instance.pk:
            raise serializers.ValidationError({"parent": "A category cannot be its own parent."})
        if parent and parent.parent_id:
            raise serializers.ValidationError({"parent": "Subcategories can only be one level deep."})
        if parent and parent.is_deleted:
            raise serializers.ValidationError({"parent": "Choose an active parent category."})
        name = attrs.get("name", getattr(self.instance, "name", "")).strip()
        duplicates = ExpenseCategory.objects.filter(name__iexact=name, parent=parent, is_deleted=False)
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if duplicates.exists():
            raise serializers.ValidationError({"name": "A category with this name already exists at this level."})
        return attrs


class ExpenseBudgetSerializer(serializers.ModelSerializer):
    category = serializers.PrimaryKeyRelatedField(queryset=ExpenseCategory.objects.filter(is_deleted=False), allow_null=True, required=False)
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True)
    category_label = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
    spent_base = serializers.SerializerMethodField()
    remaining_base = serializers.SerializerMethodField()
    percent_used = serializers.SerializerMethodField()

    class Meta:
        model = ExpenseBudget
        fields = [
            "id", "category", "category_name", "category_label", "branch", "branch_name", "expense_type",
            "period_start", "period_end", "amount_base", "spent_base", "remaining_base",
            "percent_used", "note", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {"amount_base": {"min_value": Decimal("0.01")}}

    def get_spent_base(self, obj):
        return get_budget_actual(obj, through_date=timezone.localdate())

    def get_category_label(self, obj):
        if not obj.category:
            return None
        if obj.category.parent_id:
            return f"{obj.category.parent.name} / {obj.category.name}"
        return obj.category.name

    def get_remaining_base(self, obj):
        return obj.amount_base - get_budget_actual(obj, through_date=timezone.localdate())

    def get_percent_used(self, obj):
        if obj.amount_base <= 0:
            return Decimal("0.00")
        return (get_budget_actual(obj, through_date=timezone.localdate()) / obj.amount_base * Decimal("100")).quantize(Decimal("0.01"))

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return attrs
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        staff = get_staff_member(request)
        if staff:
            if not staff.branch_id:
                raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
            if branch is None:
                branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                attrs["branch"] = branch
            require_staff_branch(request, branch.id)
        if branch and (branch.user_id != user.id or branch.is_deleted):
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        if branch:
            enforce_feature(user, "multi_branch")

        start = attrs.get("period_start", getattr(self.instance, "period_start", None))
        end = attrs.get("period_end", getattr(self.instance, "period_end", None))
        if start and end and end < start:
            raise serializers.ValidationError({"period_end": "The budget end date must be on or after its start date."})
        category = attrs.get("category", getattr(self.instance, "category", None))
        expense_type = attrs.get("expense_type", getattr(self.instance, "expense_type", "operating"))
        duplicates = ExpenseBudget.objects.filter(
            user=user,
            branch=branch,
            category=category,
            expense_type=expense_type,
            period_start=start,
            period_end=end,
            is_deleted=False,
        )
        if self.instance:
            duplicates = duplicates.exclude(pk=self.instance.pk)
        if start and end and duplicates.exists():
            raise serializers.ValidationError({"period_start": "A budget already exists for this branch, category, type, and period."})
        return attrs


class RecurringExpenseSerializer(serializers.ModelSerializer):
    category = serializers.PrimaryKeyRelatedField(queryset=ExpenseCategory.objects.filter(is_deleted=False), allow_null=True, required=False)
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True)
    category_label = serializers.SerializerMethodField()
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
    currency = serializers.CharField(required=False)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False)
    amount_base = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_allocations = serializers.JSONField(required=False)

    class Meta:
        model = RecurringExpense
        fields = [
            "id", "description", "amount", "expense_type", "currency", "fx_rate_to_base",
            "amount_base", "payment_allocations", "category", "category_name", "category_label", "branch",
            "branch_name", "frequency", "first_due_date", "next_due_date", "end_date",
            "is_active", "created_at", "updated_at",
        ]
        read_only_fields = ["next_due_date", "created_at", "updated_at"]
        extra_kwargs = {"amount": {"min_value": Decimal("0.01")}}

    def get_fields(self):
        fields = super().get_fields()
        if self.instance:
            fields["first_due_date"].read_only = True
        return fields

    def get_category_label(self, obj):
        if not obj.category:
            return None
        if obj.category.parent_id:
            return f"{obj.category.parent.name} / {obj.category.name}"
        return obj.category.name

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return attrs

        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        staff = get_staff_member(request)
        if staff:
            if not staff.branch_id:
                raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
            if branch is None:
                branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                attrs["branch"] = branch
            require_staff_branch(request, branch.id)
        if branch and (branch.user_id != user.id or branch.is_deleted):
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        if branch:
            enforce_feature(user, "multi_branch")

        first_due = attrs.get("first_due_date", getattr(self.instance, "first_due_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if first_due and end_date and end_date < first_due:
            raise serializers.ValidationError({"end_date": "The end date must be on or after the first due date."})

        currency = (attrs.get("currency") or getattr(self.instance, "currency", user.currency) or user.currency).strip().upper()
        attrs["currency"] = currency
        amount = attrs.get("amount", getattr(self.instance, "amount", Decimal("0")))
        rate = get_rate_to_base(user, currency, attrs.get("fx_rate_to_base", getattr(self.instance, "fx_rate_to_base", None)))
        attrs["fx_rate_to_base"] = rate
        attrs["amount_base"] = (Decimal(str(amount)) * rate).quantize(Decimal("0.01"))
        allocations, allocations_total = normalize_allocations(
            user,
            attrs.get("payment_allocations", getattr(self.instance, "payment_allocations", [])),
            amount,
            currency,
            rate,
        )
        if allocations_total != attrs["amount_base"]:
            raise serializers.ValidationError({"payment_allocations": "Payment allocations must add up to the recurring expense total."})
        attrs["payment_allocations"] = allocations
        return attrs


class ExpenseSerializer(serializers.ModelSerializer):
    category = serializers.PrimaryKeyRelatedField(queryset=ExpenseCategory.objects.filter(is_deleted=False), allow_null=True, required=False)
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True)
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)
    currency = serializers.CharField(required=False)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False)
    amount_base = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_allocations = serializers.JSONField(required=False)
    category_label = serializers.SerializerMethodField()
    employee_name = serializers.SerializerMethodField()

    class Meta:
        model = Expense
        fields = [
            "id", "description", "amount", "expense_type", "currency",
            "fx_rate_to_base", "amount_base", "payment_allocations", "account_posting_key",
            "approval_status", "reviewed_by", "reviewed_at", "approval_note",
            "created_by_staff", "employee_name", "category_label",
            "category", "category_name", "branch", "branch_name", "date", "created_by",
            "receipt_image", "created_at", "updated_at", "is_deleted",
        ]
        read_only_fields = ["created_by", "created_by_staff", "employee_name", "category_label", "account_posting_key", "approval_status", "reviewed_by", "reviewed_at", "approval_note"]

    def get_category_label(self, obj):
        if not obj.category:
            return "Other"
        if obj.category.parent_id:
            return f"{obj.category.parent.name} / {obj.category.name}"
        return obj.category.name

    def get_employee_name(self, obj):
        if obj.created_by_staff_id:
            return obj.created_by_staff.name
        return "Business owner"

    def validate_receipt_image(self, value):
        if value and value.size > 10 * 1024 * 1024:
            raise serializers.ValidationError("Receipt images must be 10 MB or smaller.")
        return value

    @transaction.atomic
    def create(self, validated_data):
        request = self.context.get("request")
        staff = get_staff_member(request) if request else None
        from reports.automation_engine import automation_requires_expense_approval
        approval_required = automation_requires_expense_approval(validated_data["created_by"], validated_data["amount_base"])
        validated_data["approval_status"] = "pending" if staff or approval_required else "approved"
        expense = super().create(validated_data)
        from reports.automation_engine import queue_automation_event
        queue_automation_event(
            expense.created_by, "expense_exceeds_limit", f"expense:{expense.pk}:created", "expense", expense.pk,
            {"amount_base": str(expense.amount_base)},
        )
        if expense.approval_status != "approved":
            return expense
        source_key = f"expense:{expense.pk}:payment"
        from reports.financial_services import post_allocations_to_accounts

        post_allocations_to_accounts(
            user=expense.created_by,
            allocations=expense.payment_allocations,
            direction="out",
            entry_type="expense_payment",
            transaction_date=expense.date,
            description=f"Expense: {expense.description}",
            source_key=source_key,
            created_by=expense.created_by,
        )
        expense.account_posting_key = source_key
        expense.save(update_fields=["account_posting_key", "updated_at"])
        return expense

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return attrs

        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        staff = get_staff_member(request)
        if staff:
            if not staff.branch_id:
                raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
            if branch is None:
                branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                attrs["branch"] = branch
            require_staff_branch(request, branch.id)
        if branch and (branch.user_id != user.id or branch.is_deleted):
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        if branch:
            enforce_feature(user, "multi_branch")

        currency = (attrs.get("currency") or getattr(self.instance, "currency", user.currency) or user.currency).strip().upper()
        attrs["currency"] = currency
        amount = attrs.get("amount", getattr(self.instance, "amount", Decimal("0")))
        rate = get_rate_to_base(user, currency, attrs.get("fx_rate_to_base", getattr(self.instance, "fx_rate_to_base", None)))
        attrs["fx_rate_to_base"] = rate
        attrs["amount_base"] = (Decimal(str(amount)) * rate).quantize(Decimal("0.01"))
        allocations, allocations_total = normalize_allocations(
            user,
            attrs.get("payment_allocations", getattr(self.instance, "payment_allocations", [])),
            amount,
            currency,
            rate,
        )
        attrs["payment_allocations"] = allocations
        if allocations_total != attrs["amount_base"]:
            raise serializers.ValidationError({
                "payment_allocations": "Split payments must add up to the converted expense total."
            })
        return attrs


class OtherIncomeSerializer(serializers.ModelSerializer):
    currency = serializers.CharField(required=False)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False)
    amount_base = serializers.DecimalField(max_digits=12, decimal_places=2, read_only=True)
    payment_allocations = serializers.JSONField(required=False)
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)

    class Meta:
        model = OtherIncome
        fields = [
            "id", "description", "amount", "currency", "fx_rate_to_base",
            "amount_base", "payment_allocations", "account_posting_key", "branch", "branch_name", "date", "created_by",
            "created_at", "updated_at", "is_deleted",
        ]
        read_only_fields = ["created_by", "account_posting_key"]

    @transaction.atomic
    def create(self, validated_data):
        income = super().create(validated_data)
        source_key = f"income:{income.pk}:receipt"
        from reports.financial_services import post_allocations_to_accounts

        post_allocations_to_accounts(
            user=income.created_by,
            allocations=income.payment_allocations,
            direction="in",
            entry_type="income_receipt",
            transaction_date=income.date,
            description=f"Other income: {income.description}",
            source_key=source_key,
            created_by=income.created_by,
        )
        income.account_posting_key = source_key
        income.save(update_fields=["account_posting_key", "updated_at"])
        return income

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            return attrs

        request = self.context.get("request")
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        staff = get_staff_member(request)
        if staff:
            if not staff.branch_id:
                raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
            if branch is None:
                branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                attrs["branch"] = branch
            require_staff_branch(request, branch.id)
        if branch and (branch.user_id != user.id or branch.is_deleted):
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        if branch:
            enforce_feature(user, "multi_branch")

        currency = (attrs.get("currency") or getattr(self.instance, "currency", user.currency) or user.currency).strip().upper()
        attrs["currency"] = currency
        amount = attrs.get("amount", getattr(self.instance, "amount", Decimal("0")))
        rate = get_rate_to_base(user, currency, attrs.get("fx_rate_to_base", getattr(self.instance, "fx_rate_to_base", None)))
        attrs["fx_rate_to_base"] = rate
        attrs["amount_base"] = (Decimal(str(amount)) * rate).quantize(Decimal("0.01"))
        allocations, allocations_total = normalize_allocations(
            user,
            attrs.get("payment_allocations", getattr(self.instance, "payment_allocations", [])),
            amount,
            currency,
            rate,
        )
        attrs["payment_allocations"] = allocations
        if allocations_total != attrs["amount_base"]:
            raise serializers.ValidationError({
                "payment_allocations": "Split payments must add up to the converted income total."
            })
        return attrs
