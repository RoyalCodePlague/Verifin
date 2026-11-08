from django.core.management.base import BaseCommand, CommandError

from accounts.webhooks import deliver_due_webhooks


class Command(BaseCommand):
    help = "Deliver queued webhook events and retry due failures."

    def add_arguments(self, parser):
        parser.add_argument("--limit", type=int, default=100)

    def handle(self, *args, **options):
        limit = options["limit"]
        if limit < 1:
            raise CommandError("--limit must be greater than zero.")
        processed = deliver_due_webhooks(limit=limit)
        self.stdout.write(self.style.SUCCESS(f"Processed {processed} webhook delivery(ies)."))
