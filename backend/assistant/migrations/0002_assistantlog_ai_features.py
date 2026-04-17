# Generated migration for AssistantLog model updates

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("assistant", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="assistantlog",
            name="ai_response",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text="Full Claude AI response JSON",
            ),
        ),
        migrations.AddField(
            model_name="assistantlog",
            name="confidence",
            field=models.FloatField(
                default=0.0,
                help_text="Claude's confidence score (0.0-1.0)",
            ),
        ),
        migrations.AddField(
            model_name="assistantlog",
            name="requires_confirmation",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="assistantlog",
            name="executed",
            field=models.BooleanField(
                default=False,
                help_text="Whether the action was executed",
            ),
        ),
        migrations.AlterModelOptions(
            name="assistantlog",
            options={
                "ordering": ["-created_at"],
                "verbose_name": "Assistant Log",
                "verbose_name_plural": "Assistant Logs",
            },
        ),
    ]
