from django.db.models import Sum
from django.http import HttpResponse
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from expenses.models import Expense
from inventory.models import StockMovement
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
        sales_total = Sale.objects.filter(created_by=request.user).aggregate(total=Sum("total"))["total"] or 0
        expense_total = Expense.objects.filter(created_by=request.user).aggregate(total=Sum("amount"))["total"] or 0
        return Response({"sales": sales_total, "expenses": expense_total, "profit_loss": sales_total - expense_total})


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

