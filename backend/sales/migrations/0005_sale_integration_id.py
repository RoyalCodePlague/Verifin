from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("sales", "0004_sale_payment_allocations_sale_payment_currency")]

    operations = [
        migrations.AddField(
            model_name="sale",
            name="integration_id",
            field=models.CharField(blank=True, max_length=120),
        ),
        migrations.AddConstraint(
            model_name="sale",
            constraint=models.UniqueConstraint(
                condition=~models.Q(integration_id=""),
                fields=("created_by", "integration_id"),
                name="unique_sale_integration_id_per_user",
            ),
        ),
    ]
