import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0005_restore_email_verified_default"),
    ]

    operations = [
        migrations.CreateModel(
            name="StaffActivityLog",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("action", models.CharField(max_length=80)),
                ("object_type", models.CharField(blank=True, max_length=80)),
                ("object_id", models.CharField(blank=True, max_length=80)),
                ("summary", models.CharField(max_length=255)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("actor", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="performed_activity_logs", to=settings.AUTH_USER_MODEL)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="staff_activity_logs", to=settings.AUTH_USER_MODEL)),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
