from django.db import migrations


def retire_features(apps, schema_editor):
    apps.get_model("billing", "FeatureLimit").objects.filter(key__in=["ai_assistant", "command_assistant"]).delete()


class Migration(migrations.Migration):
    dependencies = [("billing", "0004_referralcode_referralrewardtoken_referralsignup")]
    operations = [migrations.RunPython(retire_features, migrations.RunPython.noop)]
