from django.conf import settings
from django.db.models.signals import pre_delete
from django.dispatch import receiver

from .models import AnalyticsConsent, ProductEvent


@receiver(pre_delete, sender=settings.AUTH_USER_MODEL)
def delete_pseudonymous_events_for_deleted_account(sender, instance, **kwargs):
    analytics_id = AnalyticsConsent.objects.filter(user_id=instance.pk).values_list("analytics_id", flat=True).first()
    if analytics_id:
        ProductEvent.objects.filter(account_ref=analytics_id).delete()
