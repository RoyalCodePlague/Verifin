from django.utils.dateparse import parse_datetime
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from .models import SyncConflict
from sales.serializers import SaleSerializer
from expenses.serializers import ExpenseSerializer
from expenses.models import ExpenseCategory


class SyncPushView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        actions = request.data.get("actions", [])
        processed = 0
        conflicts = []
        errors = []

        for action in actions:
            action_type = action.get("type")
            payload = action.get("payload", {})

            if action_type == "sale":
                serializer = SaleSerializer(data=payload, context={"request": request})
                if serializer.is_valid():
                    serializer.save(created_by=request.user)
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Sale sync failed")

            elif action_type == "expense":
                category_name = payload.get("categoryName") or payload.get("category_name")
                if category_name:
                    category, _ = ExpenseCategory.objects.get_or_create(name=category_name)
                    payload["category"] = category.id
                serializer = ExpenseSerializer(data=payload, context={"request": request})
                if serializer.is_valid():
                    serializer.save(created_by=request.user)
                    processed += 1
                else:
                    errors.append({"action": action, "errors": serializer.errors})
                    SyncConflict.objects.create(user=request.user, payload=action, reason="Expense sync failed")
            else:
                errors.append({"action": action, "detail": "Unsupported sync action type"})
                SyncConflict.objects.create(user=request.user, payload=action, reason="Unsupported sync action")

        response_data = {
            "processed": processed,
            "errors": errors,
            "resolution": "server_wins",
        }
        return Response(response_data, status=status.HTTP_200_OK)


class SyncPullView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        since = parse_datetime(request.query_params.get("since", ""))
        qs = SyncConflict.objects.filter(user=request.user)
        if since:
            qs = qs.filter(updated_at__gte=since)
        data = [{"id": item.id, "payload": item.payload, "updated_at": item.updated_at} for item in qs]
        return Response({"changes": data})
