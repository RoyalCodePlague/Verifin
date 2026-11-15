from django.db import transaction
from django.utils import timezone
from rest_framework import viewsets, permissions
from rest_framework.decorators import action
from rest_framework.response import Response
from accounts.branch_access import require_business_owner, scope_queryset_to_staff_branch
from billing.services import enforce_feature
from datetime import timedelta

from .models import Audit, AuditSchedule, Discrepancy, StockCount
from .serializers import AuditScheduleSerializer, AuditSerializer, DiscrepancySerializer, StockCountSerializer


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
            queryset = Audit.objects.filter(conductor=self.request.user, is_deleted=False)
            return scope_queryset_to_staff_branch(self.request, queryset)
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


class AuditScheduleViewSet(AuditFeatureMixin, viewsets.ModelViewSet):
    serializer_class = AuditScheduleSerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        enforce_feature(request.user, "background_audits")
        require_business_owner(request)

    def get_queryset(self):
        return AuditSchedule.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        schedule = serializer.save(user=self.request.user)
        schedule.next_run_at = timezone.now() + self._interval(schedule.frequency)
        schedule.save(update_fields=["next_run_at", "updated_at"])

    def perform_update(self, serializer):
        schedule = serializer.save()
        if "frequency" in serializer.validated_data:
            schedule.next_run_at = timezone.now() + self._interval(schedule.frequency)
            schedule.save(update_fields=["next_run_at", "updated_at"])

    def perform_destroy(self, instance):
        instance.is_active = False
        instance.is_deleted = True
        instance.save(update_fields=["is_active", "is_deleted", "updated_at"])

    @staticmethod
    def _interval(frequency):
        return timedelta(days=1 if frequency == "daily" else 7)


class StockCountViewSet(AuditFeatureMixin, viewsets.ModelViewSet):
    serializer_class = StockCountSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = StockCount.objects.filter(counted_by=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset, "audit__branch_id")

    def perform_create(self, serializer):
        serializer.save(counted_by=self.request.user)


class DiscrepancyViewSet(AuditFeatureMixin, viewsets.ModelViewSet):
    serializer_class = DiscrepancySerializer
    filterset_fields = ["status", "audit"]
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Discrepancy.objects.filter(audit__conductor=self.request.user, is_deleted=False)
        return scope_queryset_to_staff_branch(self.request, queryset, "audit__branch_id")

    @action(detail=True, methods=["post"], url_path="resolve")
    def resolve(self, request, pk=None):
        discrepancy = self.get_object()
        discrepancy.status = "resolved"
        discrepancy.resolved_by = request.user
        discrepancy.resolved_at = timezone.now()
        discrepancy.save()
        return Response(DiscrepancySerializer(discrepancy).data)
