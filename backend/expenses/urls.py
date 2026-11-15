from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import ExpenseBudgetViewSet, ExpenseCategoryViewSet, ExpenseViewSet, OtherIncomeViewSet, RecurringExpenseViewSet

router = DefaultRouter()
router.register("categories", ExpenseCategoryViewSet, basename="expense-categories")
router.register("budgets", ExpenseBudgetViewSet, basename="expense-budgets")
router.register("recurring", RecurringExpenseViewSet, basename="recurring-expenses")
router.register("other-income", OtherIncomeViewSet, basename="other-income")
router.register("", ExpenseViewSet, basename="expenses")

urlpatterns = [path("", include(router.urls))]
