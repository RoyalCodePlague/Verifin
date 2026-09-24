from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("customers", "0003_alter_credittransaction_type")]
    operations = [migrations.AddField(model_name="customer", name="debt_due_date", field=models.DateField(blank=True, null=True))]
