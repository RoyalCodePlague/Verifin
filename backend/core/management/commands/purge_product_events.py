from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import ProductEvent


class Command(BaseCommand):
    help = "Delete pseudonymous product events older than 12 months."

    def handle(self, *args, **options):
        cutoff = timezone.now() - timedelta(days=365)
        deleted, _ = ProductEvent.objects.filter(created_at__lt=cutoff).delete()
        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} product event record(s)."))
