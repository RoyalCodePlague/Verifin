import hashlib
import logging
import secrets
from datetime import timedelta
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

logger = logging.getLogger(__name__)

class VerificationEmailError(Exception):
    pass

def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()

def verification_token_expired(user):
    return not user.email_verification_sent_at or timezone.now() >= user.email_verification_sent_at + timedelta(hours=settings.EMAIL_VERIFICATION_TOKEN_TTL_HOURS)

def send_verification_email(user):
    backend = settings.EMAIL_BACKEND
    if backend == "accounts.mailgun_backend.EmailBackend":
        if not all([settings.MAILGUN_API_KEY, settings.MAILGUN_DOMAIN, settings.DEFAULT_FROM_EMAIL]):
            raise VerificationEmailError("Email delivery is not configured yet. Your account is pending verification.")
    elif backend.endswith("smtp.EmailBackend"):
        if not all([settings.EMAIL_HOST, settings.EMAIL_HOST_USER, settings.EMAIL_HOST_PASSWORD, settings.DEFAULT_FROM_EMAIL]):
            raise VerificationEmailError("Email delivery is not configured yet. Your account is pending verification.")
    elif not backend.endswith("locmem.EmailBackend") and not (settings.DEBUG and settings.EMAIL_ALLOW_LOCAL_VERIFICATION):
        raise VerificationEmailError("Email delivery is not configured yet. Your account is pending verification.")
    token = secrets.token_urlsafe(32)
    old_token, old_sent_at = user.email_verification_token, user.email_verification_sent_at
    user.email_verification_token = token_digest(token)
    user.email_verification_sent_at = timezone.now()
    user.save(update_fields=["email_verification_token", "email_verification_sent_at"])
    try:
        sent = send_mail(
            "Verify your Verifin email",
            f"Welcome to Verifin.\n\nConfirm your email to activate your account:\n{settings.FRONTEND_URL.rstrip('/')}/verify-email?token={token}\n\nThis link expires in {settings.EMAIL_VERIFICATION_TOKEN_TTL_HOURS} hours and can only be used once. Your promotion ends 30 days after signup.\n\nIf you did not sign up, ignore this email.",
            settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False,
        )
        if sent != 1:
            raise VerificationEmailError("Email provider did not accept the message.")
    except Exception as exc:
        user.email_verification_token, user.email_verification_sent_at = old_token, old_sent_at
        user.save(update_fields=["email_verification_token", "email_verification_sent_at"])
        logger.warning("Verification email delivery failed (%s)", type(exc).__name__)
        raise VerificationEmailError("Could not send the verification email. Please try resending later.") from None
