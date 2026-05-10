from decimal import Decimal
import qrcode
from urllib.parse import quote
from django.utils import timezone
from django.core.files.base import ContentFile
from io import BytesIO
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from accounts.activity import log_staff_activity
from billing.services import enforce_feature, enforce_limit
from notifications.models import NotificationLog
from .models import CreditTransaction, Customer, LoyaltyTransaction
from .serializers import CreditTransactionSerializer, CustomerSerializer, LoyaltyTransactionSerializer


class CustomerViewSet(viewsets.ModelViewSet):
    serializer_class = CustomerSerializer
    search_fields = ["name", "phone", "qr_code"]
    filterset_fields = ["badge"]

    def get_queryset(self):
        return Customer.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        enforce_limit(self.request.user, "customers")
        customer = serializer.save(user=self.request.user)
        log_staff_activity(self.request.user, "customer_created", f"Created customer {customer.name}", actor=self.request.user, object_type="customer", object_id=customer.id)

    def perform_update(self, serializer):
        customer = serializer.save()
        log_staff_activity(self.request.user, "customer_updated", f"Updated customer {customer.name}", actor=self.request.user, object_type="customer", object_id=customer.id)

    @action(detail=True, methods=["post"], url_path="add-credit")
    def add_credit(self, request, pk=None):
        enforce_feature(request.user, "qr_loyalty")
        customer = self.get_object()
        amount = Decimal(str(request.data.get("amount", "0")))
        customer.credits += amount
        customer.save()
        CreditTransaction.objects.create(customer=customer, amount=amount, type="add", reason=request.data.get("reason", ""))
        return Response(CustomerSerializer(customer).data)

    @action(detail=False, methods=["get"], url_path="collections")
    def collections(self, request):
        enforce_feature(request.user, "customer_credit")
        now = timezone.now()
        rows = []
        for customer in self.get_queryset().filter(debt_amount__gt=0).order_by("-debt_amount"):
            debt_date = customer.debt_started_at or customer.debt_updated_at or customer.created_at
            age_days = max((now - debt_date).days, 0) if debt_date else 0
            if age_days >= 30:
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
        customer = self.get_object()
        amount = Decimal(str(request.data.get("amount", "0")))
        if amount <= 0:
            return Response({"detail": "Amount must be greater than zero."}, status=400)
        if customer.debt_amount <= 0:
            customer.debt_started_at = timezone.now()
        customer.debt_amount += amount
        customer.debt_updated_at = timezone.now()
        customer.debt_notes = request.data.get("reason", customer.debt_notes)
        customer.save(update_fields=["debt_amount", "debt_started_at", "debt_updated_at", "debt_notes", "updated_at"])
        CreditTransaction.objects.create(customer=customer, amount=amount, type="debt", reason=request.data.get("reason", "Debt added"))
        log_staff_activity(request.user, "customer_debt_added", f"Added debt for {customer.name}", actor=request.user, object_type="customer", object_id=customer.id, metadata={"amount": str(amount)})
        return Response(CustomerSerializer(customer).data)

    @action(detail=True, methods=["post"], url_path="record-payment")
    def record_payment(self, request, pk=None):
        enforce_feature(request.user, "customer_credit")
        customer = self.get_object()
        amount = Decimal(str(request.data.get("amount", "0")))
        if amount <= 0:
            return Response({"detail": "Amount must be greater than zero."}, status=400)
        payment = min(amount, customer.debt_amount)
        customer.debt_amount -= payment
        customer.debt_updated_at = timezone.now()
        if customer.debt_amount <= 0:
            customer.debt_started_at = None
        customer.save(update_fields=["debt_amount", "debt_started_at", "debt_updated_at", "updated_at"])
        CreditTransaction.objects.create(customer=customer, amount=payment, type="payment", reason=request.data.get("reason", "Debt payment"))
        log_staff_activity(request.user, "customer_payment_recorded", f"Recorded payment from {customer.name}", actor=request.user, object_type="customer", object_id=customer.id, metadata={"amount": str(payment)})
        return Response(CustomerSerializer(customer).data)

    @action(detail=True, methods=["post"], url_path="collection-reminder")
    def collection_reminder(self, request, pk=None):
        enforce_feature(request.user, "customer_credit")
        customer = self.get_object()
        message = request.data.get("message") or (
            f"Hi {customer.name}, this is a friendly Verifin reminder that your outstanding balance is "
            f"{request.user.currency_symbol}{customer.debt_amount}. Please let us know when you can settle it."
        )
        log = NotificationLog.objects.create(user=request.user, type="collection_reminder", message=message, channel="whatsapp")
        log_staff_activity(request.user, "collection_reminder_prepared", f"Prepared collection reminder for {customer.name}", actor=request.user, object_type="customer", object_id=customer.id)
        return Response({"message": message, "whatsapp_url": f"https://wa.me/{customer.phone}?text={quote(message)}" if customer.phone else "", "log_id": log.id})

    @action(detail=True, methods=["post"], url_path="redeem-credit")
    def redeem_credit(self, request, pk=None):
        enforce_feature(request.user, "qr_loyalty")
        customer = self.get_object()
        amount = Decimal(str(request.data.get("amount", "0")))
        if amount > customer.credits:
            return Response({"detail": "Insufficient credit."}, status=400)
        customer.credits -= amount
        customer.save()
        CreditTransaction.objects.create(customer=customer, amount=amount, type="redeem", reason=request.data.get("reason", ""))
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
        return LoyaltyTransaction.objects.filter(customer__user=self.request.user, is_deleted=False)


class CreditTransactionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = CreditTransactionSerializer

    def get_queryset(self):
        return CreditTransaction.objects.filter(customer__user=self.request.user, is_deleted=False)
