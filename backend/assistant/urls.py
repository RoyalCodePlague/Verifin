from django.urls import path
from . import views

urlpatterns = [
    path('command/', views.command_endpoint, name='assistant-command'),
    path('chat/', views.chat_endpoint, name='assistant-chat'),
    path('insights/', views.insights_endpoint, name='assistant-insights'),
    path('live-activity/', views.live_activity_endpoint, name='assistant-live-activity'),
]
