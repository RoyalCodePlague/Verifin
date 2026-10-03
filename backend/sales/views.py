from decimal import Decimal
from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from customers.models import Customer, LoyaltyTransaction
from inventory.models import Product, StockMovement
from django.db.models import Sum
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek
from urllib.parse import quote
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from accounts.activity import log_staff_activity
from billing.services import enforce_feature
from core.currency import get_rate_to_base, normalize_allocations
from notifications.models import NotificationLog
from .models import Sale, SaleItem, TillSession
from .serializers import SaleItemReadSerializer, SaleItemSerializer, SaleSerializer, TillSessionSerializer


def build_receipt_payload(sale, user):
    return {
        "receipt_number": sale.receipt_number,
        "invoice_number": sale.invoice_number,
        "business_name": user.business_name,
        "branch": sale.branch.name if sale.branch else "",
        "date": sale.date,
        "time": sale.time,
        "payment_method": sale.payment_method,
        "payment_currency": sale.payment_currency,
        "payment_allocations": sale.payment_allocations,
        "items": SaleItemReadSerializer(sale.sale_items.all(), many=True).data,
        "subtotal": sale.total,
        "total": sale.total,
        "customer": sale.customer.name if sale.customer else "",
        "customer_phone": sale.customer.phone if sale.customer else "",
    }


def build_receipt_message(payload, currency_symbol):
    lines = [
        payload["business_name"] or "Verifin Receipt",
        f"Receipt: {payload['receipt_number']}",
        f"Invoice: {payload['invoice_number']}" if payload.get("invoice_number") else "",
        f"{payload['date']} {payload['time']}",
        f"Payment: {payload['payment_method']}",
        f"Currency: {payload['payment_currency']}" if payload.get("payment_currency") else "",
        "",
        *[
            f"{item['quantity']} {item.get('product_name') or 'Item'} - {currency_symbol}{item.get('subtotal')}"
            for item in payload["items"]
        ],
        "",
        f"Total: {currency_symbol}{payload['total']}",
        "Thank you for shopping with us.",
    ]
    return "\n".join([line for line in lines if line != ""])


class SaleViewSet(viewsets.ModelViewSet):
    http_method_names = ["get", "post", "delete", "head", "options"]
    serializer_class = SaleSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["payment_method", "customer"]

    def get_queryset(self):
        return Sale.objects.filter(created_by=self.request.user, is_deleted=False)

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if hasattr(request, "api_key") and request.method == "DELETE":
            from accounts.authentication import require_area
            require_area(request, "sales")

    def perform_create(self, serializer):
        till_session = serializer.validated_data.get("till_session")
        if not till_session:
            till_session = TillSession.objects.filter(user=self.request.user, status="open", is_deleted=False).order_by("-opened_at").first()
        sale = serializer.save(created_by=self.request.user, till_session=till_session)
        from core.analytics import record_activation_event
        record_activation_event(self.request.user, "first_sale_recorded")
        log_staff_activity(
            self.request.user,
            "sale_created",
            f"Created sale {sale.receipt_number} for {self.request.user.currency_symbol}{sale.total}",
            actor=self.request.user,
            object_type="sale",
            object_id=sale.id,
        )

    def _matches_idempotent_sale(self, sale, validated_data):
        requested_items = sorted(
            (
                item["product"].pk,
                item["quantity"],
                str(Decimal(item["unit_price"]).quantize(Decimal("0.01"))),
            )
            for item in validated_data.get("sale_items", [])
        )
        existing_items = sorted(
            (
                item.product_id,
                item.quantity,
                str(item.unit_price.quantize(Decimal("0.01"))),
            )
            for item in sale.sale_items.filter(is_deleted=False)
        )
        if requested_items != existing_items:
            return False

        user = self.request.user
        payment_currency = validated_data.get("payment_currency") or user.currency
        payment_method = validated_data.get("payment_method", Sale._meta.get_field("payment_method").default)
        requested_total = sum(
            (Decimal(item["unit_price"]) * item["quantity"] for item in validated_data.get("sale_items", [])),
            Decimal("0"),
        )
        submitted_allocations = validated_data.get("payment_allocations", [])
        rate = get_rate_to_base(user, payment_currency) if not submitted_allocations else Decimal("1")
        expected_allocations, _ = normalize_allocations(
            user,
            submitted_allocations,
            (requested_total / rate).quantize(Decimal("0.01")),
            payment_currency,
            rate,
        )
        if payment_method != sale.payment_method or expected_allocations != sale.payment_allocations:
            return False

        branch = validated_data.get("branch")
        customer = validated_data.get("customer")
        if sale.branch_id != getattr(branch, "pk", None) or sale.customer_id != getattr(customer, "pk", None):
            return False
        if "till_session" in self.request.data:
            till_session = validated_data.get("till_session")
            if sale.till_session_id != getattr(till_session, "pk", None):
                return False
        return True

    def create(self, request, *args, **kwargs):
        integration_id = str(request.data.get("integration_id") or "").strip()
        if len(integration_id) > 120:
            return Response({"integration_id": ["Ensure this field has no more than 120 characters."]}, status=400)
        if integration_id:
            with transaction.atomic():
                from django.contrib.auth import get_user_model
                get_user_model().objects.select_for_update().get(pk=request.user.pk)
                serializer = self.get_serializer(data=request.data)
                serializer.is_valid(raise_exception=True)
                integration_id = serializer.validated_data.get("integration_id", "")
                existing = Sale.objects.filter(created_by=request.user, integration_id=integration_id).first() if integration_id else None
                if existing:
                    if existing.is_deleted:
                        return Response({"integration_id": ["This receipt ID has already been voided and cannot be reused."]}, status=409)
                    if not self._matches_idempotent_sale(existing, serializer.validated_data):
                        return Response({"integration_id": ["This receipt ID was already used with a different sale payload."]}, status=409)
                    response = Response(self.get_serializer(existing).data, status=200)
                    response["Idempotent-Replay"] = "true"
                    return response
                return super().create(request, *args, **kwargs)
        return super().create(request, *args, **kwargs)

    @transaction.atomic
    def perform_destroy(self, instance):
        sale = Sale.objects.select_for_update().get(pk=instance.pk)
        if sale.is_deleted:
            return
        for item in sale.sale_items.filter(is_deleted=False).order_by("product_id"):
            product = Product.objects.select_for_update().get(pk=item.product_id)
            product.stock += item.quantity
            product.save()
            StockMovement.objects.create(product=product, quantity=item.quantity, movement_type="in", created_by=self.request.user, reason=f"Reversed {sale.receipt_number}")
        if sale.customer_id:
            customer = Customer.objects.select_for_update().get(pk=sale.customer_id)
            points = int(sale.total // 10)
            customer.visits = max(0, customer.visits - 1)
            customer.total_spent -= sale.total
            customer.loyalty_points -= points
            previous = customer.sales.filter(is_deleted=False).exclude(pk=sale.pk).order_by("-created_at").first()
            customer.last_visit = previous.created_at if previous else None
            customer.save()
            LoyaltyTransaction.objects.create(customer=customer, points_change=-points, reason=f"Reversed sale {sale.receipt_number}")
        sale.is_deleted = True
        sale.save()
        sale.sale_items.update(is_deleted=True)
        if sale.till_session_id and sale.till_session.status == "closed":
            till = sale.till_session
            TillSessionSerializer(context={"request": self.request}).close(till, till.closing_cash, till.notes)

    @action(detail=False, methods=["get"], url_path="aggregations")
    def aggregations(self, request):
        qs = self.get_queryset()
        daily = qs.annotate(day=TruncDay("created_at")).values("day").annotate(total=Sum("total"), gross_profit=Sum("gross_profit")).order_by("-day")[:30]
        weekly = qs.annotate(week=TruncWeek("created_at")).values("week").annotate(total=Sum("total"), gross_profit=Sum("gross_profit")).order_by("-week")[:12]
        monthly = qs.annotate(month=TruncMonth("created_at")).values("month").annotate(total=Sum("total"), gross_profit=Sum("gross_profit")).order_by("-month")[:12]
        return Response({"daily": list(daily), "weekly": list(weekly), "monthly": list(monthly)})

    @action(detail=False, methods=["get"], url_path="profit-summary")
    def profit_summary(self, request):
        qs = self.get_queryset()
        branch = request.query_params.get("branch")
        if branch:
            qs = qs.filter(branch_id=branch)
        totals = qs.aggregate(
            revenue=Sum("total"),
            cost=Sum("total_cost"),
            gross_profit=Sum("gross_profit"),
        )
        revenue = totals["revenue"] or 0
        gross_profit = totals["gross_profit"] or 0
        margin = (gross_profit / revenue * 100) if revenue else 0
        return Response({
            "revenue": revenue,
            "cost": totals["cost"] or 0,
            "gross_profit": gross_profit,
            "margin_percent": margin,
        })

    @action(detail=True, methods=["get"], url_path="receipt")
    def receipt(self, request, pk=None):
        sale = self.get_object()
        return Response(build_receipt_payload(sale, request.user))

    @action(detail=True, methods=["post"], url_path="whatsapp-receipt")
    def whatsapp_receipt(self, request, pk=None):
        enforce_feature(request.user, "whatsapp_reports")
        sale = self.get_object()
        payload = build_receipt_payload(sale, request.user)
        message = request.data.get("message") or build_receipt_message(payload, request.user.currency_symbol)
        phone = (request.data.get("phone") or payload.get("customer_phone") or "").strip()
        whatsapp_url = f"https://wa.me/{phone}?text={quote(message)}" if phone else f"https://wa.me/?text={quote(message)}"
        log = NotificationLog.objects.create(user=request.user, type="customer_receipt", message=message, channel="whatsapp")
        log_staff_activity(
            request.user,
            "whatsapp_receipt_prepared",
            f"Prepared WhatsApp receipt {sale.receipt_number}",
            actor=request.user,
            object_type="sale",
            object_id=sale.id,
        )
        return Response({
            "message": message,
            "whatsapp_url": whatsapp_url,
            "receipt": payload,
            "log_id": log.id,
        })


class SaleItemViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SaleItemSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["product", "sale"]

    def get_queryset(self):
        return SaleItem.objects.filter(sale__created_by=self.request.user, is_deleted=False)


class TillSessionViewSet(viewsets.ModelViewSet):
    serializer_class = TillSessionSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["status", "branch"]

    def get_queryset(self):
        return TillSession.objects.filter(user=self.request.user, is_deleted=False).order_by("-opened_at")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["request"] = self.request
        return context

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if hasattr(request, "api_key") and request.method in ("POST", "PATCH", "DELETE"):
            from accounts.authentication import require_area
            require_area(request, "sales")

    @action(detail=False, methods=["get"], url_path="summary")
    def summary(self, request):
        session = self.get_queryset().filter(status="open").first()
        return Response({
            "open_till": TillSessionSerializer(session, context={"request": request}).data if session else None,
            "business": {"name": request.user.business_name, "currency": request.user.currency, "currency_symbol": request.user.currency_symbol},
        })

    def partial_update(self, request, *args, **kwargs):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        return super().partial_update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        return super().destroy(request, *args, **kwargs)

    def create(self, request, *args, **kwargs):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        with transaction.atomic():
            from django.contrib.auth import get_user_model
            get_user_model().objects.select_for_update().get(pk=self.request.user.pk)
            if TillSession.objects.filter(user=self.request.user, status="open", is_deleted=False).exists():
                from rest_framework.exceptions import ValidationError
                raise ValidationError("Close the current till before opening a new one.")
            serializer.save(user=self.request.user)

    @action(detail=False, methods=["get"], url_path="current")
    def current(self, request):
        session = self.get_queryset().filter(status="open").first()
        if not session:
            return Response({"detail": "No open till session."}, status=404)
        return Response(TillSessionSerializer(session).data)

    @action(detail=True, methods=["post"], url_path="close")
    def close(self, request, pk=None):
        if hasattr(request, "api_key"):
            from accounts.authentication import require_area
            require_area(request, "sales")
        session = self.get_object()
        if session.status != "open":
            return Response({"detail": "Till session is already closed."}, status=400)
        serializer = TillSessionSerializer(session, context={"request": request})
        closing_cash = request.data.get("closing_cash", 0)
        session = serializer.close(session, closing_cash=closing_cash, notes=request.data.get("notes", ""))
        return Response(TillSessionSerializer(session).data)
