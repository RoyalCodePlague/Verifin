from django.core.management.base import BaseCommand

from reports.automation_engine import evaluate_scheduled_automations, recover_stale_automation_executions


class Command(BaseCommand):
    help = "Evaluate scheduled stock and overdue-account automation rules."

    def handle(self, *args, **options):
        recovered = recover_stale_automation_executions()
        processed = evaluate_scheduled_automations()
        self.stdout.write(self.style.SUCCESS(f"Evaluated {processed} rule event(s) and recovered {recovered} stale execution(s)."))
