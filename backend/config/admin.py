from datetime import timedelta
from decimal import Decimal
from types import MethodType

from django.contrib import admin
from django.contrib.admin.models import LogEntry
from django.db.models import Sum
from django.utils import timezone


def _format_number(value):
    return f"{int(value or 0):,}"


def _format_amount(value):
    amount = value or Decimal("0")
    return f"{amount:,.2f}"


def _safe_count(model, **filters):
    try:
        return model.objects.filter(is_deleted=False, **filters).count()
    except Exception:
        return 0


def _safe_admin_metrics():
    try:
        from accounts.models import User
        from billing.models import ReferralRewardToken, Subscription
        from customers.models import Customer
        from inventory.models import Product
        from sales.models import Sale
    except Exception:
        return {}

    today = timezone.localdate()
    last_week = today - timedelta(days=6)

    try:
        total_revenue = Sale.objects.filter(is_deleted=False).aggregate(total=Sum("total"))["total"] or Decimal("0")
        today_revenue = Sale.objects.filter(is_deleted=False, date=today).aggregate(total=Sum("total"))["total"] or Decimal("0")
        recent_sales = list(Sale.objects.filter(is_deleted=False).select_related("created_by", "customer").order_by("-created_at")[:6])
    except Exception:
        total_revenue = Decimal("0")
        today_revenue = Decimal("0")
        recent_sales = []

    chart_days = []
    max_day_total = Decimal("1")
    for offset in range(7):
        day = last_week + timedelta(days=offset)
        try:
            day_total = Sale.objects.filter(is_deleted=False, date=day).aggregate(total=Sum("total"))["total"] or Decimal("0")
        except Exception:
            day_total = Decimal("0")
        max_day_total = max(max_day_total, day_total)
        chart_days.append({"label": day.strftime("%a"), "value": day_total})

    for item in chart_days:
        item["height"] = max(8, int((item["value"] / max_day_total) * 100)) if max_day_total else 8
        item["display"] = _format_amount(item["value"])

    try:
        recent_users = list(User.objects.order_by("-date_joined")[:5])
        user_count = User.objects.count()
    except Exception:
        recent_users = []
        user_count = 0

    try:
        recent_activity = list(LogEntry.objects.select_related("user", "content_type").order_by("-action_time")[:5])
    except Exception:
        recent_activity = []

    return {
        "verifin_metrics": [
            {
                "label": "Total Revenue",
                "value": _format_amount(total_revenue),
                "detail": f"{_format_amount(today_revenue)} today",
                "tone": "violet",
            },
            {
                "label": "Sales",
                "value": _format_number(_safe_count(Sale)),
                "detail": f"{_format_number(_safe_count(Sale, date=today))} today",
                "tone": "emerald",
            },
            {
                "label": "Products",
                "value": _format_number(_safe_count(Product)),
                "detail": f"{_format_number(_safe_count(Product, status='low') + _safe_count(Product, status='out'))} need attention",
                "tone": "amber",
            },
            {
                "label": "Active Plans",
                "value": _format_number(_safe_count(Subscription, status=Subscription.ACTIVE)),
                "detail": f"{_format_number(_safe_count(ReferralRewardToken, status=ReferralRewardToken.UNUSED))} referral tokens ready",
                "tone": "sky",
            },
        ],
        "verifin_chart_days": chart_days,
        "verifin_recent_sales": recent_sales,
        "verifin_recent_users": recent_users,
        "verifin_recent_activity": recent_activity,
        "verifin_snapshot": {
            "customers": _format_number(_safe_count(Customer)),
            "users": _format_number(user_count),
            "low_stock": _format_number(_safe_count(Product, status="low") + _safe_count(Product, status="out")),
        },
    }


def configure_admin_site():
    if getattr(admin.site, "_verifin_configured", False):
        return

    original_each_context = admin.site.each_context

    def each_context(self, request):
        context = original_each_context(request)
        context.update(_safe_admin_metrics())
        return context

    admin.site.site_header = "Verifin Command Center"
    admin.site.site_title = "Verifin Admin"
    admin.site.index_title = "Operations Overview"
    admin.site.index_template = "admin/verifin_index.html"
    admin.site.each_context = MethodType(each_context, admin.site)
    admin.site._verifin_configured = True
