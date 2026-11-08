import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0001_productevent"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.DeleteModel(name="ProductEvent"),
        migrations.CreateModel(
            name="AnalyticsConsent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("analytics_id", models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ("opted_in", models.BooleanField(default=False)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("user", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="analytics_consent", to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.CreateModel(
            name="ProductEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("account_ref", models.UUIDField()),
                ("event", models.CharField(max_length=64)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "indexes": [models.Index(fields=["event", "created_at"], name="core_produc_event_e43277_idx")],
                "constraints": [
                    models.UniqueConstraint(fields=("account_ref", "event"), name="unique_product_event_per_account"),
                ],
            },
        ),
    ]
