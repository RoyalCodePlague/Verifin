from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("notifications", "0002_feedback"),
    ]

    operations = [
        migrations.AddField(
            model_name="notificationpreference",
            name="email_opt_in",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="notificationpreference",
            name="email_daily_summary",
            field=models.BooleanField(default=False),
        ),
    ]
