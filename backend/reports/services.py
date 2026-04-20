from datetime import timedelta

from django.db import models
from django.db.models import Sum
from django.utils import timezone

from expenses.models import Expense
from inventory.models import Product
from sales.models import Sale


def advanced_analytics(user):
    today = timezone.localdate()
    month_start = today.replace(day=1)
    previous_start = (month_start - timedelta(days=1)).replace(day=1)
    sales = Sale.objects.filter(created_by=user, is_deleted=False)
    expenses = Expense.objects.filter(created_by=user, is_deleted=False)
    month_sales = sales.filter(date__gte=month_start)
    previous_sales = sales.filter(date__gte=previous_start, date__lt=month_start)
    revenue = month_sales.aggregate(total=Sum("total"))["total"] or 0
    cost = month_sales.aggregate(total=Sum("total_cost"))["total"] or 0
    profit = month_sales.aggregate(total=Sum("gross_profit"))["total"] or 0
    previous_revenue = previous_sales.aggregate(total=Sum("total"))["total"] or 0
    expenses_total = expenses.filter(date__gte=month_start).aggregate(total=Sum("amount"))["total"] or 0
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
    alerts = []
    low_stock = Product.objects.filter(user=user, stock__lte=models.F("reorder_level"), is_deleted=False).count()
    if low_stock:
        alerts.append({"rule": "low_stock", "severity": "warning", "message": f"{low_stock} products are at or below reorder level."})
    if not Sale.objects.filter(created_by=user, date=today, is_deleted=False).exists():
        alerts.append({"rule": "no_sales_today", "severity": "info", "message": "No sales have been recorded today."})
    return {"alerts": alerts, "evaluated_at": timezone.now()}
