from django.db.models import Sum
from django.db.models.functions import TruncDay, TruncMonth, TruncWeek
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Sale, SaleItem
from .serializers import SaleItemSerializer, SaleSerializer


class SaleViewSet(viewsets.ModelViewSet):
    serializer_class = SaleSerializer
    filterset_fields = ["payment_method", "customer"]

    def get_queryset(self):
        return Sale.objects.filter(created_by=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

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


class SaleItemViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SaleItemSerializer
    filterset_fields = ["product", "sale"]

    def get_queryset(self):
        return SaleItem.objects.filter(sale__created_by=self.request.user, is_deleted=False)
