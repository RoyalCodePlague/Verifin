from decimal import Decimal

from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from accounts.branch_access import get_staff_member, require_staff_operation
from accounts.activity import log_staff_activity
from .financial_services import calculate_account_balance
from .models import AccountBalanceReconciliation, AccountReconciliationEvent, AccountTransaction, AccountTransfer, BankAccount
from .serializers import AccountTransactionSerializer, AccountTransferSerializer, FinancialAccountSerializer


class FinancialAccountViewSet(viewsets.ModelViewSet):
    serializer_class = FinancialAccountSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_queryset(self):
        return BankAccount.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        require_staff_operation(self.request, "financial.adjust")
        account = serializer.save(user=self.request.user)
        log_staff_activity(
            self.request.user, "financial_account_created", f"Created financial account {account.name}",
            actor=self.request.user, request=self.request, object_type="financial_account", object_id=account.id,
            metadata={"after": {"name": account.name, "account_type": account.account_type,
                                "currency": account.currency, "opening_balance": str(account.opening_balance),
                                "opening_date": account.opening_date.isoformat()}},
        )

    def perform_update(self, serializer):
        require_staff_operation(self.request, "financial.adjust")
        account = serializer.instance
        before = {"name": account.name, "account_type": account.account_type, "currency": account.currency,
                  "opening_balance": str(account.opening_balance), "opening_date": account.opening_date.isoformat(),
                  "is_active": account.is_active}
        account = serializer.save()
        after = {"name": account.name, "account_type": account.account_type, "currency": account.currency,
                 "opening_balance": str(account.opening_balance), "opening_date": account.opening_date.isoformat(),
                 "is_active": account.is_active}
        log_staff_activity(
            self.request.user, "financial_account_updated", f"Updated financial account {account.name}",
            actor=self.request.user, request=self.request, object_type="financial_account", object_id=account.id,
            metadata={"before": before, "after": after},
        )

    @action(detail=True, methods=["get"])
    def balance(self, request, pk=None):
        account = self.get_object()
        as_of_value = request.query_params.get("as_of")
        as_of = parse_date(as_of_value) if as_of_value else timezone.localdate()
        if as_of_value and as_of is None:
            return Response({"as_of": "Enter a valid date in YYYY-MM-DD format."}, status=status.HTTP_400_BAD_REQUEST)
        balance = calculate_account_balance(account, as_of)
        history = AccountBalanceReconciliation.objects.filter(account=account, as_of__lte=as_of).select_related(
            "adjustment_transaction", "created_by"
        )[:10]
        return Response({
            "account": account.pk,
            "as_of": as_of,
            **balance,
            "reconciliation_history": [{
                "id": row.pk,
                "as_of": row.as_of,
                "expected_balance": row.expected_balance,
                "actual_balance": row.actual_balance,
                "difference": row.difference,
                "note": row.note,
                "adjustment_requested": row.adjustment_requested,
                "adjustment_transaction": row.adjustment_transaction_id,
                "created_by": row.created_by_id,
                "created_at": row.created_at,
            } for row in history],
        })

    @action(detail=True, methods=["post"], url_path="reconcile-balance")
    @transaction.atomic
    def reconcile_balance(self, request, pk=None):
        if getattr(request, "api_key", None):
            raise PermissionDenied("API keys cannot reconcile or adjust financial accounts.")
        require_staff_operation(request, "financial.adjust", staff=get_staff_member(request))
        payload = AccountBalanceReconciliationRequestSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        account = self.get_queryset().select_for_update().get(pk=pk)
        values = payload.validated_data
        if values["as_of"] < account.opening_date:
            raise serializers.ValidationError({"as_of": "Choose a date on or after this account's opening date."})
        if values["as_of"] > timezone.localdate():
            raise serializers.ValidationError({"as_of": "A balance cannot be reconciled for a future date."})
        rate = values.get("fx_rate_to_base")
        if values["post_adjustment"]:
            if account.currency.upper() == request.user.currency.upper():
                rate = Decimal("1")
            elif rate is None:
                raise serializers.ValidationError({
                    "fx_rate_to_base": "Enter the exchange rate to your base currency for this adjustment."
                })

        expected = calculate_account_balance(account, values["as_of"])["balance"]
        actual = values["actual_balance"]
        difference = (actual - expected).quantize(Decimal("0.01"))
        key = values["idempotency_key"]
        existing = AccountBalanceReconciliation.objects.select_for_update().filter(
            user=request.user, idempotency_key=key
        ).first()
        if existing:
            matches = (
                existing.account_id == account.pk
                and existing.as_of == values["as_of"]
                and existing.actual_balance == actual
                and existing.note == values.get("note", "")
                and existing.adjustment_requested == values["post_adjustment"]
                and (not existing.adjustment_transaction_id or existing.adjustment_transaction.fx_rate_to_base == rate)
            )
            if not matches:
                raise serializers.ValidationError({"idempotency_key": "This reconciliation key was already used for different values."})
            return Response(self._balance_reconciliation_data(existing))

        reconciliation = AccountBalanceReconciliation.objects.create(
            user=request.user,
            account=account,
            as_of=values["as_of"],
            expected_balance=expected,
            actual_balance=actual,
            difference=difference,
            note=values.get("note", ""),
            idempotency_key=key,
            adjustment_requested=values["post_adjustment"],
            created_by=request.user,
        )
        if values["post_adjustment"] and difference:
            amount = abs(difference)
            amount_base = (amount * rate).quantize(Decimal("0.01"))
            if amount_base <= 0:
                raise serializers.ValidationError({"actual_balance": "The adjustment is too small to represent in base currency."})
            if amount_base > Decimal("999999999999.99"):
                raise serializers.ValidationError({"actual_balance": "The adjustment is too large to post."})
            adjustment = AccountTransaction.objects.create(
                user=request.user,
                account=account,
                direction="in" if difference > 0 else "out",
                entry_type="adjustment",
                amount=amount,
                fx_rate_to_base=rate,
                amount_base=amount_base,
                transaction_date=values["as_of"],
                description=f"Reconciliation adjustment: {account.name}"[:255],
                reference=f"RECON-{reconciliation.pk}",
                idempotency_key=f"reconciliation:{key}"[:120],
                created_by=request.user,
            )
            reconciliation.adjustment_transaction = adjustment
            reconciliation.save(update_fields=["adjustment_transaction"])
        log_staff_activity(
            request.user,
            "financial_account_reconciled",
            f"Reconciled account {account.name}",
            actor=request.user,
            request=request,
            object_type="account_reconciliation",
            object_id=reconciliation.id,
            metadata={
                "account_id": account.id,
                "before": {"expected_balance": str(expected)},
                "after": {"actual_balance": str(actual), "difference": str(difference),
                          "adjustment_transaction_id": reconciliation.adjustment_transaction_id},
                "post_adjustment": values["post_adjustment"],
                "note": values.get("note", ""),
            },
        )
        return Response(self._balance_reconciliation_data(reconciliation), status=status.HTTP_201_CREATED)

    @staticmethod
    def _balance_reconciliation_data(row):
        return {
            "id": row.pk,
            "account": row.account_id,
            "as_of": row.as_of,
            "expected_balance": row.expected_balance,
            "actual_balance": row.actual_balance,
            "difference": row.difference,
            "note": row.note,
            "adjustment_requested": row.adjustment_requested,
            "adjustment_transaction": row.adjustment_transaction_id,
            "created_by": row.created_by_id,
            "created_at": row.created_at,
        }


class AccountBalanceReconciliationRequestSerializer(serializers.Serializer):
    as_of = serializers.DateField()
    actual_balance = serializers.DecimalField(max_digits=14, decimal_places=2)
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)
    post_adjustment = serializers.BooleanField(required=False, default=False)
    fx_rate_to_base = serializers.DecimalField(max_digits=18, decimal_places=6, required=False, min_value=Decimal("0.000001"))
    idempotency_key = serializers.CharField(max_length=120)

    def validate_idempotency_key(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("Provide an idempotency key.")
        return value


class ReconciliationSerializer(serializers.Serializer):
    reconciled = serializers.BooleanField()
    note = serializers.CharField(required=False, allow_blank=True, max_length=255)


class AccountTransactionViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AccountTransactionSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        queryset = AccountTransaction.objects.filter(user=self.request.user, is_deleted=False).select_related("account", "transfer")
        account_id = self.request.query_params.get("account")
        if account_id:
            queryset = queryset.filter(account_id=account_id)
        for param, lookup in (("start_date", "transaction_date__gte"), ("end_date", "transaction_date__lte")):
            value = self.request.query_params.get(param)
            if value:
                date_value = parse_date(value)
                if date_value is None:
                    raise serializers.ValidationError({param: "Enter a valid date in YYYY-MM-DD format."})
                queryset = queryset.filter(**{lookup: date_value})
        return queryset

    def perform_create(self, serializer):
        require_staff_operation(self.request, "financial.adjust")
        key = serializer.validated_data.get("idempotency_key", "")
        was_existing = bool(key and AccountTransaction.objects.filter(user=self.request.user, idempotency_key=key).exists())
        account_transaction = serializer.save()
        if not was_existing:
            log_staff_activity(
                self.request.user,
                "financial_transaction_recorded",
                f"Recorded {account_transaction.direction} transaction of {account_transaction.amount} {account_transaction.account.currency}",
                actor=self.request.user,
                request=self.request,
                object_type="account_transaction",
                object_id=account_transaction.id,
                metadata={"after": {"account_id": account_transaction.account_id,
                                    "direction": account_transaction.direction,
                                    "amount": str(account_transaction.amount),
                                    "currency": account_transaction.account.currency,
                                    "amount_base": str(account_transaction.amount_base),
                                    "transaction_date": account_transaction.transaction_date.isoformat(),
                                    "description": account_transaction.description}},
            )

    @action(detail=True, methods=["post"])
    def reconcile(self, request, pk=None):
        payload = ReconciliationSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        with transaction.atomic():
            account_transaction = self.get_queryset().select_for_update(of=("self",)).get(pk=pk)
            reconciled = payload.validated_data["reconciled"]
            if account_transaction.is_reconciled != reconciled:
                was_reconciled = account_transaction.is_reconciled
                account_transaction.is_reconciled = reconciled
                account_transaction.reconciled_at = timezone.now() if reconciled else None
                account_transaction.save(update_fields=["is_reconciled", "reconciled_at", "updated_at"])
                AccountReconciliationEvent.objects.create(
                    transaction=account_transaction,
                    reconciled=reconciled,
                    note=payload.validated_data.get("note", ""),
                    created_by=request.user,
                )
                log_staff_activity(
                    request.user,
                    "financial_transaction_reconciled" if reconciled else "financial_transaction_unreconciled",
                    f"Updated reconciliation status for transaction {account_transaction.id}",
                    actor=request.user,
                    request=request,
                    object_type="account_transaction",
                    object_id=account_transaction.id,
                    metadata={"before": {"is_reconciled": was_reconciled},
                              "after": {"is_reconciled": reconciled, "note": payload.validated_data.get("note", "")}},
                )
        return Response(self.get_serializer(account_transaction).data)


class AccountTransferViewSet(
    mixins.ListModelMixin,
    mixins.CreateModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AccountTransferSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "head", "options"]

    def get_queryset(self):
        return AccountTransfer.objects.filter(user=self.request.user, is_deleted=False).select_related(
            "from_account", "to_account"
        )

    def create(self, request, *args, **kwargs):
        require_staff_operation(request, "financial.adjust")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        key = serializer.validated_data.get("idempotency_key", "")
        was_existing = bool(key and AccountTransfer.objects.filter(user=request.user, idempotency_key=key).exists())
        transfer = serializer.save()
        if not was_existing:
            log_staff_activity(
                request.user,
                "financial_account_transfer_recorded",
                f"Transferred {transfer.amount_from} from {transfer.from_account.name} to {transfer.to_account.name}",
                actor=request.user,
                request=request,
                object_type="account_transfer",
                object_id=transfer.id,
                metadata={"after": {"from_account_id": transfer.from_account_id,
                                    "to_account_id": transfer.to_account_id,
                                    "amount_from": str(transfer.amount_from),
                                    "amount_to": str(transfer.amount_to),
                                    "transaction_date": transfer.transaction_date.isoformat()}},
            )
        result = self.get_serializer(transfer)
        return Response(result.data, status=status.HTTP_201_CREATED)
