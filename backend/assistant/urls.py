from django.urls import path
from . import views

urlpatterns = [
    path('command/', views.command_endpoint, name='assistant-command'),
    path('chat/', views.chat_endpoint, name='assistant-chat'),
    path('insights/', views.insights_endpoint, name='assistant-insights'),
    path('reorder-suggestions/', views.reorder_suggestions_endpoint, name='assistant-reorder-suggestions'),
    path('whatsapp-summary/', views.whatsapp_summary_endpoint, name='assistant-whatsapp-summary'),
    path('receipt-scan/', views.receipt_scan_endpoint, name='assistant-receipt-scan'),
    path('live-activity/', views.live_activity_endpoint, name='assistant-live-activity'),
]
