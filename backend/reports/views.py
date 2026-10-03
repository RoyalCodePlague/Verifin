from datetime import timedelta
from django.utils import timezone
from decimal import Decimal
from django.db.models import Sum
from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from expenses.models import Expense
from inventory.models import Product, StockMovement
from sales.models import Sale, SaleItem
from audits.models import Discrepancy
from customers.models import Customer
from billing.services import enforce_feature
from . import services


class DailySalesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        today = timezone.localdate()
        total = Sale.objects.filter(created_by=request.user, is_deleted=False, date=today).aggregate(total=Sum("total"))["total"] or 0
        total += services.supply_totals(request.user, today, today + timedelta(days=1))[0]
        return Response({"daily_sales": total})


class WeeklyPerformanceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        return Response({"message": "Weekly performance endpoint ready."})


class StockMovementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        count = StockMovement.objects.filter(created_by=request.user).count()
        return Response({"stock_movements": count})


class ExpenseAnalysisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        total = Expense.objects.filter(created_by=request.user, is_deleted=False).aggregate(total=Sum("amount_base"))["total"] or 0
        return Response({"total_expenses": total})


class ProfitLossView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        sales = Sale.objects.filter(created_by=request.user, is_deleted=False)
        sales_total = sales.aggregate(total=Sum("total"))["total"] or 0
        cost_total = sales.aggregate(total=Sum("total_cost"))["total"] or 0
        gross_profit = sales.aggregate(total=Sum("gross_profit"))["total"] or 0
        expense_total = Expense.objects.filter(created_by=request.user, is_deleted=False).aggregate(total=Sum("amount_base"))["total"] or 0
        supply_revenue, supply_cost = services.supply_totals(request.user)
        sales_total += supply_revenue
        cost_total += supply_cost
        gross_profit += supply_revenue - supply_cost
        margin = (gross_profit / sales_total * 100) if sales_total else 0
        return Response({
            "sales": sales_total,
            "cost_of_goods": cost_total,
            "gross_profit": gross_profit,
            "gross_margin_percent": margin,
            "expenses": expense_total,
            "profit_loss": gross_profit - expense_total,
        })


class MarginReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        rows = []
        for product in Product.objects.filter(user=request.user, is_deleted=False):
            revenue = Sale.objects.filter(created_by=request.user, is_deleted=False, sale_items__product=product).aggregate(total=Sum("sale_items__subtotal"))["total"] or 0
            cost = Sale.objects.filter(created_by=request.user, is_deleted=False, sale_items__product=product).aggregate(total=Sum("sale_items__cost_total"))["total"] or 0
            profit = revenue - cost
            margin = (profit / revenue * 100) if revenue else 0
            rows.append({
                "product": product.name,
                "branch": product.branch.name if product.branch else "",
                "revenue": revenue,
                "cost": cost,
                "profit": profit,
                "margin_percent": margin,
                "unit_margin": product.price - product.cost_price,
            })
        return Response({"items": sorted(rows, key=lambda row: row["profit"], reverse=True)})


class ProfitLeakView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        leaks = []
        products = Product.objects.filter(user=request.user, is_deleted=False)

        for product in products:
            if product.price <= product.cost_price:
                leaks.append({
                    "type": "negative_margin",
                    "severity": "critical",
                    "title": f"{product.name} is priced at or below cost",
                    "impact": product.price - product.cost_price,
                    "product": product.name,
                    "sku": product.sku,
                    "suggested_action": "Increase selling price or renegotiate supplier cost.",
                })

        discounted_items = (
            SaleItem.objects.filter(sale__created_by=request.user, is_deleted=False)
            .select_related("product")
            .order_by("-created_at")[:500]
        )
        for item in discounted_items:
            if item.product and item.unit_price < item.product.price:
                leak_amount = (item.product.price - item.unit_price) * item.quantity
                if leak_amount > 0:
                    leaks.append({
                        "type": "discount_leak",
                        "severity": "medium" if leak_amount < Decimal("100") else "high",
                        "title": f"{item.product.name} sold below listed price",
                        "impact": leak_amount,
                        "product": item.product.name,
                        "sku": item.product.sku,
                        "suggested_action": "Review discount approvals and cashier pricing rules.",
                    })

        expense_total = Expense.objects.filter(created_by=request.user, is_deleted=False).aggregate(total=Sum("amount_base"))["total"] or 0
        gross_profit = Sale.objects.filter(created_by=request.user, is_deleted=False).aggregate(total=Sum("gross_profit"))["total"] or 0
        if gross_profit and expense_total > gross_profit * Decimal("0.35"):
            leaks.append({
                "type": "expense_drag",
                "severity": "high",
                "title": "Expenses are eating into gross profit",
                "impact": expense_total - (gross_profit * Decimal("0.35")),
                "product": "",
                "sku": "",
                "suggested_action": "Inspect recurring expenses and supplier charges this month.",
            })

        zero_cost_count = products.filter(cost_price=0).count()
        if zero_cost_count:
            leaks.append({
                "type": "missing_costs",
                "severity": "medium",
                "title": f"{zero_cost_count} products have no cost price",
                "impact": 0,
                "product": "",
                "sku": "",
                "suggested_action": "Add cost prices so profit reports stop undercounting losses.",
            })

        priority = {"critical": 0, "high": 1, "medium": 2, "low": 3}
        leaks.sort(key=lambda leak: (priority.get(leak["severity"], 9), -Decimal(str(leak["impact"] or 0))))
        return Response({"items": leaks[:30]})


class DiscrepancyReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "discrepancy_tracking")
        rows = Discrepancy.objects.filter(
            audit__conductor=request.user, is_deleted=False, audit__is_deleted=False,
            product__is_deleted=False,
        ).select_related("audit", "product", "resolved_by").order_by("-created_at")
        status_filter = request.query_params.get("status")
        if status_filter in {"unresolved", "investigating", "resolved"}:
            rows = rows.filter(status=status_filter)
        return Response({"count": rows.count(), "items": [{
            "id": item.id, "audit_id": item.audit_id, "audit_date": item.audit.date,
            "product": item.product.name, "sku": item.product.sku,
            "expected_stock": item.expected_stock, "actual_stock": item.actual_stock,
            "difference": item.difference, "status": item.status,
            "resolved_by": item.resolved_by.get_full_name() if item.resolved_by else None,
            "created_at": item.created_at,
        } for item in rows[:500]]})


class CustomerReportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        customers = Customer.objects.filter(user=request.user, is_deleted=False).order_by("-total_spent")
        return Response({"summary": {
            "customers": customers.count(),
            "total_spent": customers.aggregate(total=Sum("total_spent"))["total"] or 0,
            "total_debt": customers.aggregate(total=Sum("debt_amount"))["total"] or 0,
            "total_visits": customers.aggregate(total=Sum("visits"))["total"] or 0,
        }, "items": [{
            "id": customer.id, "name": customer.name, "phone": customer.phone,
            "total_spent": customer.total_spent, "visits": customer.visits,
            "loyalty_points": customer.loyalty_points, "debt_amount": customer.debt_amount,
            "last_visit": customer.last_visit, "badge": customer.badge,
        } for customer in customers[:500]]})


class MonthlyOverviewView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_reports")
        today = timezone.localdate()
        months = []
        for offset in range(11, -1, -1):
            month_index = today.year * 12 + today.month - 1 - offset
            year, month_zero = divmod(month_index, 12)
            start = today.replace(year=year, month=month_zero + 1, day=1)
            end_index = month_index + 1
            end_year, end_month_zero = divmod(end_index, 12)
            end = start.replace(year=end_year, month=end_month_zero + 1, day=1)
            sales_total = Sale.objects.filter(created_by=request.user, is_deleted=False, date__gte=start, date__lt=end).aggregate(total=Sum("total"))["total"] or 0
            cost_total = Sale.objects.filter(created_by=request.user, is_deleted=False, date__gte=start, date__lt=end).aggregate(total=Sum("total_cost"))["total"] or 0
            expense_total = Expense.objects.filter(created_by=request.user, is_deleted=False, date__gte=start, date__lt=end).aggregate(total=Sum("amount_base"))["total"] or 0
            supply_revenue, supply_cost = services.supply_totals(request.user, start, end)
            revenue = sales_total + supply_revenue
            cost = cost_total + supply_cost
            months.append({"month": start.strftime("%Y-%m"), "sales": revenue, "cost_of_goods": cost,
                           "gross_profit": revenue - cost, "expenses": expense_total,
                           "net_profit": revenue - cost - expense_total})
        return Response({"months": months})


class AdvancedAnalyticsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "advanced_analytics")
        return Response(services.advanced_analytics(request.user))


class ForecastView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "forecasting")
        days = int(request.query_params.get("days", 7))
        return Response(services.rule_forecast(request.user, days=days))


class AutomationAlertsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "automation_rules")
        return Response(services.automation_alerts(request.user))


class ExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        export_type = request.query_params.get("type", "csv")
        if export_type in ["excel", "xlsx"]:
            enforce_feature(request.user, "excel_exports")
        if export_type not in {"csv", "excel", "xlsx"}:
            return Response({"detail": "Supported export types are csv and excel."}, status=400)
        report_type = request.query_params.get("report", "monthly-overview")
        if report_type == "monthly-overview":
            enforce_feature(request.user, "advanced_reports")
            data = MonthlyOverviewView().get(request).data["months"]
            headers = ["month", "sales", "cost_of_goods", "gross_profit", "expenses", "net_profit"]
        elif report_type == "customers":
            enforce_feature(request.user, "advanced_reports")
            data = CustomerReportView().get(request).data["items"]
            headers = ["id", "name", "phone", "total_spent", "visits", "loyalty_points", "debt_amount", "last_visit", "badge"]
        elif report_type == "discrepancies":
            enforce_feature(request.user, "discrepancy_tracking")
            data = DiscrepancyReportView().get(request).data["items"]
            headers = ["id", "audit_id", "audit_date", "product", "sku", "expected_stock", "actual_stock", "difference", "status", "created_at"]
        else:
            return Response({"detail": "Unknown report. Use monthly-overview, customers, or discrepancies."}, status=400)
        import csv
        from io import StringIO
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(headers)
        for item in data:
            writer.writerow([item.get(field, "") for field in headers])
        response = HttpResponse(output.getvalue(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{report_type}.csv"'
        return response

