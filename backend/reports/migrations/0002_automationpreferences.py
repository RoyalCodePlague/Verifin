from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
from reports.models import default_automation_rules


class Migration(migrations.Migration):

    dependencies = [
        ("reports", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationPreferences",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("enabled_rules", models.JSONField(default=default_automation_rules)),
                ("severity", models.CharField(choices=[("info", "info"), ("warning", "warning"), ("critical", "critical")], default="warning", max_length=20)),
                ("channel", models.CharField(choices=[("in_app", "in_app"), ("email", "email"), ("whatsapp", "whatsapp")], default="in_app", max_length=20)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="automation_preferences", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "db_table": "reports_automationpreferences",
            },
        ),
    ]
