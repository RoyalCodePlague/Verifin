# Generated for local mock billing architecture.

import django.db.models.deletion
from decimal import Decimal

from django.conf import settings
from django.db import migrations, models
from django.utils import timezone


PLAN_LIMITS = {
    "starter": {
        "name": "Starter",
        "description": "Free forever for solo owners getting started.",
        "monthly_price": Decimal("0"),
        "yearly_price": Decimal("0"),
        "sort_order": 1,
    },
    "growth": {
        "name": "Growth",
        "description": "For growing SMEs that need automation and unlimited stock.",
        "monthly_price": Decimal("299"),
        "yearly_price": Decimal("2990"),
        "sort_order": 2,
    },
    "business": {
        "name": "Business",
        "description": "For established businesses needing advanced control.",
        "monthly_price": Decimal("599"),
        "yearly_price": Decimal("5990"),
        "sort_order": 3,
    },
}


def seed_plans_and_migrate_subscriptions(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    Subscription = apps.get_model("billing", "Subscription")
    for code, defaults in PLAN_LIMITS.items():
        Plan.objects.update_or_create(code=code, defaults=defaults)

    plan_map = {
        "starter": Plan.objects.get(code="starter"),
        "growth": Plan.objects.get(code="growth"),
        "business": Plan.objects.get(code="business"),
    }
    for subscription in Subscription.objects.all():
        old_plan = (subscription.plan or "starter").lower()
        subscription.plan_ref = plan_map.get(old_plan, plan_map["starter"])
        if subscription.status == "trial":
            subscription.status = "trialing"
        subscription.save(update_fields=["plan_ref", "status"])


def seed_feature_limits(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    FeatureLimit = apps.get_model("billing", "FeatureLimit")
    common = {
        "basic_sales": ("Basic sales", True, None, ""),
        "daily_summaries": ("Daily summaries", True, None, ""),
        "pwa_access": ("PWA/mobile access", True, None, ""),
        "basic_expenses": ("Basic expense logging", True, None, ""),
        "onboarding_checklist": ("Onboarding checklist", True, None, ""),
        "usage_indicators": ("Usage indicators", True, None, ""),
        "ai_assistant": ("AI/Admin Assistance System", False, 0, ""),
        "audits": ("Inventory audits", False, 0, ""),
        "barcode_scanning": ("Barcode scanning", False, 0, ""),
        "receipt_ocr": ("Receipt OCR", False, 0, ""),
        "whatsapp_reports": ("WhatsApp daily reports", False, 0, ""),
        "qr_loyalty": ("QR loyalty", False, 0, ""),
        "alerts": ("Low stock and discrepancy alerts", False, 0, ""),
        "discrepancy_tracking": ("Discrepancy tracking", False, 0, ""),
        "advanced_reports": ("Advanced reports with charts", False, 0, ""),
        "rule_insights": ("Rule-based insights", False, 0, ""),
        "reorder_suggestions": ("Automatic reorder suggestions", False, 0, ""),
        "command_assistant": ("Command assistant", False, 0, ""),
        "receipt_scan_simulator": ("Receipt scan simulator", False, 0, ""),
        "forecasting": ("Forecasting", False, 0, ""),
        "advanced_analytics": ("Advanced analytics", False, 0, ""),
        "custom_reports": ("Custom reports", False, 0, ""),
        "role_based_access": ("Role-based access", False, 0, ""),
        "offline_sync": ("Offline auto-sync", False, 0, ""),
        "background_audits": ("Background audits", False, 0, ""),
        "bulk_import_export": ("Bulk import/export", False, 0, ""),
        "excel_exports": ("Excel exports", False, 0, ""),
        "api_access": ("API access", False, 0, ""),
        "staff_activity_logs": ("Staff activity logs", False, 0, ""),
        "multi_branch": ("Multi-branch controls", False, 0, ""),
        "automation_rules": ("Automation rules", False, 0, ""),
    }
    catalog = {
        "starter": {**common, "users": ("Users", True, 1, "user"), "products": ("Products", True, 50, "products"), "customers": ("Customers", True, 100, "customers"), "reports": ("Basic reports", True, 2, "reports")},
        "growth": {**common, "users": ("Users", True, 3, "users"), "products": ("Products", True, None, "unlimited"), "customers": ("Customers", True, None, "unlimited"), "reports": ("Reports with charts", True, 8, "reports"), "ai_assistant": ("AI/Admin Assistance System", True, None, ""), "audits": ("Inventory audits", True, None, ""), "barcode_scanning": ("Barcode scanning", True, None, ""), "receipt_ocr": ("Receipt OCR", True, None, ""), "whatsapp_reports": ("WhatsApp daily reports", True, None, ""), "qr_loyalty": ("QR loyalty", True, None, ""), "alerts": ("Low stock and discrepancy alerts", True, None, ""), "discrepancy_tracking": ("Discrepancy tracking", True, None, ""), "advanced_reports": ("Advanced reports with charts", True, None, ""), "rule_insights": ("Rule-based insights", True, None, ""), "reorder_suggestions": ("Automatic reorder suggestions", True, None, ""), "command_assistant": ("Command assistant", True, None, ""), "receipt_scan_simulator": ("Receipt scan simulator", True, None, "")},
        "business": {**common, "users": ("Users", True, None, "unlimited"), "products": ("Products", True, None, "unlimited"), "customers": ("Customers", True, None, "unlimited"), "reports": ("Custom reports", True, None, "unlimited"), "ai_assistant": ("AI/Admin Assistance System", True, None, ""), "audits": ("Inventory audits", True, None, ""), "barcode_scanning": ("Barcode scanning", True, None, ""), "receipt_ocr": ("Receipt OCR", True, None, ""), "whatsapp_reports": ("WhatsApp daily reports", True, None, ""), "qr_loyalty": ("QR loyalty", True, None, ""), "alerts": ("Low stock and discrepancy alerts", True, None, ""), "discrepancy_tracking": ("Discrepancy tracking", True, None, ""), "advanced_reports": ("Advanced reports with charts", True, None, ""), "rule_insights": ("Rule-based insights", True, None, ""), "reorder_suggestions": ("Automatic reorder suggestions", True, None, ""), "command_assistant": ("Command assistant", True, None, ""), "receipt_scan_simulator": ("Receipt scan simulator", True, None, ""), "forecasting": ("Forecasting", True, None, ""), "advanced_analytics": ("Advanced analytics", True, None, ""), "custom_reports": ("Custom reports", True, None, ""), "role_based_access": ("Role-based access", True, None, ""), "offline_sync": ("Offline auto-sync", True, None, ""), "background_audits": ("Background audits", True, None, ""), "bulk_import_export": ("Bulk import/export", True, None, ""), "excel_exports": ("Excel exports", True, None, ""), "api_access": ("API access", True, None, ""), "staff_activity_logs": ("Staff activity logs", True, None, ""), "multi_branch": ("Multi-branch controls", True, None, ""), "automation_rules": ("Automation rules", True, None, "")},
    }
    for code, limits in catalog.items():
        plan = Plan.objects.get(code=code)
        for key, (label, enabled, limit, unit) in limits.items():
            FeatureLimit.objects.update_or_create(plan=plan, key=key, defaults={"label": label, "enabled": enabled, "limit": limit, "unit": unit})


def keep_one_subscription_per_user(apps, schema_editor):
    Subscription = apps.get_model("billing", "Subscription")
    user_ids = Subscription.objects.values_list("user_id", flat=True).distinct()
    for user_id in user_ids:
        subscriptions = list(Subscription.objects.filter(user_id=user_id).order_by("-updated_at", "-id"))
        for duplicate in subscriptions[1:]:
            duplicate.delete()


class Migration(migrations.Migration):

    dependencies = [
        ("billing", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="Plan",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("code", models.CharField(choices=[("starter", "Starter"), ("growth", "Growth"), ("business", "Business")], max_length=30, unique=True)),
                ("name", models.CharField(max_length=60)),
                ("description", models.CharField(blank=True, max_length=255)),
                ("monthly_price", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("yearly_price", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("currency", models.CharField(default="ZAR", max_length=10)),
                ("is_public", models.BooleanField(default=True)),
                ("sort_order", models.PositiveIntegerField(default=0)),
            ],
            options={"ordering": ["sort_order", "monthly_price"]},
        ),
        migrations.CreateModel(
            name="FeatureLimit",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("key", models.CharField(max_length=80)),
                ("label", models.CharField(max_length=120)),
                ("enabled", models.BooleanField(default=True)),
                ("limit", models.IntegerField(blank=True, null=True)),
                ("unit", models.CharField(blank=True, max_length=40)),
                ("plan", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="limits", to="billing.plan")),
            ],
            options={"ordering": ["plan__sort_order", "key"], "unique_together": {("plan", "key")}},
        ),
        migrations.AddField(
            model_name="subscription",
            name="plan_ref",
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name="subscriptions", to="billing.plan"),
        ),
        migrations.RunPython(seed_plans_and_migrate_subscriptions, migrations.RunPython.noop),
        migrations.RunPython(seed_feature_limits, migrations.RunPython.noop),
        migrations.RemoveField(model_name="subscription", name="plan"),
        migrations.RenameField(model_name="subscription", old_name="plan_ref", new_name="plan"),
        migrations.RenameField(model_name="subscription", old_name="trial_end", new_name="trial_ends_at"),
        migrations.AddField(model_name="subscription", name="billing_period", field=models.CharField(choices=[("monthly", "monthly"), ("yearly", "yearly")], default="monthly", max_length=20)),
        migrations.AddField(model_name="subscription", name="provider", field=models.CharField(default="mock", max_length=30)),
        migrations.AddField(model_name="subscription", name="provider_customer_id", field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name="subscription", name="provider_subscription_id", field=models.CharField(blank=True, max_length=255)),
        migrations.AddField(model_name="subscription", name="current_period_start", field=models.DateTimeField(default=timezone.now)),
        migrations.AddField(model_name="subscription", name="grace_period_ends_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="subscription", name="cancel_at_period_end", field=models.BooleanField(default=False)),
        migrations.AddField(model_name="subscription", name="cancelled_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AddField(model_name="subscription", name="ended_at", field=models.DateTimeField(blank=True, null=True)),
        migrations.AlterField(model_name="subscription", name="plan", field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="subscriptions", to="billing.plan")),
        migrations.AlterField(model_name="subscription", name="status", field=models.CharField(choices=[("active", "active"), ("trialing", "trialing"), ("past_due", "past_due"), ("cancelled", "cancelled"), ("expired", "expired")], default="active", max_length=20)),
        migrations.RunPython(keep_one_subscription_per_user, migrations.RunPython.noop),
        migrations.AlterField(model_name="subscription", name="user", field=models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="subscription", to=settings.AUTH_USER_MODEL)),
        migrations.RenameField(model_name="payment", old_name="stripe_payment_id", new_name="provider_payment_id"),
        migrations.AddField(model_name="payment", name="provider", field=models.CharField(default="mock", max_length=30)),
        migrations.AlterField(model_name="payment", name="amount", field=models.DecimalField(decimal_places=2, default=0, max_digits=12)),
        migrations.AlterField(model_name="payment", name="status", field=models.CharField(default="paid", max_length=20)),
        migrations.CreateModel(
            name="BillingCycle",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("period_start", models.DateTimeField()),
                ("period_end", models.DateTimeField()),
                ("amount", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("currency", models.CharField(default="ZAR", max_length=10)),
                ("provider_invoice_id", models.CharField(blank=True, max_length=255)),
                ("paid_at", models.DateTimeField(blank=True, null=True)),
                ("status", models.CharField(default="paid", max_length=30)),
                ("subscription", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="cycles", to="billing.subscription")),
            ],
            options={"ordering": ["-period_start"]},
        ),
        migrations.CreateModel(
            name="UsageTracking",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("key", models.CharField(max_length=80)),
                ("used", models.PositiveIntegerField(default=0)),
                ("period_start", models.DateTimeField(default=timezone.now)),
                ("period_end", models.DateTimeField(blank=True, null=True)),
                ("subscription", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="usage", to="billing.subscription")),
            ],
            options={"unique_together": {("subscription", "key", "period_start")}},
        ),
        migrations.CreateModel(
            name="TrialPeriod",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("started_at", models.DateTimeField(default=timezone.now)),
                ("ends_at", models.DateTimeField()),
                ("converted_at", models.DateTimeField(blank=True, null=True)),
                ("expired_at", models.DateTimeField(blank=True, null=True)),
                ("plan", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name="trials", to="billing.plan")),
                ("subscription", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="trials", to="billing.subscription")),
            ],
        ),
        migrations.CreateModel(
            name="SubscriptionEvent",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("is_deleted", models.BooleanField(default=False)),
                ("event_type", models.CharField(max_length=80)),
                ("provider", models.CharField(default="mock", max_length=30)),
                ("provider_event_id", models.CharField(blank=True, max_length=255)),
                ("metadata", models.JSONField(blank=True, default=dict)),
                ("created_by", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="billing_events", to=settings.AUTH_USER_MODEL)),
                ("subscription", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="events", to="billing.subscription")),
            ],
            options={"ordering": ["-created_at"]},
        ),
    ]
