from decimal import Decimal
from datetime import timedelta

from django.db import models
from django.db.models import Count, Sum
from django.db.models.functions import TruncDay, TruncMonth, TruncYear
from django.utils import timezone

from expenses.models import Expense
from inventory.models import Product, SupplyEntry
from sales.models import Sale
from audits.models import Discrepancy
from .models import AutomationPreferences


def advanced_analytics(user):
    today = timezone.localdate()
    month_start = today.replace(day=1)
    previous_start = (month_start - timedelta(days=1)).replace(day=1)
    sales = Sale.objects.filter(created_by=user, is_deleted=False)
    expenses = Expense.objects.filter(created_by=user, is_deleted=False, approval_status="approved")
    month_sales = sales.filter(date__gte=month_start)
    previous_sales = sales.filter(date__gte=previous_start, date__lt=month_start)
    revenue = month_sales.aggregate(total=Sum("total"))["total"] or 0
    cost = month_sales.aggregate(total=Sum("total_cost"))["total"] or 0
    profit = month_sales.aggregate(total=Sum("gross_profit"))["total"] or 0
    previous_revenue = previous_sales.aggregate(total=Sum("total"))["total"] or 0
    expenses_total = expenses.filter(date__gte=month_start).aggregate(total=Sum("amount_base"))["total"] or 0
    supply_revenue, supply_cost = supply_totals(user, month_start)
    revenue += supply_revenue
    cost += supply_cost
    profit += supply_revenue - supply_cost
    previous_revenue += supply_totals(user, previous_start, month_start)[0]
    margin = (profit / revenue * 100) if revenue else 0
    growth = ((revenue - previous_revenue) / previous_revenue * 100) if previous_revenue else None
    return {
        "revenue": revenue,
        "cost": cost,
        "gross_profit": profit,
        "expenses": expenses_total,
        "net_profit": profit - expenses_total,
        "profit_margin_percent": round(margin, 2),
        "monthly_growth_percent": round(growth, 2) if growth is not None else None,
        "inventory_value": sum(p.stock * p.price for p in Product.objects.filter(user=user, is_deleted=False)),
        "inventory_cost": sum(p.stock * p.cost_price for p in Product.objects.filter(user=user, is_deleted=False)),
    }


def rule_forecast(user, days=7):
    today = timezone.localdate()
    sales = Sale.objects.filter(created_by=user, is_deleted=False)
    recent_start = today - timedelta(days=days)
    previous_start = today - timedelta(days=days * 2)
    recent_total = sales.filter(date__gte=recent_start, date__lt=today).aggregate(total=Sum("total"))["total"] or 0
    previous_total = sales.filter(date__gte=previous_start, date__lt=recent_start).aggregate(total=Sum("total"))["total"] or 0
    daily_average = float(recent_total) / max(days, 1)
    growth_factor = 0
    if previous_total:
        growth_factor = float((recent_total - previous_total) / previous_total)
    projected = daily_average * days * (1 + growth_factor)
    return {
        "window_days": days,
        "recent_sales": recent_total,
        "previous_sales": previous_total,
        "average_daily_sales": round(daily_average, 2),
        "growth_factor": round(growth_factor, 4),
        "projected_next_period_sales": round(projected, 2),
    }


def automation_alerts(user):
    today = timezone.localdate()
    preferences, _ = AutomationPreferences.objects.get_or_create(user=user)
    rules = preferences.enabled_rules
    alerts = []
    if rules.get("low_stock", False):
        low_stock = Product.objects.filter(user=user, stock__lte=models.F("reorder_level"), is_deleted=False).count()
        if low_stock:
            alerts.append({"rule": "low_stock", "severity": preferences.severity, "message": f"{low_stock} products are at or below reorder level."})
    if rules.get("no_sales_today", False) and not Sale.objects.filter(created_by=user, date=today, is_deleted=False).exists():
        alerts.append({"rule": "no_sales_today", "severity": preferences.severity, "message": "No sales have been recorded today."})
    if rules.get("high_discrepancies", False):
        unresolved = Discrepancy.objects.filter(
            audit__conductor=user,
            audit__is_deleted=False,
            status__in=["unresolved", "investigating"],
            is_deleted=False,
        ).count()
        if unresolved >= 3:
            alerts.append({"rule": "high_discrepancies", "severity": preferences.severity, "message": f"{unresolved} stock discrepancies remain unresolved."})
    if rules.get("high_expenses", False):
        today_total = Expense.objects.filter(
            created_by=user, date=today, is_deleted=False
        ).aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
        baseline_total = Expense.objects.filter(
            created_by=user,
            date__gte=today - timedelta(days=30),
            date__lt=today,
            is_deleted=False,
        ).aggregate(total=Sum("amount_base"))["total"] or Decimal("0")
        baseline_average = baseline_total / 30
        if today_total > 0 and baseline_average > 0 and today_total >= baseline_average * Decimal("1.5"):
            alerts.append({"rule": "high_expenses", "severity": preferences.severity, "message": "Today's expenses are at least 50% above the recent daily average."})
    return {"alerts": alerts, "evaluated_at": timezone.now()}


def supply_totals(user, start=None, end=None, branch_ids=None):
    entries = SupplyEntry.objects.filter(user=user, is_deleted=False, direction="outgoing", payment_status="paid")
    if branch_ids is not None:
        entries = entries.filter(product__branch_id__in=branch_ids)
    if start:
        entries = entries.filter(movement_date__gte=start)
    if end:
        entries = entries.filter(movement_date__lt=end)
    revenue = sum((entry.quantity * entry.unit_price * entry.fx_rate_to_base for entry in entries), Decimal("0"))
    cost = sum((entry.quantity * entry.unit_cost * entry.fx_rate_to_base for entry in entries), Decimal("0"))
    return revenue.quantize(Decimal("0.01")), cost.quantize(Decimal("0.01"))


def run_custom_report(user, report, request=None):
    """Execute a saved custom report on the server with business and branch scoping."""
    from rest_framework.exceptions import PermissionDenied
    from accounts.branch_access import get_staff_member, require_staff_branch

    sales = Sale.objects.filter(created_by=user, is_deleted=False)
    staff = get_staff_member(request) if request is not None else None
    if staff:
        if not staff.branch_id:
            return []
        sales = sales.filter(branch_id=staff.branch_id)
        if report.branch_filter == "branch":
            require_staff_branch(request, report.branch_id)
        elif report.branch_filter == "unassigned":
            return []

    if report.branch_filter == "unassigned":
        sales = sales.filter(branch__isnull=True)
    elif report.branch_filter == "branch":
        if not report.branch_id:
            raise PermissionDenied("This report no longer has an available branch filter.")
        sales = sales.filter(branch_id=report.branch_id)
    if report.start_date:
        sales = sales.filter(date__gte=report.start_date)
    if report.end_date:
        sales = sales.filter(date__lte=report.end_date)

    period_function = {"day": TruncDay, "month": TruncMonth, "year": TruncYear}[report.group_by]
    metric_expressions = {
        "sales": Sum("total"),
        "profit": Sum("gross_profit"),
        "transactions": Count("id"),
    }
    selected_metrics = report.metrics or [report.metric]
    sort_order = "-period" if report.sort_order == "desc" else "period"
    groups = sales.annotate(period=period_function("date")).values("period").annotate(
        **{name: metric_expressions[name] for name in selected_metrics}
    ).order_by(sort_order)
    rows = []
    for group in groups:
        period = group["period"]
        if report.group_by == "year":
            label = period.strftime("%Y")
        elif report.group_by == "month":
            label = period.strftime("%Y-%m")
        else:
            label = period.isoformat()
        values = {}
        for metric_name in selected_metrics:
            value = group[metric_name] or 0
            if metric_name == "transactions":
                value = int(value)
            else:
                value = str(Decimal(str(value)).quantize(Decimal("0.01")))
            values[metric_name] = value
        row = {"period": label, "value": values[selected_metrics[0]]}
        if len(selected_metrics) > 1:
            row["values"] = values
        rows.append(row)
    return rows
