from decimal import Decimal
import qrcode
from django.core.files.base import ContentFile
from io import BytesIO
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import CreditTransaction, Customer, LoyaltyTransaction
from .serializers import CreditTransactionSerializer, CustomerSerializer, LoyaltyTransactionSerializer


class CustomerViewSet(viewsets.ModelViewSet):
    serializer_class = CustomerSerializer
    search_fields = ["name", "phone", "qr_code"]
    filterset_fields = ["badge"]

    def get_queryset(self):
        return Customer.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=True, methods=["post"], url_path="add-credit")
    def add_credit(self, request, pk=None):
        customer = self.get_object()
        amount = Decimal(str(request.data.get("amount", "0")))
        customer.credits += amount
        customer.save()
        CreditTransaction.objects.create(customer=customer, amount=amount, type="add", reason=request.data.get("reason", ""))
        return Response(CustomerSerializer(customer).data)

    @action(detail=True, methods=["post"], url_path="redeem-credit")
    def redeem_credit(self, request, pk=None):
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
