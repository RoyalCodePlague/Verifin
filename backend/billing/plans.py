COMMON_LIMITS = {
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
    "whatsapp_reports": ("WhatsApp reports", False, 0, ""),
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

STARTER_LIMITS = {
    **COMMON_LIMITS,
    "users": ("Users", True, 1, "user"),
    "products": ("Products", True, 50, "products"),
    "customers": ("Customers", True, 100, "customers"),
    "reports": ("Basic reports", True, 2, "reports"),
}

# Testing mode: Starter gets access to every feature while subscription flows are being tested.
# To restore package-specific access later, remove this loop and keep STARTER_LIMITS as the
# limited free plan above.
for _key, (_label, _enabled, _limit, _unit) in list(STARTER_LIMITS.items()):
    STARTER_LIMITS[_key] = (_label, True, None, _unit)

GROWTH_LIMITS = {
    **COMMON_LIMITS,
    "users": ("Users", True, 3, "users"),
    "products": ("Products", True, None, "unlimited"),
    "customers": ("Customers", True, None, "unlimited"),
    "reports": ("Reports with charts", True, 8, "reports"),
    "ai_assistant": ("AI/Admin Assistance System", True, None, ""),
    "audits": ("Inventory audits", True, None, ""),
    "barcode_scanning": ("Barcode scanning", True, None, ""),
    "receipt_ocr": ("Receipt OCR", True, None, ""),
    "whatsapp_reports": ("WhatsApp daily reports", True, None, ""),
    "qr_loyalty": ("QR loyalty", True, None, ""),
    "alerts": ("Low stock and discrepancy alerts", True, None, ""),
    "discrepancy_tracking": ("Discrepancy tracking", True, None, ""),
    "advanced_reports": ("Advanced reports with charts", True, None, ""),
    "rule_insights": ("Rule-based insights", True, None, ""),
    "reorder_suggestions": ("Automatic reorder suggestions", True, None, ""),
    "command_assistant": ("Command assistant", True, None, ""),
    "receipt_scan_simulator": ("Receipt scan simulator", True, None, ""),
}

BUSINESS_LIMITS = {
    **GROWTH_LIMITS,
    "users": ("Users", True, None, "unlimited"),
    "reports": ("Custom reports", True, None, "unlimited"),
    "forecasting": ("Forecasting", True, None, ""),
    "advanced_analytics": ("Advanced analytics", True, None, ""),
    "custom_reports": ("Custom reports", True, None, ""),
    "role_based_access": ("Role-based access", True, None, ""),
    "offline_sync": ("Offline auto-sync", True, None, ""),
    "background_audits": ("Background audits", True, None, ""),
    "bulk_import_export": ("Bulk import/export", True, None, ""),
    "excel_exports": ("Excel exports", True, None, ""),
    "api_access": ("API access", True, None, ""),
    "staff_activity_logs": ("Staff activity logs", True, None, ""),
    "multi_branch": ("Multi-branch controls", True, None, ""),
    "automation_rules": ("Automation rules", True, None, ""),
}

PLAN_DEFINITIONS = {
    "starter": {
        "name": "Starter",
        "description": "Free forever for solo owners getting started.",
        "monthly_price": 0,
        "yearly_price": 0,
        "sort_order": 1,
        "limits": STARTER_LIMITS,
    },
    "growth": {
        "name": "Growth",
        "description": "For growing SMEs that need automation and unlimited stock.",
        "monthly_price": 299,
        "yearly_price": 2990,
        "sort_order": 2,
        "limits": GROWTH_LIMITS,
    },
    "business": {
        "name": "Business",
        "description": "For established businesses needing advanced control.",
        "monthly_price": 599,
        "yearly_price": 5990,
        "sort_order": 3,
        "limits": BUSINESS_LIMITS,
    },
}
