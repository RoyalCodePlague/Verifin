from rest_framework import serializers
from accounts.branch_access import get_staff_member, require_staff_branch
from inventory.models import Branch
from .models import CreditTransaction, Customer, LoyaltyTransaction


class CustomerSerializer(serializers.ModelSerializer):
    branch_name = serializers.CharField(source="branch.name", read_only=True, allow_null=True)

    class Meta:
        model = Customer
        fields = "__all__"
        read_only_fields = [
            "user", "debt_amount", "debt_started_at", "debt_updated_at", "debt_due_date", "debt_notes",
            "created_at", "updated_at",
        ]

    def validate_branch(self, branch):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        if branch and (branch.user_id != user.id or branch.is_deleted):
            raise serializers.ValidationError("Branch does not belong to this account.")
        if branch:
            require_staff_branch(request, branch.id)
        return branch

    def validate(self, attrs):
        request = self.context.get("request")
        user = getattr(request, "user", None)
        staff = get_staff_member(request)
        credit_limit = attrs.get("credit_limit", getattr(self.instance, "credit_limit", None))
        if credit_limit is not None and credit_limit < 0:
            raise serializers.ValidationError({"credit_limit": "Credit limit cannot be negative."})
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        if staff:
            if not staff.branch_id:
                raise serializers.ValidationError({"branch": "This staff account must be assigned to a branch."})
            if branch is None:
                branch = Branch.objects.get(pk=staff.branch_id, user=user, is_deleted=False)
                attrs["branch"] = branch
            require_staff_branch(request, branch.id)
        return attrs


class LoyaltyTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoyaltyTransaction
        fields = "__all__"


class CreditTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditTransaction
        fields = "__all__"
