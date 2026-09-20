from django.db import migrations

LIMITS = {'basic_sales': ('Basic sales', True, None, ''),
 'daily_summaries': ('Daily summaries', True, None, ''),
 'pwa_access': ('PWA/mobile access', True, None, ''),
 'basic_expenses': ('Basic expense logging', True, None, ''),
 'onboarding_checklist': ('Onboarding checklist', True, None, ''),
 'usage_indicators': ('Usage indicators', True, None, ''),
 'audits': ('Inventory audits', False, 0, ''),
 'barcode_scanning': ('Barcode scanning', True, None, ''),
 'receipt_ocr': ('Receipt OCR', False, 0, ''),
 'whatsapp_reports': ('WhatsApp reports', False, 0, ''),
 'qr_loyalty': ('QR loyalty', False, 0, ''),
 'customer_credit': ('Customer credit and collections', False, 0, ''),
 'alerts': ('Low stock and discrepancy alerts', False, 0, ''),
 'discrepancy_tracking': ('Discrepancy tracking', False, 0, ''),
 'advanced_reports': ('Advanced reports with charts', False, 0, ''),
 'rule_insights': ('Rule-based insights', False, 0, ''),
 'reorder_suggestions': ('Automatic reorder suggestions', False, 0, ''),
 'receipt_scan_simulator': ('Receipt scan simulator', False, 0, ''),
 'forecasting': ('Forecasting', False, 0, ''),
 'advanced_analytics': ('Advanced analytics', False, 0, ''),
 'custom_reports': ('Custom reports', False, 0, ''),
 'role_based_access': ('Role-based access', False, 0, ''),
 'offline_sync': ('Offline auto-sync', False, 0, ''),
 'background_audits': ('Background audits', False, 0, ''),
 'bulk_import_export': ('Bulk import/export', False, 0, ''),
 'excel_exports': ('Excel exports', False, 0, ''),
 'api_access': ('API access', False, 0, ''),
 'staff_activity_logs': ('Staff activity logs', False, 0, ''),
 'multi_branch': ('Multi-branch controls', False, 0, ''),
 'automation_rules': ('Automation rules', False, 0, ''),
 'users': ('Users', True, 1, 'user'),
 'products': ('Products', True, 50, 'products'),
 'customers': ('Customers', True, 100, 'customers'),
 'reports': ('Basic reports', True, 2, 'reports')}

def restore(apps, schema_editor):
    Plan = apps.get_model("billing", "Plan")
    FeatureLimit = apps.get_model("billing", "FeatureLimit")
    for plan in Plan.objects.filter(code="starter"):
        for key, (label, enabled, limit, unit) in LIMITS.items():
            FeatureLimit.objects.update_or_create(plan=plan, key=key, defaults={"label": label, "enabled": enabled, "limit": limit, "unit": unit})

class Migration(migrations.Migration):
    dependencies = [("billing", "0006_subscription_launch_promo_ends_at_and_more")]
    operations = [migrations.RunPython(restore, migrations.RunPython.noop)]
