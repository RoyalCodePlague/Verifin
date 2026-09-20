from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from billing.services import enforce_feature
from .models import Audit, Discrepancy, StockCount
from .serializers import AuditSerializer, DiscrepancySerializer, StockCountSerializer


class AuditFeatureMixin:
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            enforce_feature(request.user, "audits")


class AuditViewSet(AuditFeatureMixin, viewsets.ModelViewSet):
    serializer_class = AuditSerializer
    filterset_fields = ["status", "date"]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.request.user and self.request.user.is_authenticated:
            return Audit.objects.filter(conductor=self.request.user, is_deleted=False)
        else:
            return Audit.objects.filter(is_deleted=False)

    def perform_create(self, serializer):
        enforce_feature(self.request.user, "audits")
        serializer.save(conductor=self.request.user)

    @action(detail=True, methods=["post"], url_path="complete")
    def complete(self, request, pk=None):
        enforce_feature(request.user, "audits")
        from .services import complete_audit
        audit = complete_audit(request, self.get_object().pk, request.data.get("counts"))
        return Response(AuditSerializer(audit).data)

    def perform_update(self, serializer):
        if serializer.validated_data.get("status") == "completed" and serializer.instance.status != "completed":
            from .services import complete_audit
            complete_audit(self.request, serializer.instance.pk)
            serializer.instance.refresh_from_db()
        else:
            serializer.save()



class StockCountViewSet(AuditFeatureMixin, viewsets.ModelViewSet):
    serializer_class = StockCountSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return StockCount.objects.filter(counted_by=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(counted_by=self.request.user)


class DiscrepancyViewSet(AuditFeatureMixin, viewsets.ModelViewSet):
    serializer_class = DiscrepancySerializer
    filterset_fields = ["status", "audit"]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Discrepancy.objects.filter(audit__conductor=self.request.user, is_deleted=False)

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        discrepancy = self.get_object()
        discrepancy.status = "resolved"
        discrepancy.resolved_by = request.user
        discrepancy.resolved_at = timezone.now()
        discrepancy.save()
        return Response(DiscrepancySerializer(discrepancy).data)
