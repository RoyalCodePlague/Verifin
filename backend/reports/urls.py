from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    DailySalesView,
    AdvancedAnalyticsView,
    AutomationAlertsView,
    AutomationPreferencesView,
    CustomerReportView,
    CustomReportViewSet,
    DiscrepancyReportView,
    ExpenseAnalysisView,
    ExportView,
    ForecastView,
    MarginReportView,
    MonthlyOverviewView,
    ProfitLossView,
    ProfitLeakView,
    StockMovementView,
    WeeklyPerformanceView,
)

from .business_views import insights, whatsapp_summary

router = DefaultRouter()
router.register("custom-reports", CustomReportViewSet, basename="custom-reports")

urlpatterns = [
    path("", include(router.urls)),
    path("insights/", insights),
    path("whatsapp-summary/", whatsapp_summary),
    path("daily-sales/", DailySalesView.as_view()),
    path("weekly-performance/", WeeklyPerformanceView.as_view()),
    path("stock-movement/", StockMovementView.as_view()),
    path("discrepancy/", DiscrepancyReportView.as_view()),
    path("customer/", CustomerReportView.as_view()),
    path("expense-analysis/", ExpenseAnalysisView.as_view()),
    path("profit-loss/", ProfitLossView.as_view()),
    path("profit-leaks/", ProfitLeakView.as_view()),
    path("margins/", MarginReportView.as_view()),
    path("monthly-overview/", MonthlyOverviewView.as_view()),
    path("advanced-analytics/", AdvancedAnalyticsView.as_view()),
    path("forecast/", ForecastView.as_view()),
    path("automation-alerts/", AutomationAlertsView.as_view()),
    path("automation-preferences/", AutomationPreferencesView.as_view()),
    path("export/", ExportView.as_view()),
]
