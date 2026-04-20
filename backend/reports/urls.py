from django.urls import path
from .views import (
    DailySalesView,
    AdvancedAnalyticsView,
    AutomationAlertsView,
    CustomerReportView,
    DiscrepancyReportView,
    ExpenseAnalysisView,
    ExportView,
    ForecastView,
    GenericStubView,
    MarginReportView,
    MonthlyOverviewView,
    ProfitLossView,
    StockMovementView,
    WeeklyPerformanceView,
)

urlpatterns = [
    path("daily-sales/", DailySalesView.as_view()),
    path("weekly-performance/", WeeklyPerformanceView.as_view()),
    path("stock-movement/", StockMovementView.as_view()),
    path("discrepancy/", DiscrepancyReportView.as_view()),
    path("customer/", CustomerReportView.as_view()),
    path("expense-analysis/", ExpenseAnalysisView.as_view()),
    path("profit-loss/", ProfitLossView.as_view()),
    path("margins/", MarginReportView.as_view()),
    path("monthly-overview/", MonthlyOverviewView.as_view()),
    path("advanced-analytics/", AdvancedAnalyticsView.as_view()),
    path("forecast/", ForecastView.as_view()),
    path("automation-alerts/", AutomationAlertsView.as_view()),
    path("export/", ExportView.as_view()),
]
