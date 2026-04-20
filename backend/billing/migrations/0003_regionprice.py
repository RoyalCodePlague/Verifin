import django.db.models.deletion
from decimal import Decimal

from django.db import migrations, models


REGION_PRICES = {
    "ZA": ("South Africa", "ZAR", "R", {"starter": (0, 0), "growth": (299, 2990), "business": (599, 5990)}),
    "ZW": ("Zimbabwe", "USD", "$", {"starter": (0, 0), "growth": (12, 120), "business": (24, 240)}),
    "BW": ("Botswana", "BWP", "P", {"starter": (0, 0), "growth": (220, 2200), "business": (440, 4400)}),
    "KE": ("Kenya", "KES", "KSh", {"starter": (0, 0), "growth": (1800, 18000), "business": (3600, 36000)}),
    "NG": ("Nigeria", "NGN", "NGN", {"starter": (0, 0), "growth": (18000, 180000), "business": (36000, 360000)}),
    "GH": ("Ghana", "GHS", "GHc", {"starter": (0, 0), "growth": (180, 1800), "business": (360, 3600)}),
    "TZ": ("Tanzania", "TZS", "TSh", {"starter": (0, 0), "growth": (30000, 300000), "business": (60000, 600000)}),
    "ZM": ("Zambia", "ZMW", "K", {"starter": (0, 0), "growth": (300, 3000), "business": (600, 6000)}),
}


def seed_region_prices(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    RegionPrice = apps.get_model("billing", "RegionPrice")
    for country_code, (country_name, currency, symbol, prices) in REGION_PRICES.items():
        for plan_code, (monthly, yearly) in prices.items():
            plan = Plan.objects.filter(code=plan_code).first()
            if not plan:
                continue
            RegionPrice.objects.update_or_create(
                plan=plan,
                country_code=country_code,
                defaults={
                    "country_name": country_name,
                    "currency": currency,
                    "currency_symbol": symbol,
                    "monthly_price": Decimal(str(monthly)),
                    "yearly_price": Decimal(str(yearly)),
                    "is_default": country_code == "ZA",
                },
            )


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0002_subscription_architecture"),
    ]

    operations = [
        migrations.CreateModel(
            name="RegionPrice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("country_code", models.CharField(max_length=2)),
                ("country_name", models.CharField(max_length=80)),
                ("currency", models.CharField(max_length=10)),
                ("currency_symbol", models.CharField(max_length=10)),
                ("monthly_price", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("yearly_price", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("is_default", models.BooleanField(default=False)),
                ("plan", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="region_prices", to="billing.plan")),
            ],
            options={"ordering": ["country_name", "plan__sort_order"], "unique_together": {("plan", "country_code")}},
        ),
        migrations.AddField(
            model_name="subscription",
            name="billing_country_code",
            field=models.CharField(default="ZA", max_length=2),
        ),
        migrations.AddField(
            model_name="subscription",
            name="billing_currency",
            field=models.CharField(default="ZAR", max_length=10),
        ),
        migrations.RunPython(seed_region_prices, migrations.RunPython.noop),
    ]
