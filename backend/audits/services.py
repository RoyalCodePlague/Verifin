from django.db import transaction
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from .models import Audit, StockCount, Discrepancy
from .serializers import StockCountSerializer


@transaction.atomic
def complete_audit(request, audit_id, counts=None):
    audit = Audit.objects.select_for_update().get(pk=audit_id, conductor=request.user, is_deleted=False)
    if audit.status == "completed":
        return audit
    if counts is not None:
        if not isinstance(counts, list) or not counts:
            raise ValidationError({"counts": "Enter at least one stock count."})
        seen = set()
        validated = []
        for row in counts:
            serializer = StockCountSerializer(data={"audit": audit.id, **row}, context={"request": request})
            serializer.is_valid(raise_exception=True)
            data = serializer.validated_data
            if data["audit"].pk != audit.pk or data["product"].pk in seen or data["counted_quantity"] < 0:
                raise ValidationError({"counts": "Counts must be nonnegative and contain each product once."})
            seen.add(data["product"].pk)
            validated.append(data)
        for data in validated:
            StockCount.objects.update_or_create(audit=audit, product=data["product"], defaults={"counted_quantity": data["counted_quantity"], "counted_by": request.user})
    saved_counts = list(audit.stock_counts.filter(is_deleted=False).select_related("product"))
    if not saved_counts and not audit.discrepancies.filter(is_deleted=False).exists():
        raise ValidationError({"counts": "Record stock counts before completing this audit."})
    for count in saved_counts:
        expected = count.product.stock
        difference = count.counted_quantity - expected
        if difference:
            Discrepancy.objects.update_or_create(audit=audit, product=count.product, defaults={"expected_stock": expected, "actual_stock": count.counted_quantity, "difference": difference})
    audit.status = "completed"
    audit.completed_at = timezone.now()
    audit.items_counted = len(saved_counts) or audit.items_counted
    audit.discrepancies_found = audit.discrepancies.filter(is_deleted=False).count()
    audit.save()
    return audit
