from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import ExpenseCategoryViewSet, ExpenseViewSet

router = DefaultRouter()
router.register("categories", ExpenseCategoryViewSet, basename="expense-categories")
router.register("", ExpenseViewSet, basename="expenses")

urlpatterns = [path("", include(router.urls))]
