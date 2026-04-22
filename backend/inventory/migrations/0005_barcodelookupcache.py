from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("inventory", "0004_product_cost_currency_product_cost_fx_rate_to_base_and_more"),
    ]

    operations = [
        migrations.CreateModel(
            name="BarcodeLookupCache",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("deleted_at", models.DateTimeField(blank=True, null=True)),
                ("barcode", models.CharField(db_index=True, max_length=100, unique=True)),
                ("name", models.CharField(max_length=255)),
                ("brand", models.CharField(blank=True, max_length=255)),
                ("category", models.CharField(blank=True, max_length=120)),
                ("source", models.CharField(default="cache", max_length=50)),
            ],
        ),
    ]
