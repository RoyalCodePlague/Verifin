from django.contrib.auth import get_user_model
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone
from datetime import timedelta
import secrets
import logging
import smtplib
from django.core.exceptions import ImproperlyConfigured
from rest_framework import exceptions, permissions, status, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.views import TokenObtainPairView
from billing.services import enforce_feature, enforce_limit
from .models import Profile, Staff, StaffActivityLog
from .permissions import IsOwnerOrManager
from .serializers import ChangePasswordSerializer, CustomTokenObtainPairSerializer, ProfileSerializer, RegisterSerializer, StaffActivityLogSerializer, StaffSerializer, UserSerializer

User = get_user_model()
logger = logging.getLogger(__name__)


class VerificationEmailError(Exception):
    pass


def verification_token_expired(user):
    sent_at = user.email_verification_sent_at
    if not sent_at:
        return True
    ttl_hours = getattr(settings, "EMAIL_VERIFICATION_TOKEN_TTL_HOURS", 24)
    return timezone.now() > sent_at + timedelta(hours=ttl_hours)


def send_verification_email(user):
    if settings.EMAIL_BACKEND.endswith("console.EmailBackend"):
        logger.error(
            "Verification email is using console backend",
            extra={"user_id": user.id, "email_backend": settings.EMAIL_BACKEND},
        )
        if not settings.DEBUG:
            raise VerificationEmailError("Email delivery is not configured on the server.")

    if settings.EMAIL_BACKEND.endswith("smtp.EmailBackend") and (
        not settings.EMAIL_HOST or not settings.EMAIL_HOST_USER or not settings.EMAIL_HOST_PASSWORD
    ):
        logger.error(
            "SMTP verification email is missing required settings",
            extra={"user_id": user.id, "email_host_set": bool(settings.EMAIL_HOST), "email_user_set": bool(settings.EMAIL_HOST_USER)},
        )
        raise VerificationEmailError("Email delivery is missing SMTP settings.")

    token = user.email_verification_token or secrets.token_urlsafe(32)
    if token != user.email_verification_token:
        user.email_verification_token = token
    user.email_verification_sent_at = timezone.now()
    user.save(update_fields=["email_verification_token", "email_verification_sent_at"])

    verify_url = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    try:
        sent_count = send_mail(
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
    except (smtplib.SMTPException, OSError, ImproperlyConfigured, Exception) as exc:
        logger.exception("Verification email failed", extra={"user_id": user.id})
        raise VerificationEmailError("Verification email could not be sent. Please try again in a minute.") from exc
    logger.info(
        "Verification email accepted by backend",
        extra={"user_id": user.id, "email_sent_count": sent_count},
    )
    return sent_count


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
        refresh = RefreshToken.for_user(user)
        return Response({
            "user": UserSerializer(user).data,
            "refresh": str(refresh),
            "access": str(refresh.access_token),
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
            try:
                send_verification_email(user)
            except VerificationEmailError as exc:
                return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
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
        try:
            send_verification_email(user)
        except VerificationEmailError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
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
        enforce_limit(self.request.user, "users")
        serializer.save(user=self.request.user)


class StaffActivityLogViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StaffActivityLogSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        enforce_feature(self.request.user, "staff_activity_logs")
        return StaffActivityLog.objects.filter(user=self.request.user, is_deleted=False)


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


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        return Response({"detail": "Password updated successfully."})


class LogoutOtherDevicesView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        current_refresh = request.data.get("refresh")
        current_token_jti = None

        if current_refresh:
            try:
                current_token_jti = RefreshToken(current_refresh)["jti"]
            except Exception:
                current_token_jti = None

        outstanding_tokens = OutstandingToken.objects.filter(user=request.user)
        revoked = 0

        for token in outstanding_tokens:
            if current_token_jti and token.jti == current_token_jti:
                continue
            try:
                RefreshToken(token.token).blacklist()
                revoked += 1
            except Exception:
                continue

        return Response({"detail": "Other devices logged out successfully.", "revoked": revoked})


class GoogleOAuthPlaceholderView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        return Response({"detail": "Google OAuth adapter endpoint placeholder. Integrate django-allauth/dj-rest-auth credentials."}, status=501)
