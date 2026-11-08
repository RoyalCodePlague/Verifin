from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .analytics import set_analytics_consent
from .models import AnalyticsConsent


class AnalyticsConsentView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        consent, _ = AnalyticsConsent.objects.get_or_create(user=request.user)
        return Response({"enabled": consent.opted_in})

    def patch(self, request):
        enabled = request.data.get("enabled")
        if type(enabled) is not bool:
            return Response({"enabled": ["This field must be a boolean."]}, status=400)
        consent = set_analytics_consent(request.user, enabled)
        return Response({"enabled": consent.opted_in})
