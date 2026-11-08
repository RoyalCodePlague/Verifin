from django.urls import path

from .views import AnalyticsConsentView

urlpatterns = [
    path("analytics-consent/", AnalyticsConsentView.as_view(), name="analytics-consent"),
]
