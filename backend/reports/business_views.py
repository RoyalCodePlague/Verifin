from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status
from billing.services import enforce_feature
from .models import BusinessInsight
from .serializers import BusinessInsightSerializer
from . import business_services
from .insight_services import refresh_insights


class BusinessInsightsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        enforce_feature(request.user, "rule_insights")
        insights = refresh_insights(request.user)
        requested_status = request.query_params.get("status", "active")
        if requested_status == "all":
            selected = insights
        elif requested_status in dict(BusinessInsight.STATUS_CHOICES):
            selected = insights.filter(status=requested_status)
        else:
            return Response({"detail": "Choose active, acknowledged, dismissed, resolved, or all."},
                            status=status.HTTP_400_BAD_REQUEST)
        serialized = BusinessInsightSerializer(selected[:500], many=True).data
        active = insights.filter(status="active")
        legacy_insights = [{
            "type": insight.rule_key,
            "severity": insight.severity,
            "message": insight.explanation,
            "title": insight.title,
            "link": insight.link,
        } for insight in active[:100]]
        return Response({
            "items": serialized,
            "insights": legacy_insights,
            "history_count": insights.count(),
            "currency": request.user.currency,
            "evaluated_at": timezone.now(),
            "timestamp": timezone.now(),
        })


class BusinessInsightActionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, insight_id, action):
        enforce_feature(request.user, "rule_insights")
        insight = get_object_or_404(BusinessInsight, pk=insight_id, user=request.user)
        now = timezone.now()
        if action == "acknowledge":
            if insight.status not in {"active", "acknowledged"}:
                return Response(
                    {"detail": "Only active insights can be acknowledged."},
                    status=status.HTTP_409_CONFLICT,
                )
            insight.status = "acknowledged"
            insight.acknowledged_at = insight.acknowledged_at or now
        elif action == "dismiss":
            if insight.status not in {"active", "dismissed"}:
                return Response(
                    {"detail": "Only active insights can be dismissed."},
                    status=status.HTTP_409_CONFLICT,
                )
            insight.status = "dismissed"
            insight.dismissed_at = insight.dismissed_at or now
            timestamp_field = "dismissed_at"
        else:
            return Response({"detail": "Choose acknowledge or dismiss."}, status=status.HTTP_400_BAD_REQUEST)
        if action == "acknowledge":
            timestamp_field = "acknowledged_at"
        insight.save(update_fields=[timestamp_field, "status", "updated_at"])
        return Response(BusinessInsightSerializer(insight).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def whatsapp_summary(request):
    enforce_feature(request.user, "whatsapp_reports")
    return Response(business_services.make_json_safe(business_services.generate_whatsapp_summary(request.user)))
