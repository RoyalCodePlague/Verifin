from django.utils import timezone
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Audit, Discrepancy, StockCount
from .serializers import AuditSerializer, DiscrepancySerializer, StockCountSerializer


class AuditViewSet(viewsets.ModelViewSet):
    serializer_class = AuditSerializer
    filterset_fields = ["status", "date"]
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if self.request.user and self.request.user.is_authenticated:
            return Audit.objects.filter(conductor=self.request.user, is_deleted=False)
        else:
            return Audit.objects.filter(is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(conductor=self.request.user)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        audit = self.get_object()
        discrepancies_count = 0
        for count in audit.stock_counts.all():
            expected = count.product.stock
            actual = count.counted_quantity
            diff = actual - expected
            if diff != 0:
                discrepancies_count += 1
                Discrepancy.objects.create(
                    audit=audit,
                    product=count.product,
                    expected_stock=expected,
                    actual_stock=actual,
                    difference=diff,
                )
        audit.status = "completed"
        audit.completed_at = timezone.now()
        audit.items_counted = audit.stock_counts.count()
        audit.discrepancies_found = discrepancies_count
        audit.save()
        return Response(AuditSerializer(audit).data)


class StockCountViewSet(viewsets.ModelViewSet):
    serializer_class = StockCountSerializer
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]

    def get_queryset(self):
        return StockCount.objects.filter(counted_by=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(counted_by=self.request.user)


class DiscrepancyViewSet(viewsets.ModelViewSet):
    serializer_class = DiscrepancySerializer
    filterset_fields = ["status", "audit"]
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if self.request.user and self.request.user.is_authenticated:
            return Discrepancy.objects.filter(audit__conductor=self.request.user, is_deleted=False)
        else:
            return Discrepancy.objects.filter(is_deleted=False)

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        discrepancy = self.get_object()
        discrepancy.status = "resolved"
        discrepancy.resolved_by = request.user
        discrepancy.resolved_at = timezone.now()
        discrepancy.save()
        return Response(DiscrepancySerializer(discrepancy).data)
