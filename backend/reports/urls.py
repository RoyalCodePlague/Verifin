from django.urls import path
from .views import (
    DailySalesView,
    ExpenseAnalysisView,
    ExportView,
    GenericStubView,
    ProfitLossView,
    StockMovementView,
    WeeklyPerformanceView,
)

urlpatterns = [
    path("daily-sales/", DailySalesView.as_view()),
    path("weekly-performance/", WeeklyPerformanceView.as_view()),
    path("stock-movement/", StockMovementView.as_view()),
    path("discrepancy/", GenericStubView.as_view()),
    path("customer/", GenericStubView.as_view()),
    path("expense-analysis/", ExpenseAnalysisView.as_view()),
    path("profit-loss/", ProfitLossView.as_view()),
    path("monthly-overview/", GenericStubView.as_view()),
    path("export/", ExportView.as_view()),
]
