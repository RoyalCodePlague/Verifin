from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("billing", "0007_restore_starter_limits")]

    operations = [
        migrations.AddField(model_name="payment", name="plan_code", field=models.CharField(blank=True, max_length=30)),
        migrations.AddField(model_name="payment", name="billing_period", field=models.CharField(blank=True, max_length=20)),
        migrations.AddField(model_name="payment", name="country_code", field=models.CharField(blank=True, max_length=2)),
        migrations.AddField(model_name="payment", name="provider_poll_url", field=models.URLField(blank=True, max_length=1000)),
    ]
