from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView
from .views import CustomTokenObtainPairView, GoogleOAuthPlaceholderView, LogoutView, MeView, ProfileViewSet, RegisterView, ResendVerificationEmailView, StaffActivityLogViewSet, StaffViewSet, VerifyEmailView

router = DefaultRouter()
router.register("profiles", ProfileViewSet, basename="profile")
router.register("staff", StaffViewSet, basename="staff")
router.register("activity-logs", StaffActivityLogViewSet, basename="activity-logs")

urlpatterns = [
    path("", include(router.urls)),
    path("register/", RegisterView.as_view(), name="register"),
    path("verify-email/", VerifyEmailView.as_view(), name="verify_email"),
    path("resend-verification/", ResendVerificationEmailView.as_view(), name="resend_verification"),
    path("login/", CustomTokenObtainPairView.as_view(), name="login"),
    path("token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("me/", MeView.as_view(), name="me"),
    path("google/", GoogleOAuthPlaceholderView.as_view(), name="google_oauth"),
]
