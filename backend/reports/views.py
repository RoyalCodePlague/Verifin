from django.db.models import Sum
from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from expenses.models import Expense
from inventory.models import Product, StockMovement
from sales.models import Sale


class DailySalesView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        total = Sale.objects.filter(created_by=request.user).aggregate(total=Sum("total"))["total"] or 0
        return Response({"daily_sales": total})


class WeeklyPerformanceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"message": "Weekly performance endpoint ready."})


class StockMovementView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        count = StockMovement.objects.filter(created_by=request.user).count()
        return Response({"stock_movements": count})


class ExpenseAnalysisView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        total = Expense.objects.filter(created_by=request.user).aggregate(total=Sum("amount"))["total"] or 0
        return Response({"total_expenses": total})


class ProfitLossView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        sales = Sale.objects.filter(created_by=request.user)
        sales_total = sales.aggregate(total=Sum("total"))["total"] or 0
        cost_total = sales.aggregate(total=Sum("total_cost"))["total"] or 0
        gross_profit = sales.aggregate(total=Sum("gross_profit"))["total"] or 0
        expense_total = Expense.objects.filter(created_by=request.user).aggregate(total=Sum("amount"))["total"] or 0
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
        rows = []
        for product in Product.objects.filter(user=request.user, is_deleted=False):
            revenue = Sale.objects.filter(created_by=request.user, sale_items__product=product).aggregate(total=Sum("sale_items__subtotal"))["total"] or 0
            cost = Sale.objects.filter(created_by=request.user, sale_items__product=product).aggregate(total=Sum("sale_items__cost_total"))["total"] or 0
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


class GenericStubView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"detail": "Endpoint scaffolded."})


class ExportView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        export_type = request.query_params.get("type", "csv")
        if export_type == "csv":
            response = HttpResponse("metric,value\nsales,0\n", content_type="text/csv")
            response["Content-Disposition"] = 'attachment; filename="report.csv"'
            return response
        return Response({"detail": "PDF export scaffolding ready."})

