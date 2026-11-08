import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ("audits", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditSchedule",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("frequency", models.CharField(choices=[("daily", "daily"), ("weekly", "weekly")], default="weekly", max_length=20)),
                ("is_active", models.BooleanField(default=True)),
                ("next_run_at", models.DateTimeField(default=django.utils.timezone.now)),
                ("last_run_at", models.DateTimeField(blank=True, null=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="audit_schedule", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddField(
            model_name="audit",
            name="schedule",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="audits", to="audits.auditschedule"),
        ),
    ]
