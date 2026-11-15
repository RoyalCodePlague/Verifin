import calendar
from collections import defaultdict
from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Count, Q, Sum
from django.utils import timezone

from customers.models import Customer
from expenses.financial_services import get_budget_actual
from expenses.models import Expense, ExpenseBudget, OtherIncome
from inventory.models import (
    Branch,
    Product,
    PurchaseCostHistory,
    PurchaseOrder,
    SupplyEntry,
    SupplierPayment,
    SupplierReturn,
)
from sales.models import Sale, SaleItem, SaleReturn
from inventory.supplier_financial_services import get_purchase_orders_received_totals_base

from .models import AccountTransaction, BusinessInsight

ZERO = Decimal("0")


def _money(value):
    return str(Decimal(value or 0).quantize(Decimal("0.01")))


def _json_safe(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _period_label(name, start, end, partial=False):
    inclusive_end = end - timedelta(days=1)
    suffix = " (partial period)" if partial else ""
    return f"{name}: {start.isoformat()} to {inclusive_end.isoformat()}{suffix}"


def _candidate(rule_key, title, explanation, figures, start, end, label, severity, action, link):
    return {
        "rule_key": rule_key,
        "title": title,
        "explanation": explanation,
        "supporting_figures": _json_safe(figures),
        "period_start": start,
        "period_end": end - timedelta(days=1),
        "period_label": label,
        "severity": severity,
        "recommended_action": action,
        "link": link,
    }


def _change_percent(current, previous):
    if previous <= ZERO:
        return None
    return (current - previous) * Decimal("100") / previous


def _sales_periods(today):
    month_start = today.replace(day=1)
    prior_month_start = (month_start - timedelta(days=1)).replace(day=1)
    elapsed_days = (today - month_start).days + 1
    prior_month_end = min(prior_month_start + timedelta(days=elapsed_days), month_start)
    return {
        "mtd": (month_start, today + timedelta(days=1)),
        "prior_mtd": (prior_month_start, prior_month_end),
        "last_7": (today - timedelta(days=7), today),
        "prior_7": (today - timedelta(days=14), today - timedelta(days=7)),
        "last_30": (today - timedelta(days=30), today),
        "prior_30": (today - timedelta(days=60), today - timedelta(days=30)),
        "last_90": (today - timedelta(days=90), today),
    }


def _profit_loss(user, start, end, branch_ids=None):
    from .views import ProfitLossView

    return ProfitLossView._summarize(user, start, end, branch_ids)


def _sales_insights(user, today, periods):
    results = []
    current_start, current_end = periods["mtd"]
    previous_start, previous_end = periods["prior_mtd"]
    current = _profit_loss(user, current_start, current_end)
    previous = _profit_loss(user, previous_start, previous_end)
    current_sales = current["net_sales"]
    previous_sales = previous["net_sales"]
    change = _change_percent(current_sales, previous_sales)
    mtd_label = (
        f"Month to date through {today.isoformat()} compared with the same elapsed days "
        f"of the previous month (both partial periods)"
    )
    if change is not None and abs(change) >= Decimal("10"):
        direction = "increased" if change > 0 else "declined"
        results.append(_candidate(
            "sales.mtd_trend",
            f"Net sales {direction} {abs(change):.1f}% month to date",
            f"Net sales {direction} by {abs(change):.1f}% compared with the same elapsed days of the previous month. "
            "This is revenue after discounts and returns, not cash received.",
            {
                "current_net_sales": _money(current_sales),
                "previous_matching_period_net_sales": _money(previous_sales),
                "change_amount": _money(current_sales - previous_sales),
                "change_percent": round(change, 2),
                "comparison": "matching elapsed days; both periods are partial",
            },
            current_start, current_end, mtd_label,
            "info" if change > 0 else "medium",
            "Review the sales report and compare the products or channels driving the change.",
            "/reports",
        ))

    current_start, current_end = periods["last_7"]
    previous_start, previous_end = periods["prior_7"]
    current = _profit_loss(user, current_start, current_end)
    previous = _profit_loss(user, previous_start, previous_end)
    change = _change_percent(current["net_sales"], previous["net_sales"])
    weekly_label = (
        f"Last 7 complete days ({current_start.isoformat()} to {(current_end - timedelta(days=1)).isoformat()}) "
        f"compared with the preceding 7 complete days"
    )
    if change is not None and abs(change) >= Decimal("15"):
        direction = "increased" if change > 0 else "declined"
        results.append(_candidate(
            "sales.weekly_trend",
            f"Net sales {direction} {abs(change):.1f}% over the last complete week",
            f"Net sales {direction} by {abs(change):.1f}% between two complete 7-day periods.",
            {
                "current_net_sales": _money(current["net_sales"]),
                "previous_net_sales": _money(previous["net_sales"]),
                "change_amount": _money(current["net_sales"] - previous["net_sales"]),
                "change_percent": round(change, 2),
                "comparison": "two complete 7-day periods",
            },
            current_start, current_end, weekly_label,
            "info" if change > 0 else "medium",
            "Review daily sales and transaction counts for the two periods.",
            "/reports",
        ))

    today_sales = Sale.objects.filter(
        created_by=user, is_deleted=False, date=today,
    ).aggregate(total=Sum("total"), count=Count("id"))
    if today_sales["count"]:
        today_summary = _profit_loss(user, today, today + timedelta(days=1))
        results.append(_candidate(
            "sales.today_performance",
            "Sales recorded today",
            "This is a live, partial-day figure. It is not compared with complete days.",
            {"recorded_sales": today_sales["count"], "net_sales": _money(today_summary["net_sales"]),
             "cash_received": _money(today_summary["cash_received"])},
            today, today + timedelta(days=1),
            f"Today through the current time ({today.isoformat()}; partial day)",
            "info", "Review today's sales and cash-received figures separately.",
            "/sales",
        ))

    item_rows = list(SaleItem.objects.filter(
        sale__created_by=user,
        sale__is_deleted=False,
        sale__date__gte=periods["mtd"][0],
        sale__date__lt=periods["mtd"][1],
        is_deleted=False,
    ).values("product_id", "product__name").annotate(
        quantity=Sum("quantity"),
        revenue=Sum("subtotal"),
        cost=Sum("cost_total"),
        profit=Sum("profit"),
    ))
    return_rows = SaleReturn.objects.filter(
        sale_item__sale__created_by=user,
        sale_item__sale__is_deleted=False,
        return_date__gte=periods["mtd"][0],
        return_date__lt=periods["mtd"][1],
        is_deleted=False,
    ).values("sale_item__product_id").annotate(
        quantity=Sum("quantity"),
        refund=Sum("refund_amount"),
        cost=Sum("cost_amount"),
    )
    returned = {row["sale_item__product_id"]: row for row in return_rows}
    for row in item_rows:
        returned_row = returned.get(row["product_id"], {})
        row["quantity"] = (row["quantity"] or 0) - (returned_row.get("quantity") or 0)
        row["revenue"] = (row["revenue"] or ZERO) - (returned_row.get("refund") or ZERO)
        row["profit"] = (
            (row["profit"] or ZERO) - (returned_row.get("refund") or ZERO)
            + (returned_row.get("cost") or ZERO)
        )
    item_rows = [row for row in item_rows if row["quantity"] > 0 and row["revenue"] > ZERO]
    product_label = _period_label("Month to date", *periods["mtd"], partial=True)
    if item_rows:
        best_seller = max(item_rows, key=lambda row: row["quantity"])
        results.append(_candidate(
            "sales.best_seller",
            f"{best_seller['product__name']} is the best-selling product this month",
            f"It has the highest net quantity sold among recorded products this month.",
            {"product": best_seller["product__name"], "net_units_sold": best_seller["quantity"],
             "net_sales": _money(best_seller["revenue"])},
            *periods["mtd"], product_label, "info",
            "Check its current stock and reorder level.",
            "/inventory",
        ))
        best_revenue = max(item_rows, key=lambda row: row["revenue"])
        results.append(_candidate(
            "sales.top_revenue_product",
            f"{best_revenue['product__name']} generated the most product sales",
            "This product has the highest net sales value for the month to date, after recorded returns.",
            {"product": best_revenue["product__name"], "net_sales": _money(best_revenue["revenue"]),
             "net_units_sold": best_revenue["quantity"]},
            *periods["mtd"], product_label, "info",
            "Review its sales volume and stock availability.",
            "/inventory",
        ))
        profitable = [row for row in item_rows if row["profit"] > ZERO]
        total_profit = sum((row["profit"] for row in item_rows), ZERO)
        if profitable and total_profit > ZERO:
            best_profit = max(profitable, key=lambda row: row["profit"])
            share = best_profit["profit"] * Decimal("100") / total_profit
            results.append(_candidate(
                "sales.top_profit_product",
                f"{best_profit['product__name']} leads product gross profit",
                "This product contributed the largest share of recorded product gross profit month to date.",
                {"product": best_profit["product__name"], "gross_profit": _money(best_profit["profit"]),
                 "share_of_product_gross_profit_percent": round(share, 2)},
                *periods["mtd"], product_label, "info",
                "Protect availability and review its historical purchase costs and selling price.",
                "/reports",
            ))

    # Compare net units over two complete, equal 30-day windows. Returns are
    # counted on their recorded return date so the observation follows the same
    # transaction periods as the other sales reports.
    current_start, current_end = periods["last_30"]
    previous_start, previous_end = periods["prior_30"]
    product_units = {}
    for period_name, start, end in (
        ("current", current_start, current_end),
        ("previous", previous_start, previous_end),
    ):
        sold = SaleItem.objects.filter(
            sale__created_by=user, sale__is_deleted=False,
            sale__date__gte=start, sale__date__lt=end,
            product__is_deleted=False, is_deleted=False,
        ).values("product_id", "product__name").annotate(quantity=Sum("quantity"))
        returned = SaleReturn.objects.filter(
            sale_item__sale__created_by=user, sale_item__sale__is_deleted=False,
            sale_item__product__is_deleted=False,
            return_date__gte=start, return_date__lt=end, is_deleted=False,
        ).values("sale_item__product_id", "sale_item__product__name").annotate(quantity=Sum("quantity"))
        period_units = {
            row["product_id"]: {
                "name": row["product__name"],
                "units": row["quantity"] or 0,
            }
            for row in sold
        }
        for row in returned:
            product_id = row["sale_item__product_id"]
            if product_id in period_units:
                period_units[product_id]["units"] -= row["quantity"] or 0
            else:
                name = row["sale_item__product__name"]
                if name:
                    period_units[product_id] = {"name": name, "units": -(row["quantity"] or 0)}
        for product_id, row in period_units.items():
            product_units.setdefault(product_id, {"name": row["name"], "current": 0, "previous": 0})
            product_units[product_id][period_name] = row["units"]

    declining_products = []
    for row in product_units.values():
        previous_units = row["previous"]
        current_units = row["current"]
        units_lost = previous_units - current_units
        if previous_units >= 2 and units_lost >= 2:
            decline_percent = Decimal(units_lost) * Decimal("100") / Decimal(previous_units)
            if decline_percent >= Decimal("25"):
                declining_products.append({
                    "product": row["name"],
                    "previous_30_day_net_units": previous_units,
                    "current_30_day_net_units": current_units,
                    "units_decreased": units_lost,
                    "decline_percent": round(decline_percent, 2),
                })
    if declining_products:
        declining_products.sort(key=lambda row: (row["decline_percent"], row["units_decreased"]), reverse=True)
        results.append(_candidate(
            "sales.declining_products",
            f"{len(declining_products)} products had lower sales volume",
            "Net units sold fell by at least two units and 25% compared with the preceding complete 30-day period. Recorded returns are counted in the period they were processed.",
            {"products": declining_products[:10], "comparison": "two complete 30-day periods"},
            current_start, current_end,
            _period_label("Last 30 complete days compared with the preceding 30 days", current_start, current_end),
            "medium", "Review the product's availability, recent returns, and sales history.",
            "/inventory",
        ))

    sale_summary = Sale.objects.filter(
        created_by=user, is_deleted=False, date__gte=periods["mtd"][0], date__lt=periods["mtd"][1]
    ).aggregate(total=Sum("total"), count=Count("id"))
    if sale_summary["count"] and sale_summary["count"] >= 3:
        average = (sale_summary["total"] or ZERO) / sale_summary["count"]
        results.append(_candidate(
            "sales.average_transaction_value",
            "Average transaction value this month",
            "This is recorded sale revenue divided by the number of sales; it is not a cash-received measure.",
            {"average_transaction_value": _money(average), "recorded_sales": sale_summary["count"],
             "recorded_sales_total": _money(sale_summary["total"])},
            *periods["mtd"], product_label, "info",
            "Compare transaction value with product mix and discount activity.",
            "/sales",
        ))

    sales_90 = list(Sale.objects.filter(
        created_by=user, is_deleted=False,
        date__gte=periods["last_90"][0], date__lt=periods["last_90"][1],
    ).values_list("date", "total"))
    if len(sales_90) >= 10:
        totals_by_weekday = defaultdict(lambda: [ZERO, 0])
        for sale_date, total in sales_90:
            totals_by_weekday[sale_date.weekday()][0] += total
            totals_by_weekday[sale_date.weekday()][1] += 1
        if len(totals_by_weekday) >= 3:
            weekday, (total, count) = max(
                totals_by_weekday.items(), key=lambda entry: entry[1][0] / entry[1][1]
            )
            day_name = calendar.day_name[weekday]
            results.append(_candidate(
                "sales.peak_weekday",
                f"{day_name} has the highest average sales",
                "Among weekdays with recorded sales, this day has the highest average sale total over the last 90 complete days.",
                {"weekday": day_name, "average_sales": _money(total / count),
                 "sales_total": _money(total), "sales_count": count},
                *periods["last_90"], _period_label("Last 90 complete days", *periods["last_90"]),
                "info", "Use the sales report to review staffing and stock for this weekday.", "/sales",
            ))

    current_start, current_end = periods["mtd"]
    cashier_rows = Sale.objects.filter(
        created_by=user, is_deleted=False, date__gte=current_start, date__lt=current_end,
        till_session__isnull=False, till_session__cashier_name__gt="",
    ).values("till_session__cashier_name").annotate(
        total=Sum("total"), count=Count("id"),
    ).order_by("-total")
    cashier = cashier_rows.first()
    if cashier and cashier_rows.count() > 1:
        name = cashier["till_session__cashier_name"]
        results.append(_candidate(
            "sales.top_cashier",
            f"{name} recorded the highest sales this month",
            "Sales are grouped by the cashier name recorded on each linked till session.",
            {"cashier": name, "recorded_sales": _money(cashier["total"]), "transaction_count": cashier["count"]},
            *periods["mtd"], product_label, "info",
            "Review sales performance alongside transaction counts and returns.",
            "/sales",
        ))

    employee_rows = list(Sale.objects.filter(
        created_by=user, is_deleted=False, date__gte=current_start, date__lt=current_end,
        till_session__opened_by_staff__isnull=False,
    ).values(
        "till_session__opened_by_staff_id", "till_session__opened_by_staff__name",
    ).annotate(total=Sum("total"), count=Count("id")).order_by("-total"))
    if len(employee_rows) > 1:
        leader = employee_rows[0]
        results.append(_candidate(
            "sales.top_employee",
            f"{leader['till_session__opened_by_staff__name']} recorded the most sales this month",
            "Sales are grouped by the staff member who opened the linked till session. Values are recorded sale totals before returns.",
            {"employee": leader["till_session__opened_by_staff__name"],
             "recorded_sales": _money(leader["total"]), "transaction_count": leader["count"],
             "employees_compared": len(employee_rows)},
            *periods["mtd"], product_label, "info",
            "Review sales alongside each employee's transaction counts and shift activity.",
            "/sales",
        ))

    branch_rows = list(Sale.objects.filter(
        created_by=user, is_deleted=False, date__gte=current_start, date__lt=current_end, branch__isnull=False,
    ).values("branch_id", "branch__name").annotate(total=Sum("total"), count=Count("id")).order_by("-total"))
    if len(branch_rows) > 1:
        branches = {branch.id: branch for branch in Branch.objects.filter(
            user=user, id__in=[row["branch_id"] for row in branch_rows], is_deleted=False,
        )}
        branch_figures = []
        for row in branch_rows:
            branch = branches.get(row["branch_id"])
            active_days = max((current_end - max(current_start, branch.opening_date)).days, 0) if branch else (current_end - current_start).days
            branch_figures.append({
                "branch": row["branch__name"], "recorded_sales": _money(row["total"]),
                "transaction_count": row["count"], "active_days_in_period": active_days,
            })
        results.append(_candidate(
            "sales.branch_performance",
            "Recorded sales by branch this month",
            "The figures show recorded sale totals before returns. Active days are included because branch opening dates can differ.",
            {"branches": branch_figures, "unassigned_sales_excluded": True},
            *periods["mtd"], product_label, "info",
            "Review branch sales alongside stock levels, returns, and operating costs.",
            "/reports",
        ))

    branch_profit_rows = list(Sale.objects.filter(
        created_by=user, is_deleted=False, date__gte=current_start, date__lt=current_end, branch__isnull=False,
    ).values("branch_id", "branch__name").annotate(gross_profit=Sum("gross_profit")).order_by("-gross_profit"))
    if len(branch_profit_rows) > 1:
        returns_by_branch = SaleReturn.objects.filter(
            sale_item__sale__created_by=user, sale_item__sale__is_deleted=False,
            return_date__gte=current_start, return_date__lt=current_end, is_deleted=False,
        ).values("sale_item__sale__branch_id").annotate(
            refunds=Sum("refund_amount"), returned_cost=Sum("cost_amount"),
        )
        return_map = {row["sale_item__sale__branch_id"]: row for row in returns_by_branch}
        for branch in branch_profit_rows:
            returned_row = return_map.get(branch["branch_id"], {})
            branch["adjusted_gross_profit"] = (
                (branch["gross_profit"] or ZERO) - (returned_row.get("refunds") or ZERO)
                + (returned_row.get("returned_cost") or ZERO)
            )
        leader = max(branch_profit_rows, key=lambda row: row["adjusted_gross_profit"])
        results.append(_candidate(
            "financial.top_branch_gross_profit",
            f"{leader['branch__name']} leads recorded branch gross profit",
            "This uses recorded sales cost and returns. Gross profit is before branch operating expenses and is not net profit.",
            {"branch": leader["branch__name"], "gross_profit": _money(leader["adjusted_gross_profit"]),
             "branch_expenses_included": False},
            *periods["mtd"], product_label, "info",
            "Review branch net-profit figures alongside this gross-profit result.",
            "/reports",
        ))
    return results


def _expense_insights(user, periods):
    results = []
    today = timezone.localdate()
    active_budgets = ExpenseBudget.objects.filter(
        user=user,
        is_deleted=False,
        period_start__lte=today,
        period_end__gte=today,
    ).select_related("category", "branch")
    for budget in active_budgets:
        spent = get_budget_actual(budget, through_date=today)
        if spent <= budget.amount_base:
            continue
        category = budget.category.name if budget.category_id else "All categories"
        branch = budget.branch.name if budget.branch_id else "All branches"
        period_end = budget.period_end + timedelta(days=1)
        results.append(_candidate(
            f"expenses.budget_overrun.{budget.pk}",
            f"{category} spending is over budget",
            f"Recorded {budget.expense_type} expenses for {category.lower()} in {branch.lower()} exceeded the budget during this period.",
            {
                "budget_id": budget.pk,
                "category": category,
                "branch": branch,
                "expense_type": budget.expense_type,
                "budget_amount": _money(budget.amount_base),
                "spent_amount": _money(spent),
                "over_budget_amount": _money(spent - budget.amount_base),
                "percent_used": round(spent * Decimal("100") / budget.amount_base, 2),
            },
            budget.period_start,
            period_end,
            _period_label("Budget period", budget.period_start, period_end),
            "high",
            "Review the transactions in this budget and adjust the plan or spending as needed.",
            "/expenses",
        ))

    current_start, current_end = periods["last_30"]
    previous_start, previous_end = periods["prior_30"]
    current_label = _period_label("Last 30 complete days", current_start, current_end)
    current_total = Expense.objects.filter(
        created_by=user, is_deleted=False, approval_status="approved", date__gte=current_start, date__lt=current_end,
    ).aggregate(total=Sum("amount_base"))["total"] or ZERO
    previous_total = Expense.objects.filter(
        created_by=user, is_deleted=False, approval_status="approved", date__gte=previous_start, date__lt=previous_end,
    ).aggregate(total=Sum("amount_base"))["total"] or ZERO
    category_rows = Expense.objects.filter(
        created_by=user, is_deleted=False, approval_status="approved", date__gte=current_start, date__lt=current_end,
    ).values("category_id", "category__name").annotate(total=Sum("amount_base")).order_by("-total")
    leader = category_rows.first()
    if leader and (leader["total"] or ZERO) > ZERO:
        name = leader["category__name"] or "Uncategorised"
        results.append(_candidate(
            "expenses.top_category",
            f"{name} is the largest expense category",
            "This category has the highest recorded expense total in the last 30 complete days.",
            {"category": name, "amount": _money(leader["total"]),
             "share_of_expenses_percent": round(leader["total"] * Decimal("100") / current_total, 2) if current_total else 0},
            current_start, current_end, current_label, "info",
            "Review the category transactions and receipts for potential savings.",
            "/expenses",
        ))

    current_by_category = {
        (row["category_id"], row["category__name"] or "Uncategorised"): row["total"] or ZERO
        for row in category_rows
    }
    previous_by_category = {
        (row["category_id"], row["category__name"] or "Uncategorised"): row["total"] or ZERO
        for row in Expense.objects.filter(
            created_by=user, is_deleted=False, approval_status="approved", date__gte=previous_start, date__lt=previous_end,
        ).values("category_id", "category__name").annotate(total=Sum("amount_base"))
    }
    for (category_id, name), amount in current_by_category.items():
        old_amount = previous_by_category.get((category_id, name), ZERO)
        change = _change_percent(amount, old_amount)
        if change is not None and change >= Decimal("25") and amount - old_amount >= Decimal("100"):
            results.append(_candidate(
                f"expenses.category_trend.{category_id or 'uncategorised'}",
                f"{name} expenses increased {change:.1f}%",
                "This category increased by at least 25% and 100 base-currency units compared with the preceding complete 30-day period.",
                {"category": name, "current_amount": _money(amount), "previous_amount": _money(old_amount),
                 "change_amount": _money(amount - old_amount), "change_percent": round(change, 2)},
                current_start, current_end, current_label, "medium",
                "Review the underlying transactions and confirm whether the increase is expected.",
                "/expenses",
            ))

    p_and_l_current = _profit_loss(user, current_start, current_end)
    p_and_l_previous = _profit_loss(user, previous_start, previous_end)
    expense_growth = _change_percent(current_total, previous_total)
    revenue_growth = _change_percent(p_and_l_current["net_sales"], p_and_l_previous["net_sales"])
    if (expense_growth is not None and revenue_growth is not None
            and expense_growth >= revenue_growth + Decimal("10")):
        results.append(_candidate(
            "expenses.growing_faster_than_sales",
            "Expenses are growing faster than net sales",
            "Operating and other recorded expenses increased faster than net sales between two complete 30-day periods.",
            {"expense_change_percent": round(expense_growth, 2), "net_sales_change_percent": round(revenue_growth, 2),
             "current_expenses": _money(current_total), "previous_expenses": _money(previous_total)},
            current_start, current_end, current_label, "high",
            "Review increased expense categories before committing to additional spending.",
            "/expenses",
        ))

    recent_expenses = Expense.objects.filter(
        created_by=user, is_deleted=False, approval_status="approved", date__gte=periods["last_90"][0], date__lt=periods["last_90"][1],
    ).values("description", "amount_base", "date")
    by_description = defaultdict(list)
    for expense in recent_expenses:
        key = " ".join((expense["description"] or "").casefold().split())
        if key:
            by_description[key].append(expense)
    recurring = []
    for rows in by_description.values():
        months = {row["date"].strftime("%Y-%m") for row in rows}
        amounts = [row["amount_base"] or ZERO for row in rows]
        average = sum(amounts, ZERO) / len(amounts) if amounts else ZERO
        if len(months) >= 3 and average > ZERO and (max(amounts) - min(amounts)) <= average * Decimal("0.10"):
            recurring.append((rows[0]["description"], len(rows), average))
    if recurring:
        description, count, average = max(recurring, key=lambda item: item[1])
        results.append(_candidate(
            "expenses.recurring_pattern",
            "A repeated expense pattern was detected",
            f"{description} has a recorded expense in at least three different months with amounts within 10% of their average.",
            {"description": description, "occurrences": count, "average_amount": _money(average)},
            *periods["last_90"], _period_label("Last 90 complete days", *periods["last_90"]),
            "info", "Confirm whether this is a planned recurring expense and keep its supporting receipts.",
            "/expenses",
        ))

    branches = list(Branch.objects.filter(user=user, is_deleted=False).order_by("opening_date", "id"))
    unassigned_expenses = Expense.objects.filter(
        created_by=user, is_deleted=False, approval_status="approved", branch__isnull=True,
        date__gte=current_start, date__lt=current_end,
    ).exists()
    if len(branches) > 1 and not unassigned_expenses:
        branch_expenses = []
        for branch in branches:
            branch_start = max(current_start, branch.opening_date)
            active_days = (current_end - branch_start).days
            if active_days <= 0:
                continue
            total = Expense.objects.filter(
                created_by=user, branch=branch, is_deleted=False, approval_status="approved",
                date__gte=branch_start, date__lt=current_end,
            ).aggregate(total=Sum("amount_base"))["total"] or ZERO
            branch_expenses.append({
                "branch": branch.name,
                "expense_total": total,
                "active_days": active_days,
                "average_expense_per_active_day": total / active_days,
            })
        if len(branch_expenses) > 1 and any(row["expense_total"] > ZERO for row in branch_expenses):
            branch_expenses.sort(key=lambda row: row["average_expense_per_active_day"], reverse=True)
            highest = branch_expenses[0]
            lowest = branch_expenses[-1]
            difference = highest["average_expense_per_active_day"] - lowest["average_expense_per_active_day"]
            if difference >= Decimal("1.00"):
                results.append(_candidate(
                    "expenses.branch_differences",
                    f"{highest['branch']} has the highest average daily expense",
                    "Approved branch expenses are compared by average per active day over the last 30 complete days. Branch opening dates are included.",
                    {"branches": [{
                        "branch": row["branch"],
                        "expense_total": _money(row["expense_total"]),
                        "active_days": row["active_days"],
                        "average_expense_per_active_day": _money(row["average_expense_per_active_day"]),
                    } for row in branch_expenses],
                     "daily_average_difference": _money(difference),
                     "unassigned_expenses_excluded": False},
                    current_start, current_end, current_label, "info",
                    "Review branch expense categories and confirm that costs are assigned to the correct locations.",
                    "/expenses",
                ))
    return results


def _inventory_insights(user, periods):
    results = []
    products = list(Product.objects.filter(user=user, is_deleted=False).select_related("preferred_supplier"))
    low_stock = [product for product in products if product.stock <= product.reorder_level]
    inventory_label = "Current inventory snapshot"
    if low_stock:
        results.append(_candidate(
            "inventory.low_stock",
            f"{len(low_stock)} products are at or below reorder level",
            "These products have recorded stock at or below their configured reorder level.",
            {"count": len(low_stock), "products": [
                {"id": product.id, "name": product.name, "stock": product.stock,
                 "reorder_level": product.reorder_level}
                for product in sorted(low_stock, key=lambda item: item.stock - item.reorder_level)[:10]
            ]},
            timezone.localdate(), timezone.localdate() + timedelta(days=1), inventory_label,
            "high" if any(product.stock <= 0 for product in low_stock) else "medium",
            "Review availability and create a purchase order if replenishment is approved.",
            "/inventory",
        ))

    sold_rows = SaleItem.objects.filter(
        sale__created_by=user, sale__is_deleted=False,
        sale__date__gte=periods["last_90"][0], sale__date__lt=periods["last_90"][1], is_deleted=False,
    ).values("product_id").annotate(quantity=Sum("quantity"))
    sold_by_product = {row["product_id"]: row["quantity"] or 0 for row in sold_rows}
    return_rows = SaleReturn.objects.filter(
        sale_item__sale__created_by=user, sale_item__sale__is_deleted=False,
        return_date__gte=periods["last_90"][0], return_date__lt=periods["last_90"][1], is_deleted=False,
    ).values("sale_item__product_id").annotate(quantity=Sum("quantity"))
    for row in return_rows:
        sold_by_product[row["sale_item__product_id"]] = max(
            0, sold_by_product.get(row["sale_item__product_id"], 0) - (row["quantity"] or 0)
        )
    likely_out = []
    excess = []
    non_moving = []
    slow = []
    for product in products:
        sold = sold_by_product.get(product.id, 0)
        if product.stock > 0 and sold > 0:
            days_remaining = Decimal(product.stock) * Decimal("90") / Decimal(sold)
            lead_time = product.preferred_supplier.lead_time_days if product.preferred_supplier else 7
            if days_remaining <= lead_time + 7:
                likely_out.append((product, days_remaining, lead_time, sold))
            daily_demand = Decimal(sold) / Decimal("90")
            if Decimal(product.stock) > max(Decimal(product.reorder_level), daily_demand * Decimal("180")):
                excess.append((product, sold))
            if sold <= 2:
                slow.append((product, sold))
        elif product.stock > 0:
            non_moving.append(product)

    if likely_out:
        results.append(_candidate(
            "inventory.runout_risk",
            f"{len(likely_out)} products may run out soon",
            "Estimated days of stock are no greater than the preferred supplier lead time plus a 7-day buffer. Estimates use net units sold during the last 90 complete days.",
            {"products": [
                {"id": product.id, "name": product.name, "stock": product.stock,
                 "net_units_sold_last_90_days": sold, "estimated_days_remaining": round(float(days), 1),
                 "supplier_lead_time_days": lead_time}
                for product, days, lead_time, sold in sorted(likely_out, key=lambda item: item[1])[:10]
            ]},
            *periods["last_90"], _period_label("Demand: last 90 complete days", *periods["last_90"]),
            "high", "Check the stock count and supplier delivery time before placing an order.",
            "/inventory/intelligence",
        ))
    if excess:
        results.append(_candidate(
            "inventory.excess_stock",
            f"{len(excess)} products hold more than 180 days of recorded demand",
            "Current stock exceeds twice the 90-day demand, using recorded net sales and current product stock.",
            {"products": [{"id": product.id, "name": product.name, "stock": product.stock,
                           "net_units_sold_last_90_days": sold} for product, sold in excess[:10]]},
            *periods["last_90"], _period_label("Demand: last 90 complete days", *periods["last_90"]),
            "medium", "Review stock ageing and upcoming demand before making purchasing decisions.",
            "/inventory/intelligence",
        ))
    if non_moving:
        results.append(_candidate(
            "inventory.non_moving",
            f"{len(non_moving)} stocked products had no recorded sales in 90 days",
            "These products have stock on hand but no recorded net sales during the measured period.",
            {"count": len(non_moving), "products": [
                {"id": product.id, "name": product.name, "stock": product.stock}
                for product in sorted(non_moving, key=lambda item: item.stock, reverse=True)[:10]
            ]},
            *periods["last_90"], _period_label("Last 90 complete days", *periods["last_90"]),
            "medium", "Review stock ageing and confirm whether the items are still in demand.",
            "/inventory/intelligence",
        ))
    if slow:
        results.append(_candidate(
            "inventory.slow_moving",
            f"{len(slow)} stocked products sold two or fewer units in 90 days",
            "Slow-moving products are defined here as products with stock on hand and no more than two net units sold in the last 90 complete days.",
            {"products": [{"id": product.id, "name": product.name, "stock": product.stock,
                           "net_units_sold_last_90_days": sold} for product, sold in slow[:10]]},
            *periods["last_90"], _period_label("Last 90 complete days", *periods["last_90"]),
            "info", "Review their sales history and stock position before reordering.",
            "/inventory/intelligence",
        ))

    changes = defaultdict(list)
    for record in PurchaseCostHistory.objects.filter(
        product__user=user, product__is_deleted=False, is_deleted=False,
    ).select_related("product", "supplier").order_by("product_id", "supplier_id", "-created_at"):
        changes[(record.product_id, record.supplier_id)].append(record)
    for records in changes.values():
        if len(records) < 2:
            continue
        latest, previous = records[0], records[1]
        if previous.unit_cost_base <= ZERO:
            continue
        percent = (latest.unit_cost_base - previous.unit_cost_base) * Decimal("100") / previous.unit_cost_base
        if abs(percent) >= Decimal("5"):
            direction = "increased" if percent > 0 else "decreased"
            latest_date = timezone.localtime(latest.created_at).date()
            previous_date = timezone.localtime(previous.created_at).date()
            period_start = min(latest_date, previous_date)
            period_end = max(latest_date, previous_date) + timedelta(days=1)
            results.append(_candidate(
                f"inventory.purchase_cost.{latest.product_id}.{latest.supplier_id}",
                f"{latest.product.name}'s recorded purchase cost {direction}",
                f"The latest recorded cost from {latest.supplier.name} {direction} by {abs(percent):.1f}% compared with the preceding receipt.",
                {"product": latest.product.name, "supplier": latest.supplier.name,
                 "latest_unit_cost_base": _money(latest.unit_cost_base),
                 "previous_unit_cost_base": _money(previous.unit_cost_base), "change_percent": round(percent, 2)},
                period_start, period_end,
                f"Latest recorded receipt: {latest_date.isoformat()}; previous receipt: {previous_date.isoformat()}",
                "medium" if percent > 0 else "info",
                "Review the supplier invoice and update future pricing only after approval.",
                "/suppliers",
            ))

    current_start, current_end = periods["last_30"]
    product_rows = list(SaleItem.objects.filter(
        sale__created_by=user, sale__is_deleted=False,
        sale__date__gte=current_start, sale__date__lt=current_end, is_deleted=False,
    ).values("product_id", "product__name").annotate(
        revenue=Sum("subtotal"), profit=Sum("profit"),
    ))
    product_returns = SaleReturn.objects.filter(
        sale_item__sale__created_by=user, sale_item__sale__is_deleted=False,
        return_date__gte=current_start, return_date__lt=current_end, is_deleted=False,
    ).values("sale_item__product_id").annotate(refund=Sum("refund_amount"), cost=Sum("cost_amount"))
    return_map = {row["sale_item__product_id"]: row for row in product_returns}
    poor_margins = []
    for row in product_rows:
        returned_row = return_map.get(row["product_id"], {})
        revenue = (row["revenue"] or ZERO) - (returned_row.get("refund") or ZERO)
        profit = (row["profit"] or ZERO) - (returned_row.get("refund") or ZERO) + (returned_row.get("cost") or ZERO)
        if revenue > ZERO:
            margin = profit * Decimal("100") / revenue
            if margin < Decimal("10"):
                poor_margins.append((row, revenue, profit, margin))
    if poor_margins:
        results.append(_candidate(
            "inventory.low_margin_products",
            f"{len(poor_margins)} products had gross margins below 10%",
            "Margins use recorded sale prices, historical sale costs, and returns from the last 30 complete days.",
            {"products": [{"name": row["product__name"], "net_sales": _money(revenue),
                           "gross_profit": _money(profit), "gross_margin_percent": round(margin, 2)}
                          for row, revenue, profit, margin in sorted(poor_margins, key=lambda item: item[3])[:10]]},
            *periods["last_30"], _period_label("Last 30 complete days", *periods["last_30"]),
            "high", "Review recorded product costs, approved discounts, and selling prices.",
            "/reports",
        ))
    return results


def _financial_insights(user, today, periods):
    results = []
    current_start, current_end = periods["last_30"]
    previous_start, previous_end = periods["prior_30"]
    current = _profit_loss(user, current_start, current_end)
    previous = _profit_loss(user, previous_start, previous_end)
    label = _period_label("Last 30 complete days", current_start, current_end)
    for field, title in (
        ("gross_profit", "Gross profit"),
        ("net_profit", "Net profit"),
    ):
        current_value = current[field]
        previous_value = previous[field]
        difference = current_value - previous_value
        pct = _change_percent(current_value, previous_value)
        if abs(difference) >= Decimal("0.01"):
            direction = "increased" if difference > ZERO else "decreased"
            results.append(_candidate(
                f"financial.{field}_trend",
                f"{title} {direction} compared with the previous 30 days",
                f"{title} {direction} by {_money(abs(difference))} between two complete 30-day periods.",
                {"current": _money(current_value), "previous": _money(previous_value),
                 "change_amount": _money(difference), "change_percent": round(pct, 2) if pct is not None else None,
                 "comparison": "two complete 30-day periods"},
                current_start, current_end, label, "info" if difference > ZERO else "medium",
                "Review the profit and loss report, including returns, costs, and expenses.",
                "/reports",
            ))

    if current["net_sales"] > ZERO:
        expense_share = current["operating_expenses"] / current["net_sales"] * Decimal("100")
        if expense_share >= Decimal("30"):
            results.append(_candidate(
                "financial.expense_to_sales_ratio",
                "Operating expenses are at least 30% of net sales",
                "Operating expenses are compared with net sales for the same complete 30-day period.",
                {"operating_expenses": _money(current["operating_expenses"]),
                 "net_sales": _money(current["net_sales"]), "expense_share_percent": round(expense_share, 2)},
                current_start, current_end, label, "high",
                "Review operating expense categories and compare them with the profit and loss report.",
                "/expenses",
            ))

    branches = list(Branch.objects.filter(user=user, is_deleted=False).order_by("opening_date", "id"))
    if len(branches) > 1:
        unassigned_transactions = (
            Sale.objects.filter(
                created_by=user, is_deleted=False, branch__isnull=True,
                date__gte=current_start, date__lt=current_end,
            ).exists()
            or Expense.objects.filter(
                created_by=user, is_deleted=False, approval_status="approved", branch__isnull=True,
                date__gte=current_start, date__lt=current_end,
            ).exists()
            or OtherIncome.objects.filter(
                created_by=user, is_deleted=False, branch__isnull=True,
                date__gte=current_start, date__lt=current_end,
            ).exists()
            or SupplyEntry.objects.filter(
                user=user, is_deleted=False, direction="outgoing", payment_status="paid",
                product__branch__isnull=True, movement_date__gte=current_start, movement_date__lt=current_end,
            ).exists()
        )
        if not unassigned_transactions:
            branch_results = []
            for branch in branches:
                branch_start = max(current_start, branch.opening_date)
                active_days = (current_end - branch_start).days
                if active_days <= 0:
                    continue
                summary = _profit_loss(user, branch_start, current_end, [branch.id])
                branch_results.append({
                    "branch": branch.name,
                    "period_start": branch_start.isoformat(),
                    "period_end": (current_end - timedelta(days=1)).isoformat(),
                    "active_days": active_days,
                    "net_sales": _money(summary["net_sales"]),
                    "gross_profit": _money(summary["gross_profit"]),
                    "operating_expenses": _money(summary["operating_expenses"]),
                    "other_income": _money(summary["other_income"]),
                    "other_expenses": _money(summary["other_expenses"]),
                    "net_profit": _money(summary["net_profit"]),
                })
            if len(branch_results) > 1:
                branch_results.sort(key=lambda row: Decimal(row["net_profit"]), reverse=True)
                negative_branch = any(Decimal(row["net_profit"]) < ZERO for row in branch_results)
                results.append(_candidate(
                    "financial.branch_profitability",
                    "Branch net profit for the last 30 complete days",
                    "Each branch uses the same profit and loss calculation. Rows start at the branch opening date when it opened during the period; unassigned sales, approved expenses, income, or supply revenue suppress this comparison.",
                    {"branches": branch_results, "base_period_start": current_start.isoformat(),
                     "base_period_end": (current_end - timedelta(days=1)).isoformat(),
                     "all_transactions_assigned": True},
                    current_start, current_end,
                    "Last 30 complete days; branch operating days shown per row",
                    "medium" if negative_branch else "info",
                    "Review branch results and operating costs before changing staffing or inventory plans.",
                    "/reports",
                ))

    customers = Customer.objects.filter(user=user, is_deleted=False, debt_amount__gt=ZERO)
    debt_summary = customers.aggregate(total=Sum("debt_amount"), count=Count("id"))
    overdue = customers.filter(debt_due_date__lt=today).aggregate(total=Sum("debt_amount"), count=Count("id"))
    if debt_summary["count"]:
        results.append(_candidate(
            "financial.customer_debt",
            f"{debt_summary['count']} customer accounts have outstanding balances",
            "Balances use the customer debt amounts currently recorded in Verifin.",
            {"customer_count": debt_summary["count"], "outstanding_balance": _money(debt_summary["total"]),
             "overdue_accounts": overdue["count"] or 0, "overdue_balance": _money(overdue["total"])},
            today, today + timedelta(days=1), "Current customer balances",
            "high" if overdue["count"] else "info",
            "Review overdue accounts and follow up according to your credit policy.",
            "/customers",
        ))

    returned = {
        row["purchase_order_id"]: row["total"] or ZERO
        for row in SupplierReturn.objects.filter(
            user=user, is_deleted=False,
        ).values("purchase_order_id").annotate(total=Sum("total_amount_base"))
    }
    paid = {
        row["purchase_order_id"]: row["total"] or ZERO
        for row in SupplierPayment.objects.filter(
            user=user, is_deleted=False,
        ).values("purchase_order_id").annotate(total=Sum("amount_base"))
    }
    orders = list(PurchaseOrder.objects.filter(
        user=user, is_deleted=False,
    ).select_related("supplier"))
    received_totals = get_purchase_orders_received_totals_base(orders)
    payables = []
    for order in orders:
        received = received_totals[order.id]["received_total_base"]
        balance = received - returned.get(order.id, ZERO) - paid.get(order.id, ZERO)
        if balance > ZERO:
            payables.append((order, balance))
    if payables:
        total_due = sum((balance for _, balance in payables), ZERO)
        overdue_payables = [(order, balance) for order, balance in payables if order.due_date and order.due_date < today]
        results.append(_candidate(
            "financial.supplier_debt",
            f"{len(payables)} supplier invoices have outstanding balances",
            "Outstanding amounts use confirmed GRN costs plus older received quantities, less recorded supplier returns and payments. Draft or unreceived purchase orders are excluded.",
            {"invoice_count": len(payables), "outstanding_balance": _money(total_due),
             "overdue_invoice_count": len(overdue_payables),
             "overdue_balance": _money(sum((balance for _, balance in overdue_payables), ZERO))},
            today, today + timedelta(days=1), "Current recorded supplier balances",
            "high" if overdue_payables else "info",
            "Review due dates and payment history before scheduling settlements.",
            "/suppliers",
        ))

    current_start, current_end = periods["last_30"]
    previous_start, previous_end = periods["prior_30"]
    cash_rows = AccountTransaction.objects.filter(
        user=user, is_deleted=False,
        transaction_date__gte=previous_start, transaction_date__lt=current_end,
    ).values("direction").annotate(
        current_total=Sum("amount_base", filter=Q(
            transaction_date__gte=current_start, transaction_date__lt=current_end,
        )),
        previous_total=Sum("amount_base", filter=Q(
            transaction_date__gte=previous_start, transaction_date__lt=previous_end,
        )),
    )
    cash = {row["direction"]: row for row in cash_rows}
    current_in = cash.get("in", {}).get("current_total") or ZERO
    current_out = cash.get("out", {}).get("current_total") or ZERO
    previous_in = cash.get("in", {}).get("previous_total") or ZERO
    previous_out = cash.get("out", {}).get("previous_total") or ZERO
    current_net = current_in - current_out
    previous_net = previous_in - previous_out
    if current_in or current_out or previous_in or previous_out:
        results.append(_candidate(
            "financial.account_cash_flow",
            "Recorded payment-account activity for the last 30 days",
            "This is based only on payment-account transactions entered in Verifin. It may not include sales or expenses that have not been posted to an account.",
            {"current_received": _money(current_in), "current_paid": _money(current_out),
             "current_net_movement": _money(current_net), "previous_received": _money(previous_in),
             "previous_paid": _money(previous_out), "previous_net_movement": _money(previous_net)},
            current_start, current_end, _period_label("Last 30 complete days", current_start, current_end),
            "info" if current_net >= ZERO else "medium",
            "Reconcile payment-account activity with bank or mobile-money statements.",
            "/accounts",
        ))
    return results


def build_insights(user, today=None):
    today = today or timezone.localdate()
    periods = _sales_periods(today)
    return (
        _sales_insights(user, today, periods)
        + _expense_insights(user, periods)
        + _inventory_insights(user, periods)
        + _financial_insights(user, today, periods)
    )


@transaction.atomic
def refresh_insights(user, today=None):
    get_user_model().objects.select_for_update().get(pk=user.pk)
    now = timezone.now()
    candidates = build_insights(user, today)
    current_ids = []
    for candidate in candidates:
        insight, _ = BusinessInsight.objects.get_or_create(
            user=user,
            rule_key=candidate["rule_key"],
            period_start=candidate["period_start"],
            period_end=candidate["period_end"],
            defaults=candidate,
        )
        for field, value in candidate.items():
            if field not in {"rule_key", "period_start", "period_end"}:
                setattr(insight, field, value)
        insight.generated_at = now
        if insight.status == "resolved":
            insight.status = "active"
            insight.resolved_at = None
        insight.save()
        current_ids.append(insight.id)

    BusinessInsight.objects.filter(user=user, status="active").exclude(
        id__in=current_ids,
    ).update(status="resolved", resolved_at=now, updated_at=now)
    return BusinessInsight.objects.filter(user=user).order_by("-generated_at", "-id")
