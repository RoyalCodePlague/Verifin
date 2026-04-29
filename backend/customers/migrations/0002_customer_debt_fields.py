from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("customers", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="customer",
            name="debt_amount",
            field=models.DecimalField(decimal_places=2, default=0, max_digits=12),
        ),
        migrations.AddField(
            model_name="customer",
            name="debt_started_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="debt_updated_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="customer",
            name="debt_notes",
            field=models.TextField(blank=True),
        ),
    ]
