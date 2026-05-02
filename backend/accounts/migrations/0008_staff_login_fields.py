from django.db import migrations, models


def default_staff_permissions():
    return []


class Migration(migrations.Migration):

    dependencies = [
        ("accounts", "0007_user_enabled_currencies_user_exchange_rates"),
    ]

    operations = [
        migrations.AddField(
            model_name="staff",
            name="login_enabled",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="staff",
            name="password",
            field=models.CharField(blank=True, max_length=128),
        ),
        migrations.AddField(
            model_name="staff",
            name="permissions",
            field=models.JSONField(blank=True, default=default_staff_permissions),
        ),
        migrations.AddField(
            model_name="staff",
            name="username",
            field=models.CharField(blank=True, max_length=80),
        ),
        migrations.AddConstraint(
            model_name="staff",
            constraint=models.UniqueConstraint(
                condition=models.Q(is_deleted=False) & ~models.Q(username=""),
                fields=("user", "username"),
                name="unique_active_staff_username_per_owner",
            ),
        ),
    ]
