import csv
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from io import StringIO
import re

from django.db.models import Count, Q, Sum
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from expenses.models import Expense
from inventory.models import SupplierPayment
from sales.models import Sale
from .models import BankAccount, BankStatementLine


class BankAccountSerializer(serializers.ModelSerializer):
    statement_balance = serializers.SerializerMethodField()
    unreconciled_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = BankAccount
        fields = [
            "id", "name", "currency", "opening_balance", "is_active",
            "statement_balance", "unreconciled_count", "created_at",
        ]
        read_only_fields = ["created_at"]

    def get_statement_balance(self, account):
        return str(account.opening_balance + getattr(account, "statement_total", Decimal("0")))

    def validate_currency(self, value):
        user = self.context["request"].user
        currency = value.strip().upper()
        enabled = set(user.enabled_currencies or [])
        enabled.add(user.currency)
        if currency not in enabled:
            raise serializers.ValidationError("Enable this currency in Settings before adding an account.")
        return currency


class BankStatementLineSerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    is_reconciled = serializers.SerializerMethodField()
    matched_transaction_type = serializers.SerializerMethodField()
    matched_transaction_id = serializers.SerializerMethodField()

    class Meta:
        model = BankStatementLine
        fields = [
            "id", "account", "account_name", "transaction_date", "description",
            "reference", "amount", "is_reconciled", "matched_transaction_type",
            "matched_transaction_id", "matched_at",
        ]

    def get_is_reconciled(self, line):
        return bool(line.matched_at)

    def get_matched_transaction_type(self, line):
        if line.matched_sale_id:
            return "sale"
        if line.matched_expense_id:
            return "expense"
        if line.matched_supplier_payment_id:
            return "supplier_payment"
        return None

    def get_matched_transaction_id(self, line):
        return line.matched_sale_id or line.matched_expense_id or line.matched_supplier_payment_id


def _fingerprint(transaction_date, description, reference, amount):
    normalized = "|".join(
        [
            transaction_date.isoformat(),
            description.strip().casefold(),
            reference.strip().casefold(),
            str(amount),
        ]
    )
    return sha256(normalized.encode("utf-8")).hexdigest()


def _parse_statement_date(value, row_number):
    value = (value or "").strip()
    for date_format in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(value, date_format).date()
        except ValueError:
            continue
    raise serializers.ValidationError({"file": f"Row {row_number}: use YYYY-MM-DD or DD/MM/YYYY for the date."})


def _parse_statement_csv(upload):
    if upload is None:
        raise serializers.ValidationError({"file": "Choose a CSV statement file."})
    if upload.size > 5 * 1024 * 1024:
        raise serializers.ValidationError({"file": "Statement files must be 5 MB or smaller."})
    try:
        content = upload.read().decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise serializers.ValidationError({"file": "The CSV must use UTF-8 encoding."}) from exc

    try:
        reader = csv.DictReader(StringIO(content))
        headers = {str(name or "").strip().casefold(): name for name in reader.fieldnames or []}
        date_key = next((headers[key] for key in ("date", "transaction_date") if key in headers), None)
        description_key = next((headers[key] for key in ("description", "memo", "details") if key in headers), None)
        amount_key = headers.get("amount")
        reference_key = next((headers[key] for key in ("reference", "ref", "transaction_id") if key in headers), None)
        if not date_key or not description_key or not amount_key:
            raise serializers.ValidationError({
                "file": "CSV needs date, description, and amount columns. Reference is optional."
            })

        rows = []
        for row_number, row in enumerate(reader, start=2):
            if row_number > 5001:
                raise serializers.ValidationError({"file": "A statement can contain at most 5,000 rows."})
            try:
                transaction_date = _parse_statement_date(row.get(date_key), row_number)
                description = (row.get(description_key) or "").strip()
                reference = (row.get(reference_key) or "").strip() if reference_key else ""
                amount_text = (row.get(amount_key) or "").strip()
                if not re.fullmatch(r"-?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?", amount_text):
                    raise ValueError("Invalid amount format")
                amount_text = amount_text.replace(",", "")
                amount = Decimal(amount_text)
            except (InvalidOperation, TypeError, ValueError) as exc:
                raise serializers.ValidationError({"file": f"Row {row_number}: enter a valid amount."}) from exc
            if not description or len(description) > 255:
                raise serializers.ValidationError({"file": f"Row {row_number}: description must be 1-255 characters."})
            if len(reference) > 120:
                raise serializers.ValidationError({"file": f"Row {row_number}: reference must be 120 characters or fewer."})
            if not amount.is_finite() or amount == 0 or amount.as_tuple().exponent < -2:
                raise serializers.ValidationError({"file": f"Row {row_number}: amount must be non-zero with at most two decimals."})
            rows.append((transaction_date, description, reference, amount.quantize(Decimal("0.01"))))
        if not rows:
            raise serializers.ValidationError({"file": "The CSV does not contain any statement rows."})
        return rows
    except csv.Error as exc:
        raise serializers.ValidationError({"file": "The uploaded file is not a valid CSV."}) from exc


class BankAccountViewSet(viewsets.ModelViewSet):
    serializer_class = BankAccountSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        return (
            BankAccount.objects.filter(user=self.request.user, is_deleted=False)
            .annotate(
                statement_total=Coalesce(
                    Sum("statement_lines__amount", filter=Q(statement_lines__is_deleted=False)),
                    Decimal("0"),
                ),
                unreconciled_count=Count(
                    "statement_lines",
                    filter=Q(statement_lines__is_deleted=False, statement_lines__matched_at__isnull=True),
                ),
            )
        )

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    def perform_destroy(self, instance):
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted", "updated_at"])

    @action(detail=True, methods=["post"], parser_classes=[MultiPartParser, FormParser], url_path="import-statement")
    def import_statement(self, request, pk=None):
        account = self.get_object()
        rows = _parse_statement_csv(request.FILES.get("file"))
        created = 0
        skipped = 0
        for transaction_date, description, reference, amount in rows:
            fingerprint = _fingerprint(transaction_date, description, reference, amount)
            _, was_created = BankStatementLine.objects.get_or_create(
                account=account,
                fingerprint=fingerprint,
                defaults={
                    "transaction_date": transaction_date,
                    "description": description,
                    "reference": reference,
                    "amount": amount,
                },
            )
            created += int(was_created)
            skipped += int(not was_created)
        return Response({"created": created, "skipped": skipped}, status=status.HTTP_201_CREATED)


class BankStatementLineViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = BankStatementLineSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = BankStatementLine.objects.filter(
            account__user=self.request.user,
            account__is_deleted=False,
            is_deleted=False,
        ).select_related("account", "matched_sale", "matched_expense", "matched_supplier_payment")
        account_id = self.request.query_params.get("account")
        if account_id:
            queryset = queryset.filter(account_id=account_id)
        if self.request.query_params.get("status") == "unmatched":
            queryset = queryset.filter(matched_at__isnull=True)
        elif self.request.query_params.get("status") == "matched":
            queryset = queryset.filter(matched_at__isnull=False)
        return queryset

    @action(detail=True, methods=["get"], url_path="candidates")
    def candidates(self, request, pk=None):
        line = self.get_object()
        account = line.account
        currency = account.currency
        candidates = []
        date_from = line.transaction_date - timedelta(days=14)
        date_to = line.transaction_date + timedelta(days=14)

        def allocations_amount(allocations):
            return sum(
                (Decimal(str(row.get("amount", "0"))) for row in allocations or [] if row.get("currency") == currency),
                Decimal("0"),
            )

        if line.amount > 0:
            sales = Sale.objects.filter(
                created_by=request.user,
                is_deleted=False,
                date__gte=date_from,
                date__lte=date_to,
                payment_method__in=["EFT", "Card"],
                bank_statement_match__isnull=True,
            ).order_by("-date", "-id")[:1000]
            for sale in sales:
                amount = allocations_amount(sale.payment_allocations)
                if amount == line.amount:
                    candidates.append({
                        "type": "sale",
                        "id": sale.id,
                        "date": sale.date,
                        "amount": str(amount),
                        "label": f"Sale {sale.receipt_number or sale.id} - {sale.payment_method}",
                    })
        else:
            expenses = Expense.objects.filter(
                created_by=request.user,
                is_deleted=False,
                date__gte=date_from,
                date__lte=date_to,
                bank_statement_match__isnull=True,
            ).order_by("-date", "-id")[:1000]
            for expense in expenses:
                amount = allocations_amount(expense.payment_allocations)
                if amount == abs(line.amount):
                    candidates.append({
                        "type": "expense",
                        "id": expense.id,
                        "date": expense.date,
                        "amount": str(amount),
                        "label": expense.description,
                    })

            supplier_payments = SupplierPayment.objects.filter(
                user=request.user,
                is_deleted=False,
                currency=currency,
                method__in=["bank", "card"],
                payment_date__gte=date_from,
                payment_date__lte=date_to,
                bank_statement_match__isnull=True,
            ).order_by("-payment_date", "-id")[:1000]
            for payment in supplier_payments:
                if payment.amount == abs(line.amount):
                    candidates.append({
                        "type": "supplier_payment",
                        "id": payment.id,
                        "date": payment.payment_date,
                        "amount": str(payment.amount),
                        "label": f"Supplier payment - {payment.supplier.name}",
                    })

        return Response(candidates[:100])

    @action(detail=True, methods=["post"], url_path="match")
    def match(self, request, pk=None):
        line = self.get_object()
        if line.matched_at:
            return Response({"detail": "This statement line is already reconciled."}, status=status.HTTP_400_BAD_REQUEST)
        transaction_type = request.data.get("transaction_type")
        try:
            transaction_id = int(request.data.get("transaction_id"))
        except (TypeError, ValueError):
            raise serializers.ValidationError({"transaction_id": "Provide a valid transaction ID."})

        if transaction_type == "sale" and line.amount > 0:
            transaction = Sale.objects.filter(
                id=transaction_id,
                created_by=request.user,
                is_deleted=False,
                payment_method__in=["EFT", "Card"],
                bank_statement_match__isnull=True,
            ).first()
            amount = sum(
                (
                    Decimal(str(row.get("amount", "0")))
                    for row in (transaction.payment_allocations if transaction else [])
                    if row.get("currency") == line.account.currency
                ),
                Decimal("0"),
            )
            field_name = "matched_sale"
        elif transaction_type == "expense" and line.amount < 0:
            transaction = Expense.objects.filter(
                id=transaction_id,
                created_by=request.user,
                is_deleted=False,
                bank_statement_match__isnull=True,
            ).first()
            allocations_amount = sum(
                (
                    Decimal(str(row.get("amount", "0")))
                    for row in (transaction.payment_allocations if transaction else [])
                    if row.get("currency") == line.account.currency
                ),
                Decimal("0"),
            )
            amount = -allocations_amount
            field_name = "matched_expense"
        elif transaction_type == "supplier_payment" and line.amount < 0:
            transaction = SupplierPayment.objects.filter(
                id=transaction_id,
                user=request.user,
                is_deleted=False,
                currency=line.account.currency,
                method__in=["bank", "card"],
                bank_statement_match__isnull=True,
            ).first()
            amount = -transaction.amount if transaction else Decimal("0")
            field_name = "matched_supplier_payment"
        else:
            raise serializers.ValidationError({"transaction_type": "The transaction type does not match the statement amount direction."})

        if not transaction:
            raise serializers.ValidationError({"transaction_id": "Transaction not found or already reconciled."})
        if amount != line.amount:
            raise serializers.ValidationError({"transaction_id": "Transaction amount or currency does not match this statement line."})

        setattr(line, field_name, transaction)
        line.matched_at = timezone.now()
        line.save(update_fields=[field_name, "matched_at", "updated_at"])
        return Response(BankStatementLineSerializer(line).data)

    @action(detail=True, methods=["post"], url_path="unmatch")
    def unmatch(self, request, pk=None):
        line = self.get_object()
        if not line.matched_at:
            return Response({"detail": "This statement line is not reconciled."}, status=status.HTTP_400_BAD_REQUEST)
        line.matched_sale = None
        line.matched_expense = None
        line.matched_supplier_payment = None
        line.matched_at = None
        line.save(update_fields=[
            "matched_sale", "matched_expense", "matched_supplier_payment", "matched_at", "updated_at",
        ])
        return Response(BankStatementLineSerializer(line).data)


class CashFlowSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        period_start = timezone.localdate() - timedelta(days=365)
        accounts = BankAccount.objects.filter(user=request.user, is_active=True, is_deleted=False).annotate(
            statement_total=Coalesce(
                Sum("statement_lines__amount", filter=Q(statement_lines__is_deleted=False)),
                Decimal("0"),
            ),
            unreconciled_count=Count(
                "statement_lines",
                filter=Q(statement_lines__is_deleted=False, statement_lines__matched_at__isnull=True),
            ),
        )
        monthly_rows = (
            BankStatementLine.objects.filter(
                account__user=request.user,
                account__is_deleted=False,
                account__is_active=True,
                is_deleted=False,
                transaction_date__gte=period_start,
            )
            .values("account_id", "account__name", "account__currency")
            .annotate(
                month=TruncMonth("transaction_date"),
                inflows=Coalesce(Sum("amount", filter=Q(amount__gt=0)), Decimal("0")),
                outflows=Coalesce(Sum("amount", filter=Q(amount__lt=0)), Decimal("0")),
            )
            .order_by("account_id", "month")
        )
        return Response({
            "accounts": [
                {
                    "id": account.id,
                    "name": account.name,
                    "currency": account.currency,
                    "balance": str(account.opening_balance + account.statement_total),
                    "unreconciled_count": account.unreconciled_count,
                }
                for account in accounts
            ],
            "monthly": [
                {
                    "account_id": row["account_id"],
                    "account_name": row["account__name"],
                    "currency": row["account__currency"],
                    "month": row["month"].date().isoformat() if hasattr(row["month"], "date") else row["month"].isoformat(),
                    "inflows": f'{row["inflows"].quantize(Decimal("0.01")):.2f}',
                    "outflows": f'{abs(row["outflows"]).quantize(Decimal("0.01")):.2f}',
                    "net": f'{(row["inflows"] + row["outflows"]).quantize(Decimal("0.01")):.2f}',
                }
                for row in monthly_rows
            ],
        })
