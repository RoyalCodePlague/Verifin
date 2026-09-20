import secrets
from django.conf import settings
from django.core import signing
from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import Request
from google.oauth2 import id_token
from rest_framework import permissions, serializers
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from billing.services import start_launch_promotion, record_referral_signup
from .models import Profile
from .serializers import UserSerializer, RegisterSerializer


class GoogleAuthThrottle(AnonRateThrottle):
    rate = "30/min"
    scope = "google_auth"


class GoogleInputSerializer(serializers.Serializer):
    credential = serializers.CharField(max_length=10000)
    nonce = serializers.CharField(max_length=1000)
    referral_code = serializers.CharField(required=False, allow_blank=True, max_length=32)
    business_name = serializers.CharField(required=False, allow_blank=True, max_length=255)


class GoogleSignInView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    parser_classes = [JSONParser]
    throttle_classes = [GoogleAuthThrottle]

    def get(self, request):
        response = Response({
            "client_id": settings.GOOGLE_CLIENT_ID,
            "nonce": signing.dumps(secrets.token_urlsafe(32), salt="google-login") if settings.GOOGLE_CLIENT_ID else None,
        })
        response["Cache-Control"] = "no-store"
        return response

    def post(self, request):
        if not settings.GOOGLE_CLIENT_ID:
            return Response({"detail": "Google sign-in is not configured yet. Please use email."}, status=503)
        # JSON-only + an exact trusted Origin protect this token exchange against login CSRF.
        origins = set(settings.CORS_ALLOWED_ORIGINS) | {settings.FRONTEND_URL}
        if request.headers.get("Origin") not in origins:
            raise PermissionDenied("Untrusted sign-in origin.")
        serializer = GoogleInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        try:
            signing.loads(data["nonce"], salt="google-login", max_age=600)
            claims = id_token.verify_oauth2_token(data["credential"], Request(), settings.GOOGLE_CLIENT_ID)
            if claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
                raise ValueError("Wrong issuer")
            if claims.get("nonce") != data["nonce"] or claims.get("email_verified") is not True:
                raise ValueError("Invalid claims")
            subject = claims.get("sub")
            if not isinstance(subject, str) or not subject or len(subject) > 255:
                raise ValueError("Missing subject")
            email = serializers.EmailField().run_validation(claims.get("email", "")).lower()
        except (ValueError, signing.BadSignature, serializers.ValidationError):
            raise AuthenticationFailed("Google sign-in expired or could not be verified. Please try again.")
        except GoogleAuthError:
            return Response({"detail": "Google verification is temporarily unavailable. Please try again."}, status=503)
        try:
            user, created = self.resolve_user(subject, email, claims, data)
        except IntegrityError:
            return Response({"detail": "Account sign-in changed during this request. Please try again."}, status=409)
        refresh = RefreshToken.for_user(user)
        return Response({"access": str(refresh.access_token), "refresh": str(refresh), "user": UserSerializer(user).data, "created": created})

    @staticmethod
    @transaction.atomic
    def resolve_user(subject, email, claims, data):
        User = get_user_model()
        user = User.objects.select_for_update().filter(google_subject=subject).first()
        created = False
        if not user:
            user = User.objects.select_for_update().filter(email__iexact=email).first()
            if user:
                if user.google_subject or not (email.endswith("@gmail.com") or claims.get("hd")):
                    raise AuthenticationFailed("Please sign in with your existing email and password. This Google account cannot be linked automatically.")
            else:
                referral = RegisterSerializer().validate_referral_code(data.get("referral_code", ""))
                user = User(email=email, username="google_" + secrets.token_hex(16), business_name=data.get("business_name", ""), email_verified=True)
                user.set_unusable_password()
                created = True
            if user.email_verification_pending and not user.is_deleted:
                # Google proves ownership; discard any password from the unverified signup.
                user.is_active = True
                user.email_verification_pending = False
                user.email_verification_token = ""
                user.set_unusable_password()
            if not user.is_active or user.is_deleted:
                raise AuthenticationFailed("This account is unavailable.")
            user.google_subject = subject
            user.email_verified = True
            user.save()
            Profile.objects.get_or_create(user=user)
            if created:
                start_launch_promotion(user)
                if referral:
                    record_referral_signup(user, referral)
        if not user.is_active or user.is_deleted:
            raise AuthenticationFailed("This account is unavailable.")
        from billing.services import qualify_referral_for_user
        qualify_referral_for_user(user)
        return user, created
