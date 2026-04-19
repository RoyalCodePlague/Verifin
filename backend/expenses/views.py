from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from billing.services import enforce_feature
from .models import Expense, ExpenseCategory
from .serializers import ExpenseCategorySerializer, ExpenseSerializer


class ExpenseCategoryViewSet(viewsets.ModelViewSet):
    queryset = ExpenseCategory.objects.filter(is_deleted=False)
    serializer_class = ExpenseCategorySerializer



from django.utils import timezone

class ExpenseViewSet(viewsets.ModelViewSet):
    serializer_class = ExpenseSerializer
    filterset_fields = ["category", "date"]
    search_fields = ["description"]

    def get_queryset(self):
        return Expense.objects.filter(created_by=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=False, methods=["get"], url_path="todays-expenses")
    def todays_expenses(self, request):
        today = timezone.now().date()
        expenses = self.get_queryset().filter(date=today)
        total = sum([float(e.amount) for e in expenses])
        return Response({
            "total": total,
            "expenses": ExpenseSerializer(expenses, many=True).data
        })

    @action(detail=False, methods=["post"], url_path="ocr-receipt")
    def ocr_receipt(self, request):
        enforce_feature(request.user, "receipt_ocr")
        return Response({"detail": "OCR endpoint scaffolded. Plug your OCR provider here."}, status=501)
