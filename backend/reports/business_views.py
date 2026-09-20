from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from billing.services import enforce_feature
from . import business_services


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def insights(request):
    enforce_feature(request.user, "rule_insights")
    return Response(business_services.make_json_safe(business_services.generate_insights(user=request.user)))


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def whatsapp_summary(request):
    enforce_feature(request.user, "whatsapp_reports")
    return Response(business_services.make_json_safe(business_services.generate_whatsapp_summary(request.user)))
