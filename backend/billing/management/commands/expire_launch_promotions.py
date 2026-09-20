from django.core.management.base import BaseCommand
from django.utils import timezone
from billing.models import Subscription
from billing.services import refresh_subscription_state


class Command(BaseCommand):
    help = "Move elapsed launch promotions to free Starter. Access checks also do this automatically."

    def handle(self, *args, **options):
        subscriptions = Subscription.objects.filter(provider="launch_promo", launch_promo_ends_at__lte=timezone.now(), is_deleted=False)
        count = 0
        for subscription in subscriptions.iterator():
            refresh_subscription_state(subscription)
            count += 1
        self.stdout.write(f"Processed {count} elapsed launch promotions.")
