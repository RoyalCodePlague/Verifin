from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from .models import Payment, Subscription
from .serializers import PaymentSerializer, SubscriptionSerializer


class SubscriptionViewSet(viewsets.ModelViewSet):
    serializer_class = SubscriptionSerializer

    def get_queryset(self):
        return Subscription.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=["post"], url_path="webhook")
    def webhook(self, request):
        return Response({"detail": "Stripe webhook scaffolded."})


class PaymentViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        return Payment.objects.filter(subscription__user=self.request.user, is_deleted=False)
from django.shortcuts import render

# Create your views here.
