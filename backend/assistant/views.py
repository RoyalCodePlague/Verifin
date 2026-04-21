import logging

from django.views.decorators.csrf import csrf_exempt
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services import enforce_feature
from . import services
from .models import AssistantLog

logger = logging.getLogger(__name__)


def _assistant_response(command, user):
    parsed = services.command_assistant(command, user=user)
    return services.make_json_safe({
        "parsed_action": parsed.get("action", "unknown"),
        "confidence": 1.0 if parsed.get("action") != "unknown" else 0.2,
        "message": parsed.get("message", ""),
        "requires_confirmation": False,
        "execution_result": {"data": parsed.get("data", {})},
    })


@csrf_exempt
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def command_endpoint(request):
    enforce_feature(request.user, "command_assistant")
    command = request.data.get("command", "").strip()
    if not command:
        return Response({"error": "No command provided"}, status=400)
    try:
        payload = _assistant_response(command, request.user)
        AssistantLog.objects.create(
            user=request.user,
            input_text=command,
            parsed_action=payload["parsed_action"],
            result=payload["message"],
            ai_response=payload,
            confidence=payload["confidence"],
            executed=True,
        )
        return Response(payload)
    except Exception as exc:
        logger.exception("Command assistant error: %s", exc)
        return Response({"error": str(exc), "parsed_action": "error"}, status=500)


@csrf_exempt
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def chat_endpoint(request):
    enforce_feature(request.user, "command_assistant")
    message = request.data.get("message", "").strip()
    if not message:
        return Response({"error": "No message provided"}, status=400)
    return Response(services.command_assistant(message, user=request.user))


@api_view(["GET"])
@csrf_exempt
@permission_classes([IsAuthenticated])
def insights_endpoint(request):
    enforce_feature(request.user, "rule_insights")
    return Response(services.make_json_safe(services.generate_insights(user=request.user)))


@api_view(["GET"])
@csrf_exempt
@permission_classes([IsAuthenticated])
def reorder_suggestions_endpoint(request):
    enforce_feature(request.user, "reorder_suggestions")
    days = int(request.query_params.get("days", 7))
    cover_days = int(request.query_params.get("cover_days", 14))
    return Response(services.generate_reorder_suggestions(request.user, days=days, cover_days=cover_days))


@api_view(["GET"])
@csrf_exempt
@permission_classes([IsAuthenticated])
def whatsapp_summary_endpoint(request):
    enforce_feature(request.user, "whatsapp_reports")
    return Response(services.make_json_safe(services.generate_whatsapp_summary(request.user)))


@api_view(["POST"])
@csrf_exempt
@permission_classes([IsAuthenticated])
def receipt_scan_endpoint(request):
    enforce_feature(request.user, "receipt_scan_simulator")
    upload = request.FILES.get("receipt")
    return Response(
        services.simulate_receipt_scan(
            upload_name=upload.name if upload else "",
            merchant=request.data.get("merchant", ""),
            amount=request.data.get("amount"),
            category=request.data.get("category", "General"),
            note=request.data.get("note", ""),
        )
    )


@api_view(["GET"])
@csrf_exempt
@permission_classes([IsAuthenticated])
def live_activity_endpoint(request):
    stock = services.query_stock(user=request.user)
    expenses = services.query_expenses(user=request.user)
    sales = services.query_sales(user=request.user)
    return Response(services.make_json_safe({
        "inventory": {"items": stock.get("total_items", 0), "qty": stock.get("total_quantity", 0)},
        "expenses": {"total": expenses.get("total_cost", 0)},
        "sales": {"revenue": sales.get("total_revenue", 0)},
    }))


class AssistantCommandView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        enforce_feature(request.user, "command_assistant")
        command = request.data.get("command", "").strip()
        if not command:
            return Response({"error": "Command text is required"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(_assistant_response(command, request.user), status=status.HTTP_200_OK)


class AssistantHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        limit = int(request.query_params.get("limit", 10))
        logs = AssistantLog.objects.filter(user=request.user)[:limit]
        return Response({
            "logs": [
                {
                    "id": log.id,
                    "command": log.input_text,
                    "action": log.parsed_action,
                    "confidence": log.confidence,
                    "executed": log.executed,
                    "requires_confirmation": log.requires_confirmation,
                    "created_at": log.created_at,
                    "result": log.result,
                }
                for log in logs
            ]
        })


class AssistantConfirmActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, log_id):
        log_entry = AssistantLog.objects.get(id=log_id, user=request.user)
        log_entry.executed = bool(request.data.get("confirmed", False))
        log_entry.save(update_fields=["executed", "updated_at"])
        return Response({"status": "success" if log_entry.executed else "cancelled"})
