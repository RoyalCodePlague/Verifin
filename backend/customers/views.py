from decimal import Decimal, InvalidOperation
import qrcode
from urllib.parse import quote
from django.db import transaction
from django.utils import timezone
from django.core.files.base import ContentFile
from io import BytesIO
from rest_framework import viewsets
from accounts.branch_access import scope_queryset_to_staff_branch
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.exceptions import ValidationError
from accounts.activity import log_staff_activity
from billing.services import enforce_feature, enforce_limit
from notifications.models import NotificationLog
from .models import CreditTransaction, Customer, LoyaltyTransaction
from .financial_services import apply_customer_payment, refresh_customer_debt_due_date
from .serializers import CreditTransactionSerializer, CustomerSerializer, LoyaltyTransactionSerializer
from sales.models import Sale
from core.currency import normalize_allocations


class CustomerViewSet(viewsets.ModelViewSet):
    serializer_class = CustomerSerializer
    search_fields = ["name", "phone", "qr_code"]
    filterset_fields = ["badge"]

    def get_queryset(self):
        queryset = Customer.objects.filter(user=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset)

    def perform_create(self, serializer):
        enforce_limit(self.request.user, "customers")
        customer = serializer.save(user=self.request.user)
        log_staff_activity(
            self.request.user, "customer_created", f"Created customer {customer.name}",
            actor=self.request.user, request=self.request, object_type="customer", object_id=customer.id,
            metadata={"after": {"name": customer.name, "phone": customer.phone, "branch_id": customer.branch_id}},
        )

    def perform_update(self, serializer):
        previous = serializer.instance
        before = {"name": previous.name, "phone": previous.phone, "branch_id": previous.branch_id}
        customer = serializer.save()
        after = {"name": customer.name, "phone": customer.phone, "branch_id": customer.branch_id}
        log_staff_activity(
            self.request.user, "customer_updated", f"Updated customer {customer.name}",
            actor=self.request.user, request=self.request, object_type="customer", object_id=customer.id,
            metadata={"before": before, "after": after},
        )

    def perform_destroy(self, instance):
        before = {"name": instance.name, "phone": instance.phone, "branch_id": instance.branch_id}
        instance.is_deleted = True
        instance.save(update_fields=["is_deleted", "updated_at"])
        log_staff_activity(
            self.request.user, "customer_deleted", f"Archived customer {instance.name}",
            actor=self.request.user, request=self.request, object_type="customer", object_id=instance.id,
            metadata={"before": before, "after": {"is_deleted": True}},
        )

    @action(detail=True, methods=["post"], url_path="add-credit")
    def add_credit(self, request, pk=None):
        enforce_feature(request.user, "qr_loyalty")
        amount = Decimal(str(request.data.get("amount", "0")))
        if amount <= 0:
            return Response({"detail": "Amount must be greater than zero."}, status=400)
        with transaction.atomic():
            customer = Customer.objects.select_for_update().get(pk=self.get_object().pk, user=request.user, is_deleted=False)
            credits_before = customer.credits
            customer.credits += amount
            customer.save(update_fields=["credits", "updated_at"])
            CreditTransaction.objects.create(customer=customer, amount=amount, type="add", reason=request.data.get("reason", ""))
        log_staff_activity(
            request.user, "customer_credit_added", f"Added store credit for {customer.name}",
            actor=request.user, request=request, object_type="customer", object_id=customer.id,
            metadata={"before": {"credits": str(credits_before)}, "after": {"credits": str(customer.credits)}, "amount": str(amount)},
        )
        return Response(CustomerSerializer(customer).data)

    @action(detail=False, methods=["get"], url_path="collections")
    def collections(self, request):
        enforce_feature(request.user, "customer_credit")
        now = timezone.now()
        rows = []
        for customer in self.get_queryset().filter(debt_amount__gt=0).order_by("-debt_amount"):
            debt_date = customer.debt_started_at or customer.debt_updated_at or customer.created_at
            age_days = max((now - debt_date).days, 0) if debt_date else 0
            overdue_days = max((timezone.localdate() - customer.debt_due_date).days, 0) if customer.debt_due_date else 0
            if overdue_days > 0 or age_days >= 30:
                priority = "urgent"
            elif age_days >= 14:
                priority = "high"
            elif age_days >= 7:
                priority = "medium"
            else:
                priority = "new"
            rows.append({
                "customer": CustomerSerializer(customer).data,
                "age_days": age_days,
                "due_date": customer.debt_due_date,
                "overdue_days": overdue_days,
                "priority": priority,
                "suggested_message": (
                    f"Hi {customer.name}, this is a friendly Verifin reminder that your outstanding balance is "
                    f"{request.user.currency_symbol}{customer.debt_amount}. Please let us know when you can settle it."
                ),
            })
        return Response({"items": rows})

    @action(detail=True, methods=["post"], url_path="add-debt")
    def add_debt(self, request, pk=None):
        enforce_feature(request.user, "customer_credit")
        try:
            amount = Decimal(str(request.data.get("amount", "0")))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"amount": "Enter a valid amount."}, status=400)
        if not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2:
            return Response({"amount": "Amount must be greater than zero."}, status=400)
        key = str(request.data.get("idempotency_key", "")).strip()
        if len(key) > 120:
            return Response({"idempotency_key": "Ensure this field has no more than 120 characters."}, status=400)
        customer_id = self.get_object().pk
        due_date = None
        if request.data.get("due_date"):
            from django.utils.dateparse import parse_date
            due_date = parse_date(request.data.get("due_date"))
            if due_date is None:
                return Response({"due_date": "Enter a valid date in YYYY-MM-DD format."}, status=400)
        with transaction.atomic():
            customer = Customer.objects.select_for_update().get(pk=customer_id, user=request.user, is_deleted=False)
            existing = CreditTransaction.objects.filter(customer=customer, idempotency_key=key).first() if key else None
            if existing:
                if (
                    existing.type == "debt"
                    and existing.amount == amount
                    and existing.due_date == due_date
                    and existing.reason == request.data.get("reason", "Debt added")
                ):
                    response = Response(CustomerSerializer(customer).data)
                    response["Idempotent-Replay"] = "true"
                    return response
                return Response({"idempotency_key": "This key was already used for a different credit transaction."}, status=409)
            if customer.credit_limit is not None and customer.debt_amount + amount > customer.credit_limit:
                return Response({"amount": "This amount exceeds the customer's available credit limit."}, status=400)
            debt_before = customer.debt_amount
            if customer.debt_amount <= 0:
                customer.debt_started_at = timezone.now()
            customer.debt_amount += amount
            customer.debt_updated_at = timezone.now()
            customer.debt_notes = request.data.get("reason", customer.debt_notes)
            customer.save(update_fields=["debt_amount", "debt_started_at", "debt_updated_at", "debt_notes", "updated_at"])
            CreditTransaction.objects.create(
                customer=customer, amount=amount, type="debt",
                reason=request.data.get("reason", "Debt added"), idempotency_key=key,
                due_date=due_date,
            )
            refresh_customer_debt_due_date(customer)
        log_staff_activity(
            request.user, "customer_debt_added", f"Added debt for {customer.name}",
            actor=request.user, request=request, object_type="customer", object_id=customer.id,
            metadata={"before": {"debt_amount": str(debt_before)}, "after": {"debt_amount": str(customer.debt_amount)}, "amount": str(amount)},
        )
        return Response(CustomerSerializer(customer).data)

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        enforce_feature(request.user, "customer_credit")
        try:
            amount = Decimal(str(request.data.get("amount", "0")))
        except (InvalidOperation, TypeError, ValueError):
            return Response({"amount": "Enter a valid amount."}, status=400)
        if not amount.is_finite() or amount <= 0 or amount.as_tuple().exponent < -2:
            return Response({"amount": "Enter an amount greater than zero with at most two decimal places."}, status=400)
        amount = amount.quantize(Decimal("0.01"))
        key = str(request.data.get("idempotency_key", "")).strip()
        if not key:
            return Response({"idempotency_key": "A unique idempotency key is required for payments."}, status=400)
        if len(key) > 120:
            return Response({"idempotency_key": "Ensure this field has no more than 120 characters."}, status=400)
        try:
            allocations, allocations_total = normalize_allocations(
                request.user,
                request.data.get("payment_allocations", []),
                amount,
                request.user.currency,
                Decimal("1"),
                field_name="payment_allocations",
            )
        except ValidationError as exc:
            return Response(exc.detail, status=400)
        if allocations_total != amount:
            return Response({"payment_allocations": "Allocations must add up to the collection amount in the business currency."}, status=400)
        customer_id = self.get_object().pk
        with transaction.atomic():
            customer = Customer.objects.select_for_update().get(pk=customer_id, user=request.user, is_deleted=False)
            existing = CreditTransaction.objects.filter(customer=customer, idempotency_key=key).first()
            if existing:
                legacy_no_allocations = not existing.payment_allocations and not request.data.get("payment_allocations")
                if (
                    existing.type == "payment"
                    and existing.amount == amount
                    and existing.reason == request.data.get("reason", "Debt payment")
                    and (existing.payment_allocations == allocations or legacy_no_allocations)
                ):
                    response = Response(CustomerSerializer(customer).data)
                    response["Idempotent-Replay"] = "true"
                    return response
                return Response({"idempotency_key": "This key was already used for a different credit transaction."}, status=409)
            if amount > customer.debt_amount:
                return Response({"amount": f"Payment exceeds the outstanding balance of {customer.debt_amount:.2f}."}, status=400)

            debt_before = customer.debt_amount
            apply_customer_payment(customer, amount)

            customer.debt_amount -= amount
            customer.debt_updated_at = timezone.now()
            if customer.debt_amount <= 0:
                customer.debt_started_at = None
            customer.save(update_fields=["debt_amount", "debt_started_at", "debt_updated_at", "updated_at"])
            refresh_customer_debt_due_date(customer)
            credit_transaction = CreditTransaction.objects.create(
                customer=customer, amount=amount, type="payment",
                reason=request.data.get("reason", "Debt payment"), idempotency_key=key,
                payment_allocations=allocations,
            )
            from reports.financial_services import post_allocations_to_accounts

            post_allocations_to_accounts(
                user=request.user,
                allocations=allocations,
                direction="in",
                entry_type="customer_collection",
                transaction_date=timezone.localdate(),
                description=f"Customer collection from {customer.name}",
                source_key=f"customer-payment:{credit_transaction.pk}:collection",
                created_by=request.user,
                reference=key,
            )
        log_staff_activity(
            request.user, "customer_payment_recorded", f"Recorded payment from {customer.name}",
            actor=request.user, request=request, object_type="credit_transaction", object_id=credit_transaction.id,
            metadata={"customer_id": customer.id, "before": {"debt_amount": str(debt_before)},
                      "after": {"debt_amount": str(customer.debt_amount)}, "amount": str(amount),
                      "payment_allocations": allocations},
        )
        return Response(CustomerSerializer(customer).data)

    @action(detail=True, methods=["get"], url_path="statement")
    def statement(self, request, pk=None):
        """A printable, shareable debt statement backed by the transaction ledger."""
        enforce_feature(request.user, "customer_credit")
        customer = self.get_object()
        transactions = CreditTransaction.objects.filter(customer=customer, is_deleted=False).order_by("created_at")
        invoices = Sale.objects.filter(
            created_by=request.user, customer=customer, is_deleted=False
        ).order_by("date", "id").values(
            "id", "invoice_number", "date", "due_date", "total", "amount_paid_base", "balance_due", "payment_method"
        )
        return Response({
            "customer": CustomerSerializer(customer).data,
            "currency_symbol": request.user.currency_symbol,
            "generated_at": timezone.now(),
            "invoices": list(invoices),
            "transactions": CreditTransactionSerializer(transactions, many=True).data,
        })

    @action(detail=True, methods=["post"], url_path="collection-reminder")
    def collection_reminder(self, request, pk=None):
        enforce_feature(request.user, "customer_credit")
        customer = self.get_object()
        message = request.data.get("message") or (
            f"Hi {customer.name}, this is a friendly Verifin reminder that your outstanding balance is "
            f"{request.user.currency_symbol}{customer.debt_amount}. Please let us know when you can settle it."
        )
        log = NotificationLog.objects.create(user=request.user, type="collection_reminder", message=message, channel="whatsapp")
        log_staff_activity(request.user, "collection_reminder_prepared", f"Prepared collection reminder for {customer.name}", actor=request.user, request=request, object_type="customer", object_id=customer.id)
        return Response({"message": message, "whatsapp_url": f"https://wa.me/{customer.phone}?text={quote(message)}" if customer.phone else "", "log_id": log.id})

    @action(detail=True, methods=["post"], url_path="redeem-credit")
    def redeem_credit(self, request, pk=None):
        enforce_feature(request.user, "qr_loyalty")
        amount = Decimal(str(request.data.get("amount", "0")))
        if amount <= 0:
            return Response({"detail": "Amount must be greater than zero."}, status=400)
        with transaction.atomic():
            customer = Customer.objects.select_for_update().get(pk=self.get_object().pk, user=request.user, is_deleted=False)
            if amount > customer.credits:
                return Response({"detail": "Insufficient credit."}, status=400)
            credits_before = customer.credits
            customer.credits -= amount
            customer.save(update_fields=["credits", "updated_at"])
            CreditTransaction.objects.create(customer=customer, amount=amount, type="redeem", reason=request.data.get("reason", ""))
        log_staff_activity(
            request.user, "customer_credit_redeemed", f"Redeemed store credit for {customer.name}",
            actor=request.user, request=request, object_type="customer", object_id=customer.id,
            metadata={"before": {"credits": str(credits_before)}, "after": {"credits": str(customer.credits)}, "amount": str(amount)},
        )
        return Response(CustomerSerializer(customer).data)

    @action(detail=True, methods=["get"], url_path="qr")
    def qr(self, request, pk=None):
        enforce_feature(request.user, "qr_loyalty")
        customer = self.get_object()
        img = qrcode.make(f"customer:{customer.id}:{customer.qr_code}")
        buffer = BytesIO()
        img.save(buffer, format="PNG")
        return Response({"qr_code": customer.qr_code, "png_bytes": len(buffer.getvalue())})


class LoyaltyTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = LoyaltyTransactionSerializer

    def get_queryset(self):
        queryset = LoyaltyTransaction.objects.filter(customer__user=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset, "customer__branch_id")


class CreditTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = CreditTransactionSerializer

    def get_queryset(self):
        queryset = CreditTransaction.objects.filter(customer__user=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset, "customer__branch_id")
