import uuid

from django.db import transaction

from .models import AnalyticsConsent, ProductEvent


def record_activation_event(user, event):
    """Record an activation milestone only for an opted-in account."""
    consent = AnalyticsConsent.objects.filter(user=user, opted_in=True).only("analytics_id").first()
    if consent is None:
        return False
    _, created = ProductEvent.objects.get_or_create(account_ref=consent.analytics_id, event=event)
    return created


@transaction.atomic
def set_analytics_consent(user, opted_in):
    consent, _ = AnalyticsConsent.objects.select_for_update().get_or_create(user=user)
    if consent.opted_in == opted_in:
        return consent
    if opted_in:
        consent.analytics_id = uuid.uuid4()
        consent.opted_in = True
        consent.save(update_fields=["analytics_id", "opted_in", "updated_at"])
    else:
        ProductEvent.objects.filter(account_ref=consent.analytics_id).delete()
        consent.opted_in = False
        consent.save(update_fields=["opted_in", "updated_at"])
    return consent
