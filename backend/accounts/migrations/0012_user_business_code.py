import secrets
import string

import accounts.models
from django.db import migrations, models


def populate_business_codes(apps, schema_editor):
    User = apps.get_model("accounts", "User")
    alphabet = string.ascii_lowercase + string.digits
    def new_code():
        characters = [secrets.choice(string.ascii_lowercase), secrets.choice(string.digits)]
        characters.extend(secrets.choice(alphabet) for _ in range(4))
        secrets.SystemRandom().shuffle(characters)
        return "VF-" + "".join(characters)
    for user in User.objects.filter(business_code__isnull=True).iterator():
        code = new_code()
        while User.objects.filter(business_code=code).exists():
            code = new_code()
        user.business_code = code
        user.save(update_fields=["business_code"])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0011_auththrottlebucket_user_email_verification_pending")]

    operations = [
        migrations.AddField(
            model_name="user",
            name="business_code",
            field=models.CharField(blank=True, max_length=16, null=True, unique=True),
        ),
        migrations.RunPython(populate_business_codes, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="user",
            name="business_code",
            field=models.CharField(default=accounts.models.generate_business_code, editable=False, max_length=16, unique=True),
        ),
    ]
