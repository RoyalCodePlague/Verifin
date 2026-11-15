from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from rest_framework import serializers
from accounts.branch_access import get_staff_member, require_staff_branch

from .financial_services import CENT, calculate_account_balance
from .models import (
    AccountReconciliationEvent,
    AccountTransaction,
    AccountTransfer,
    AutomationPreferences,
    AutomationRule,
    AutomationExecution,
    BankAccount,
    BusinessInsight,
    CustomReport,
    default_automation_rules,
)

MAX_MONEY = Decimal("999999999999.99")


class AutomationPreferencesSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationPreferences
        fields = ["enabled_rules", "severity", "channel"]

    def validate_enabled_rules(self, value):
        defaults = default_automation_rules()
        if not isinstance(value, dict):
            raise serializers.ValidationError("Rules must be an object of boolean values.")
        if set(value) - set(defaults):
            raise serializers.ValidationError("One or more automation rules are not supported.")
        if any(type(enabled) is not bool for enabled in value.values()):
            raise serializers.ValidationError("Each automation rule must be enabled or disabled.")
        return {**defaults, **value}


class CustomReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomReport
        fields = [
            "id", "name", "metric", "metrics", "group_by", "sort_order", "start_date", "end_date",
            "branch_filter", "branch", "created_at", "updated_at",
        ]
        read_only_fields = ["created_at", "updated_at"]
        extra_kwargs = {"metric": {"required": False}}

    def to_representation(self, instance):
        data = super().to_representation(instance)
        data["metrics"] = instance.metrics or [instance.metric]
        return data

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name for this report.")
        return value

    def validate_metrics(self, value):
        supported = {choice for choice, _label in CustomReport.METRIC_CHOICES}
        if not isinstance(value, list) or not value:
            raise serializers.ValidationError("Select at least one report field.")
        if any(not isinstance(metric, str) or metric not in supported for metric in value):
            raise serializers.ValidationError("One or more report fields are not supported.")
        if len(value) != len(set(value)):
            raise serializers.ValidationError("Report fields must not be duplicated.")
        return value

    def validate(self, attrs):
        requested_metrics = attrs.get("metrics") or None
        if requested_metrics is None:
            legacy_metric = attrs.get("metric", getattr(self.instance, "metric", None))
            existing_metrics = getattr(self.instance, "metrics", []) if self.instance else []
            requested_metrics = [legacy_metric] if "metric" in attrs or not existing_metrics else existing_metrics
        supported_metrics = {choice for choice, _label in CustomReport.METRIC_CHOICES}
        if not requested_metrics or any(metric not in supported_metrics for metric in requested_metrics):
            raise serializers.ValidationError({"metrics": "Select at least one report field."})
        attrs["metrics"] = requested_metrics
        attrs["metric"] = requested_metrics[0]
        request = self.context.get("request")
        user = getattr(request, "user", None)
        branch = attrs.get("branch", getattr(self.instance, "branch", None))
        branch_filter = attrs.get("branch_filter", getattr(self.instance, "branch_filter", "all"))
        start_date = attrs.get("start_date", getattr(self.instance, "start_date", None))
        end_date = attrs.get("end_date", getattr(self.instance, "end_date", None))
        if start_date and end_date and start_date > end_date:
            raise serializers.ValidationError({"end_date": "End date must be on or after the start date."})
        if branch_filter == "branch" and not branch:
            raise serializers.ValidationError({"branch": "Choose a branch for this filter."})
        if branch_filter != "branch" and branch:
            raise serializers.ValidationError({"branch": "A branch may only be set with the branch filter."})
        if branch and user and branch.user_id != user.id:
            raise serializers.ValidationError({"branch": "Branch does not belong to this account."})
        if branch and request is not None:
            staff = get_staff_member(request)
            if staff:
                try:
                    require_staff_branch(request, branch.id)
                except PermissionDenied as exc:
                    raise serializers.ValidationError({"branch": "This staff account cannot use that branch filter."}) from exc
        return attrs


class AutomationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = AutomationRule
        fields = ["id", "name", "trigger", "conditions", "action", "enabled", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter a name for this automation rule.")
        return value

    def validate_conditions(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError("Conditions must be an object.")
        return value

    def validate(self, attrs):
        trigger = attrs.get("trigger", getattr(self.instance, "trigger", None))
        action = attrs.get("action", getattr(self.instance, "action", None))
        conditions = attrs.get("conditions", getattr(self.instance, "conditions", {})) or {}
        allowed_actions = {
            "stock_below_minimum": {"create_notification"},
            "customer_overdue": {"create_notification", "create_follow_up"},
            "expense_exceeds_limit": {"create_notification", "require_manager_approval"},
            "purchase_order_approved": {"create_notification"},
            "till_session_closed": {"create_notification", "create_reconciliation_summary"},
        }
        if trigger not in allowed_actions:
            raise serializers.ValidationError({"trigger": "Choose a supported business event."})
        if action not in allowed_actions[trigger]:
            raise serializers.ValidationError({"action": "This action cannot be used with the selected trigger."})
        condition_keys = {
            "stock_below_minimum": {"maximum_stock"},
            "customer_overdue": {"minimum_debt_base"},
            "expense_exceeds_limit": {"amount_base"},
            "purchase_order_approved": {"minimum_amount_base"},
            "till_session_closed": {"minimum_variance_base"},
        }[trigger]
        if set(conditions) - condition_keys:
            raise serializers.ValidationError({"conditions": "One or more conditions are not supported for this trigger."})
        if trigger == "expense_exceeds_limit" and "amount_base" not in conditions:
            raise serializers.ValidationError({"conditions": "Set an amount_base limit for expense rules."})
        for key, raw_value in conditions.items():
            if isinstance(raw_value, bool):
                raise serializers.ValidationError({"conditions": f"{key} must be a positive number."})
            try:
                value = Decimal(str(raw_value))
            except Exception as exc:
                raise serializers.ValidationError({"conditions": f"{key} must be a positive number."}) from exc
            if not value.is_finite() or value < 0:
                raise serializers.ValidationError({"conditions": f"{key} must be zero or greater."})
            conditions[key] = str(value)
        attrs["conditions"] = conditions
        return attrs


class AutomationExecutionSerializer(serializers.ModelSerializer):
    rule_name = serializers.CharField(source="rule.name", read_only=True)
    trigger = serializers.CharField(source="rule.trigger", read_only=True)
    action = serializers.CharField(source="rule.action", read_only=True)

    class Meta:
        model = AutomationExecution
        fields = [
            "id", "rule", "rule_name", "trigger", "action", "event_key", "object_type", "object_id",
            "status", "attempts", "message", "last_error", "started_at", "completed_at", "created_at",
        ]
        read_only_fields = fields


class BusinessInsightSerializer(serializers.ModelSerializer):
    class Meta:
        model = BusinessInsight
        fields = [
            "id", "rule_key", "title", "explanation", "supporting_figures",
            "period_start", "period_end", "period_label", "severity",
            "recommended_action", "link", "status", "generated_at",
            "acknowledged_at", "dismissed_at", "resolved_at",
        ]
        read_only_fields = fields


class FinancialAccountSerializer(serializers.ModelSerializer):
    current_balance = serializers.SerializerMethodField()
    current_balance_base = serializers.SerializerMethodField()
    opening_fx_rate_to_base = serializers.DecimalField(
        max_digits=18, decimal_places=6, required=False, allow_null=True
    )

    class Meta:
        model = BankAccount
        fields = [
            "id", "name", "account_type", "provider_name", "currency", "opening_balance",
            "opening_fx_rate_to_base", "opening_date", "current_balance", "current_balance_base", "is_active",
            "created_at", "updated_at",
        ]
        read_only_fields = ["id", "current_balance", "current_balance_base", "created_at", "updated_at"]

    def get_fields(self):
        fields = super().get_fields()
        if self.instance:
            for name in ("currency", "opening_balance", "opening_fx_rate_to_base", "opening_date"):
                fields[name].read_only = True
        return fields

    def get_current_balance(self, account):
        balance = calculate_account_balance(account)
        return balance["balance"]

    def get_current_balance_base(self, account):
        balance = calculate_account_balance(account)
        return balance["balance_base"]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Enter an account name.")
        request = self.context.get("request")
        queryset = BankAccount.objects.filter(user=request.user, is_deleted=False, name__iexact=value)
        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)
        if queryset.exists():
            raise serializers.ValidationError("An account with this name already exists.")
        return value

    def validate_currency(self, value):
        value = value.strip().upper()
        if not value:
            raise serializers.ValidationError("Enter a currency code.")
        return value

    def validate(self, attrs):
        if self.instance:
            return attrs

        request = self.context.get("request")
        user = getattr(request, "user", None)
        currency = attrs.get("currency", "").upper()
        opening_rate = attrs.get("opening_fx_rate_to_base")
        if user and currency == user.currency.upper():
            if opening_rate is not None and opening_rate != Decimal("1"):
                raise serializers.ValidationError({"opening_fx_rate_to_base": "The base-currency rate must be 1."})
            attrs["opening_fx_rate_to_base"] = Decimal("1")
        elif opening_rate is None:
            raise serializers.ValidationError({
                "opening_fx_rate_to_base": "Enter the exchange rate from this account's currency to your base currency."
            })
        elif opening_rate <= 0:
            raise serializers.ValidationError({"opening_fx_rate_to_base": "The exchange rate must be greater than zero."})
        if abs(attrs.get("opening_balance", Decimal("0")) * attrs["opening_fx_rate_to_base"]) > MAX_MONEY:
            raise serializers.ValidationError({"opening_balance": "The base-currency opening balance is too large to record."})
        return attrs


class ReconciliationEventSerializer(serializers.ModelSerializer):
    class Meta:
        model = AccountReconciliationEvent
        fields = ["reconciled", "note", "created_at", "created_by"]
        read_only_fields = fields


class AccountTransactionSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    currency = serializers.CharField(source="account.currency", read_only=True)
    reconciliation_events = ReconciliationEventSerializer(many=True, read_only=True)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False, allow_null=True)

    class Meta:
        model = AccountTransaction
        fields = [
            "id", "account", "account_name", "currency", "direction", "entry_type", "amount",
            "fx_rate_to_base", "amount_base", "transaction_date", "description", "reference",
            "idempotency_key", "is_reconciled", "reconciled_at", "reconciliation_events", "created_at",
        ]
        read_only_fields = [
            "id", "account_name", "currency", "entry_type", "amount_base", "is_reconciled",
            "reconciled_at", "reconciliation_events", "created_at",
        ]

    def validate_account(self, account):
        user = self.context["request"].user
        if account.user_id != user.id or account.is_deleted:
            raise serializers.ValidationError("This account is not available.")
        if not account.is_active:
            raise serializers.ValidationError("Activate this account before posting transactions.")
        return account

    def validate(self, attrs):
        account = attrs["account"]
        if attrs["amount"] <= 0:
            raise serializers.ValidationError({"amount": "The amount must be greater than zero."})
        if attrs["transaction_date"] < account.opening_date:
            raise serializers.ValidationError({"transaction_date": "The transaction date cannot be before the account opening date."})
        rate = attrs.get("fx_rate_to_base")
        if account.currency.upper() == self.context["request"].user.currency.upper():
            if rate is not None and rate != Decimal("1"):
                raise serializers.ValidationError({"fx_rate_to_base": "The base-currency rate must be 1."})
            attrs["fx_rate_to_base"] = Decimal("1")
        elif rate is None:
            raise serializers.ValidationError({"fx_rate_to_base": "Enter the transaction-time exchange rate to your base currency."})
        elif rate <= 0:
            raise serializers.ValidationError({"fx_rate_to_base": "The exchange rate must be greater than zero."})
        amount_base = (attrs["amount"] * attrs["fx_rate_to_base"]).quantize(CENT)
        if amount_base <= 0:
            raise serializers.ValidationError({"amount": "The transaction is too small to represent in base currency."})
        if amount_base > MAX_MONEY:
            raise serializers.ValidationError({"amount": "The base-currency amount is too large to record."})
        attrs["amount_base"] = amount_base
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        get_user_model().objects.select_for_update().get(pk=user.pk)
        key = validated_data.get("idempotency_key", "")
        if key:
            existing = AccountTransaction.objects.filter(user=user, idempotency_key=key).first()
            if existing:
                matching_fields = (
                    existing.account_id == validated_data["account"].id
                    and existing.direction == validated_data["direction"]
                    and existing.amount == validated_data["amount"]
                    and existing.fx_rate_to_base == validated_data["fx_rate_to_base"]
                    and existing.transaction_date == validated_data["transaction_date"]
                    and existing.description == validated_data["description"]
                    and existing.reference == validated_data.get("reference", "")
                )
                if matching_fields:
                    return existing
                raise serializers.ValidationError({"idempotency_key": "This key was already used for a different transaction."})

        account = BankAccount.objects.select_for_update().get(
            pk=validated_data["account"].pk, user=user, is_deleted=False, is_active=True
        )
        balance = calculate_account_balance(account)["balance"]
        if validated_data["direction"] == "out" and validated_data["amount"] > balance:
            raise serializers.ValidationError({"amount": "The account does not have enough available funds."})
        transaction_data = {key: value for key, value in validated_data.items() if key != "account"}
        return AccountTransaction.objects.create(
            **transaction_data, account=account, user=user, created_by=user, entry_type="manual"
        )


class AccountTransferSerializer(serializers.ModelSerializer):
    from_account_name = serializers.CharField(source="from_account.name", read_only=True)
    to_account_name = serializers.CharField(source="to_account.name", read_only=True)
    from_currency = serializers.CharField(source="from_account.currency", read_only=True)
    to_currency = serializers.CharField(source="to_account.currency", read_only=True)
    exchange_rate = serializers.DecimalField(max_digits=18, decimal_places=6, required=False, allow_null=True)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False, allow_null=True)

    class Meta:
        model = AccountTransfer
        fields = [
            "id", "from_account", "from_account_name", "from_currency", "to_account", "to_account_name",
            "to_currency", "amount_from", "amount_to", "exchange_rate", "fx_rate_to_base", "amount_base",
            "transaction_date", "description", "reference", "idempotency_key", "created_at",
        ]
        read_only_fields = [
            "id", "from_account_name", "from_currency", "to_account_name", "to_currency", "amount_to",
            "amount_base", "created_at",
        ]

    def validate(self, attrs):
        user = self.context["request"].user
        from_account = attrs["from_account"]
        to_account = attrs["to_account"]
        if attrs["amount_from"] <= 0:
            raise serializers.ValidationError({"amount_from": "The amount must be greater than zero."})
        if attrs["transaction_date"] < max(from_account.opening_date, to_account.opening_date):
            raise serializers.ValidationError({"transaction_date": "The transfer date cannot be before either account's opening date."})
        for account in (from_account, to_account):
            if account.user_id != user.id or account.is_deleted:
                raise serializers.ValidationError("Both accounts must belong to your business.")
            if not account.is_active:
                raise serializers.ValidationError("Both accounts must be active.")
        if from_account.pk == to_account.pk:
            raise serializers.ValidationError({"to_account": "Choose a different destination account."})

        rate = attrs.get("exchange_rate")
        if from_account.currency.upper() == to_account.currency.upper():
            if rate is not None and rate != Decimal("1"):
                raise serializers.ValidationError({"exchange_rate": "The exchange rate must be 1 for accounts in the same currency."})
            attrs["exchange_rate"] = Decimal("1")
        elif rate is None or rate <= 0:
            raise serializers.ValidationError({"exchange_rate": "Enter the explicit transfer rate (destination units per source unit)."})
        amount_to = (attrs["amount_from"] * attrs["exchange_rate"]).quantize(CENT)
        amount_base = (attrs["amount_from"] * attrs.get("fx_rate_to_base", Decimal("1"))).quantize(CENT)
        if amount_to <= 0:
            raise serializers.ValidationError({"amount_from": "The transfer amount rounds to zero in the destination currency."})
        if amount_to > MAX_MONEY or amount_base > MAX_MONEY:
            raise serializers.ValidationError({"amount_from": "The converted transfer amount is too large to record."})

        base_currency = user.currency.upper()
        fx_rate = attrs.get("fx_rate_to_base")
        if from_account.currency.upper() == base_currency:
            if fx_rate is not None and fx_rate != Decimal("1"):
                raise serializers.ValidationError({"fx_rate_to_base": "The source account is in base currency, so its rate must be 1."})
            attrs["fx_rate_to_base"] = Decimal("1")
        elif fx_rate is None or fx_rate <= 0:
            raise serializers.ValidationError({"fx_rate_to_base": "Enter the source-currency rate to base currency at transfer time."})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        user = self.context["request"].user
        get_user_model().objects.select_for_update().get(pk=user.pk)
        key = validated_data.get("idempotency_key", "")
        if key:
            existing = AccountTransfer.objects.filter(user=user, idempotency_key=key).first()
            if existing:
                matches = (
                    existing.from_account_id == validated_data["from_account"].id
                    and existing.to_account_id == validated_data["to_account"].id
                    and existing.amount_from == validated_data["amount_from"]
                    and existing.exchange_rate == validated_data["exchange_rate"]
                    and existing.fx_rate_to_base == validated_data["fx_rate_to_base"]
                    and existing.transaction_date == validated_data["transaction_date"]
                    and existing.description == validated_data.get("description", "")
                    and existing.reference == validated_data.get("reference", "")
                )
                if matches:
                    return existing
                raise serializers.ValidationError({"idempotency_key": "This key was already used for a different transfer."})

        accounts = {
            account.pk: account
            for account in BankAccount.objects.select_for_update().filter(
                pk__in=[validated_data["from_account"].pk, validated_data["to_account"].pk],
                user=user,
                is_deleted=False,
                is_active=True,
            ).order_by("pk")
        }
        source = accounts.get(validated_data["from_account"].pk)
        destination = accounts.get(validated_data["to_account"].pk)
        if source is None or destination is None:
            raise serializers.ValidationError("Both accounts must be active and available.")
        amount_from = validated_data["amount_from"]
        source_balance = calculate_account_balance(source)["balance"]
        if amount_from > source_balance:
            raise serializers.ValidationError({"amount_from": "The source account does not have enough available funds."})

        amount_to = (amount_from * validated_data["exchange_rate"]).quantize(CENT)
        amount_base = (amount_from * validated_data["fx_rate_to_base"]).quantize(CENT)
        destination_fx = (amount_base / amount_to).quantize(Decimal("0.000001")) if amount_to else Decimal("1")
        transfer_data = {
            key: value for key, value in validated_data.items()
            if key not in {"from_account", "to_account"}
        }
        transfer = AccountTransfer.objects.create(
            **transfer_data,
            from_account=source,
            to_account=destination,
            amount_to=amount_to,
            amount_base=amount_base,
            user=user,
            created_by=user,
        )
        date_value = validated_data["transaction_date"]
        description = validated_data.get("description", "").strip()
        reference = validated_data.get("reference", "")
        AccountTransaction.objects.create(
            user=user,
            account=source,
            transfer=transfer,
            direction="out",
            entry_type="transfer_out",
            amount=amount_from,
            fx_rate_to_base=validated_data["fx_rate_to_base"],
            amount_base=amount_base,
            transaction_date=date_value,
            description=description or f"Transfer to {destination.name}",
            reference=reference,
            created_by=user,
        )
        AccountTransaction.objects.create(
            user=user,
            account=destination,
            transfer=transfer,
            direction="in",
            entry_type="transfer_in",
            amount=amount_to,
            fx_rate_to_base=destination_fx,
            amount_base=amount_base,
            transaction_date=date_value,
            description=description or f"Transfer from {source.name}",
            reference=reference,
            created_by=user,
        )
        return transfer
