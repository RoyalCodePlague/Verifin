import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("reports", "0003_customreport"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AutomationEmailDispatch",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("delivery_date", models.DateField()),
                ("status", models.CharField(choices=[("pending", "pending"), ("sending", "sending"), ("sent", "sent")], default="pending", max_length=12)),
                ("attempts", models.PositiveSmallIntegerField(default=0)),
                ("sent_at", models.DateTimeField(blank=True, null=True)),
                ("last_error", models.CharField(blank=True, max_length=80)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="automation_email_dispatches", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddConstraint(
            model_name="automationemaildispatch",
            constraint=models.UniqueConstraint(condition=models.Q(("is_deleted", False)), fields=("user", "delivery_date"), name="unique_active_automation_email_per_day"),
        ),
    ]
