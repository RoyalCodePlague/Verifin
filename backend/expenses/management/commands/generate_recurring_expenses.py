from django.core.management.base import BaseCommand

from expenses.financial_services import generate_due_expenses


class Command(BaseCommand):
    help = "Post recurring expense occurrences that are due today or earlier."

    def handle(self, *args, **options):
        result = generate_due_expenses()
        self.stdout.write(self.style.SUCCESS(
            f"Created {result['created_count']} recurring expense occurrence(s) through {result['through_date']}."
        ))
