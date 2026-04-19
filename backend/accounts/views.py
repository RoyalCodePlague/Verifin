from django.contrib.auth import get_user_model
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from datetime import timedelta
import secrets
from rest_framework import exceptions, permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView
from .models import Profile, Staff
from .permissions import IsOwnerOrManager
from .serializers import CustomTokenObtainPairSerializer, ProfileSerializer, RegisterSerializer, StaffSerializer, UserSerializer

User = get_user_model()


def verification_token_expired(user):
    sent_at = user.email_verification_sent_at
    if not sent_at:
        return True
    ttl_hours = getattr(settings, "EMAIL_VERIFICATION_TOKEN_TTL_HOURS", 24)
    return timezone.now() > sent_at + timedelta(hours=ttl_hours)


def send_verification_email(user):
    token = user.email_verification_token or secrets.token_urlsafe(32)
    if token != user.email_verification_token:
        user.email_verification_token = token
        user.email_verification_sent_at = timezone.now()
        user.save(update_fields=["email_verification_token", "email_verification_sent_at"])

    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    send_mail(
        subject="Verify your Verifin email",
        message=(
            f"Welcome to Verifin.\n\n"
            f"Verify your email to activate your account:\n{verify_url}\n\n"
            f"If you did not create this account, you can ignore this email."
        ),
        from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "Verifin <noreply@verifin.app>"),
        recipient_list=[user.email],
        fail_silently=False,
    )


class CustomTokenObtainPairView(TokenObtainPairView):
    """Custom login view that uses email as username"""
    serializer_class = CustomTokenObtainPairSerializer
    permission_classes = [permissions.AllowAny]
    
    def post(self, request, *args, **kwargs):
        try:
            return super().post(request, *args, **kwargs)
        except Exception as e:
            # Re-raise validation errors as-is
            if isinstance(e, (exceptions.ValidationError, exceptions.AuthenticationFailed)):
                raise
            # Convert other errors to validation errors
            raise exceptions.ValidationError({'detail': str(e)})


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        send_verification_email(user)
        return Response({
            "user": UserSerializer(user).data,
            "detail": "Account created. Please verify your email before signing in.",
        }, status=status.HTTP_201_CREATED)


class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        token = request.data.get("token", "").strip()
        if not token:
            return Response({"detail": "Verification token is required."}, status=400)
        user = User.objects.filter(email_verification_token=token).first()
        if not user:
            return Response({"detail": "Invalid or expired verification link."}, status=400)
        if verification_token_expired(user):
            user.email_verification_token = secrets.token_urlsafe(32)
            user.email_verification_sent_at = timezone.now()
            user.save(update_fields=["email_verification_token", "email_verification_sent_at"])
            send_verification_email(user)
            return Response({"detail": "Verification link expired. We sent you a new one."}, status=400)
        user.email_verified = True
        user.is_active = True
        user.email_verification_token = ""
        user.save(update_fields=["email_verified", "is_active", "email_verification_token"])
        return Response({"detail": "Email verified. You can now sign in."})


class ResendVerificationEmailView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = request.data.get("email", "").strip().lower()
        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return Response({"detail": "If this email exists, a verification link has been sent."})
        if user.email_verified and user.is_active:
            return Response({"detail": "This email is already verified."})
        cooldown_seconds = getattr(settings, "EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", 60)
        if user.email_verification_sent_at and timezone.now() < user.email_verification_sent_at + timedelta(seconds=cooldown_seconds):
            return Response({"detail": "Please wait a minute before requesting another verification email."}, status=429)
        user.email_verification_token = secrets.token_urlsafe(32)
        user.email_verification_sent_at = timezone.now()
        user.save(update_fields=["email_verification_token", "email_verification_sent_at"])
        send_verification_email(user)
        return Response({"detail": "Verification email sent."})


class LogoutView(APIView):
    def post(self, request):
        refresh_token = request.data.get("refresh")
        if refresh_token:
            token = RefreshToken(refresh_token)
            token.blacklist()
        return Response({"detail": "Logged out successfully."})


class ProfileViewSet(viewsets.ModelViewSet):
    serializer_class = ProfileSerializer

    def get_queryset(self):
        return Profile.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class StaffViewSet(viewsets.ModelViewSet):
    serializer_class = StaffSerializer
    permission_classes = [IsOwnerOrManager]
    filterset_fields = ["role", "status"]
    search_fields = ["name", "role"]

    def get_queryset(self):
        return Staff.objects.filter(user=self.request.user, is_deleted=False)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticatedOrReadOnly]
    
    def get(self, request):
        if request.user and request.user.is_authenticated:
            return Response(UserSerializer(request.user).data)
        else:
            return Response({"detail": "Authentication required"}, status=401)

    def patch(self, request):
        if not request.user or not request.user.is_authenticated:
            return Response({"detail": "Authentication required"}, status=401)
        serializer = UserSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data)


class GoogleOAuthPlaceholderView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return Response({"detail": "Google OAuth adapter endpoint placeholder. Integrate django-allauth/dj-rest-auth credentials."}, status=501)
