from django.db.models import Sum
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from .models import Sale, SaleItem, TillSession
from .serializers import SaleItemReadSerializer, SaleItemSerializer, SaleSerializer, TillSessionSerializer


class SaleViewSet(viewsets.ModelViewSet):
    serializer_class = SaleSerializer
    permission_classes = [IsAuthenticated]
    filterset_fields = ["payment_method", "customer"]

    def get_queryset(self):
        return Sale.objects.filter(created_by=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        till_session = serializer.validated_data.get("till_session")
        if not till_session:
            till_session = TillSession.objects.filter(user=self.request.user, status="open", is_deleted=False).order_by("-opened_at").first()
        serializer.save(created_by=self.request.user, till_session=till_session)

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
        return Response({
            "receipt_number": sale.receipt_number,
            "invoice_number": sale.invoice_number,
            "business_name": request.user.business_name,
            "branch": sale.branch.name if sale.branch else "",
            "date": sale.date,
            "time": sale.time,
            "payment_method": sale.payment_method,
            "items": SaleItemReadSerializer(sale.sale_items.all(), many=True).data,
            "subtotal": sale.total,
            "total": sale.total,
            "customer": sale.customer.name if sale.customer else "",
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

    def perform_create(self, serializer):
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
        session = self.get_object()
        serializer = TillSessionSerializer(session, context={"request": request})
        closing_cash = request.data.get("closing_cash", 0)
        session = serializer.close(session, closing_cash=closing_cash, notes=request.data.get("notes", ""))
        return Response(TillSessionSerializer(session).data)
