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
        daily = qs.annotate(day=TruncDay("created_at")).values("day").annotate(total=Sum("total")).order_by("-day")[:30]
        weekly = qs.annotate(week=TruncWeek("created_at")).values("week").annotate(total=Sum("total")).order_by("-week")[:12]
        monthly = qs.annotate(month=TruncMonth("created_at")).values("month").annotate(total=Sum("total")).order_by("-month")[:12]
        return Response({"daily": list(daily), "weekly": list(weekly), "monthly": list(monthly)})


class SaleItemViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = SaleItemSerializer
    filterset_fields = ["product", "sale"]

    def get_queryset(self):
        return SaleItem.objects.filter(sale__created_by=self.request.user, is_deleted=False)
