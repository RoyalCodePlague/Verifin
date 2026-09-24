from django.contrib.auth import get_user_model
from django.conf import settings
from django.utils import timezone
from datetime import timedelta
import secrets
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.views import TokenObtainPairView
from billing.services import enforce_feature, enforce_limit
from .activity import log_staff_activity
from .models import ApiKey, Profile, Staff, StaffActivityLog
from .permissions import IsOwnerOrManager
from .serializers import ApiKeySerializer, ChangePasswordSerializer, CustomTokenObtainPairSerializer, ProfileSerializer, RegisterSerializer, StaffActivityLogSerializer, StaffLoginSerializer, StaffSerializer, UserSerializer

User = get_user_model()


from django.db import transaction
from rest_framework import serializers
from .throttles import AccountThrottle
from .email_verification import VerificationEmailError, send_verification_email, token_digest, verification_token_expired


class CustomTokenObtainPairView(TokenObtainPairView):
    """Custom login view that uses email as username"""
    serializer_class = CustomTokenObtainPairSerializer
    permission_classes = [permissions.AllowAny]
    
    throttle_classes = [AccountThrottle]
    auth_throttle_scope = "login"


class StaffLoginView(APIView):
    permission_classes = [permissions.AllowAny]
    throttle_classes = [AccountThrottle]
    auth_throttle_scope = "login"

    def post(self, request):
        serializer = StaffLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        owner = serializer.validated_data["owner"]
        staff = serializer.validated_data["staff"]
        staff.last_active = timezone.now()
        staff.save(update_fields=["last_active"])

        refresh = RefreshToken.for_user(owner)
        refresh["staff_id"] = staff.id
        refresh["staff_role"] = staff.role
        refresh["staff_permissions"] = staff.permissions or []

        return Response({
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(owner).data,
            "staff": {
                "id": staff.id,
                "name": staff.name,
                "username": staff.username,
                "role": staff.role,
                "permissions": staff.permissions or [],
                "business_code": owner.business_code,
            },
        })


class RegisterView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [AccountThrottle]
    auth_throttle_scope = "register"

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            user = serializer.save()
            from core.analytics import record_activation_event
            record_activation_event(user, "account_registered")
            try:
                send_verification_email(user)
                sent, detail = True, "Check your inbox. Verify your email to finish creating your account and sign in."
            except VerificationEmailError as exc:
                sent, detail = False, str(exc)
        return Response({"verification_required": True, "email_sent": sent, "email": user.email, "detail": detail}, status=201)


class VerifyEmailView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [AccountThrottle]
    auth_throttle_scope = "verify"

    @transaction.atomic
    def post(self, request):
        token = serializers.CharField(max_length=256).run_validation(request.data.get("token"))
        user = User.objects.select_for_update().filter(email_verification_token=token_digest(token), email_verification_pending=True, is_deleted=False).first()
        if not user or verification_token_expired(user):
            return Response({"detail": "Invalid or expired verification link. Request a new email."}, status=400)
        user.email_verified = True
        user.email_verification_pending = False
        user.is_active = True
        user.email_verification_token = ""
        user.save(update_fields=["email_verified", "email_verification_pending", "is_active", "email_verification_token"])
        from core.analytics import record_activation_event
        record_activation_event(user, "email_verified")
        from billing.services import qualify_referral_for_user
        qualify_referral_for_user(user)
        refresh = RefreshToken.for_user(user)
        response = Response({
            "detail": "Email verified. You are now signed in.",
            "access": str(refresh.access_token),
            "refresh": str(refresh),
            "user": UserSerializer(user).data,
        })
        response["Cache-Control"] = "no-store"
        return response


class ResendVerificationEmailView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = [AccountThrottle]
    auth_throttle_scope = "resend"

    @transaction.atomic
    def post(self, request):
        email = serializers.EmailField().run_validation(request.data.get("email")).strip().lower()
        user = User.objects.select_for_update().filter(email__iexact=email, email_verification_pending=True, is_deleted=False).first()
        generic = {"detail": "If this address has a pending account, a verification email will be sent. Check your inbox and spam folder."}
        if not user:
            return Response(generic)
        if user.email_verification_sent_at and timezone.now() < user.email_verification_sent_at + timedelta(seconds=settings.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS):
            return Response(generic)
        try:
            send_verification_email(user)
        except VerificationEmailError as exc:
            return Response({"detail": str(exc)}, status=503)
        return Response(generic)


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


class ApiKeyViewSet(viewsets.ModelViewSet):
    serializer_class = ApiKeySerializer
    permission_classes = [permissions.IsAuthenticated]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]

    def get_queryset(self):
        enforce_feature(self.request.user, "api_access")
        return ApiKey.objects.filter(user=self.request.user, is_deleted=False)

    def create(self, request, *args, **kwargs):
        enforce_feature(request.user, "api_access")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        raw_key = f"vf_live_{secrets.token_urlsafe(32)}"
        api_key = serializer.save(user=request.user, created_by=request.user)
        api_key.set_key(raw_key)
        api_key.save(update_fields=["key_prefix", "key_hash", "updated_at"])
        log_staff_activity(request.user, "api_key_created", f"Created API key {api_key.name}", actor=request.user, object_type="api_key", object_id=api_key.id)
        data = ApiKeySerializer(api_key).data
        data["raw_key"] = raw_key
        return Response(data, status=status.HTTP_201_CREATED)

    def perform_update(self, serializer):
        api_key = serializer.save()
        log_staff_activity(self.request.user, "api_key_updated", f"Updated API key {api_key.name}", actor=self.request.user, object_type="api_key", object_id=api_key.id)

    def perform_destroy(self, instance):
        instance.status = ApiKey.REVOKED
        instance.is_deleted = True
        instance.save(update_fields=["status", "is_deleted", "updated_at"])
        log_staff_activity(self.request.user, "api_key_revoked", f"Revoked API key {instance.name}", actor=self.request.user, object_type="api_key", object_id=instance.id)

    @action(detail=True, methods=["post"], url_path="revoke")
    def revoke(self, request, pk=None):
        api_key = self.get_object()
        api_key.status = ApiKey.REVOKED
        api_key.save(update_fields=["status", "updated_at"])
        log_staff_activity(request.user, "api_key_revoked", f"Revoked API key {api_key.name}", actor=request.user, object_type="api_key", object_id=api_key.id)
        return Response(ApiKeySerializer(api_key).data)


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
        if request.data.get("onboarding_complete") is True:
            from core.analytics import record_activation_event
            record_activation_event(request.user, "onboarding_completed")
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
