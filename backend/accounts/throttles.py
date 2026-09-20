from datetime import timedelta
from django.conf import settings
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import salted_hmac
from rest_framework.throttling import BaseThrottle
from .models import AuthThrottleBucket


class AccountThrottle(BaseThrottle):
    """Shared, atomic rate limits across application workers; no raw emails/IPs stored."""
    def allow_request(self, request, view):
        if request.method != "POST":
            return True
        now = timezone.now()
        self.retry_after = 60
        scope = view.auth_throttle_scope
        limits = settings.ACCOUNT_AUTH_LIMITS[scope]
        identities = {"ip": self.get_ident(request)}
        if scope in ("register", "resend", "login"):
            email = request.data.get("email", "") if isinstance(request.data, dict) else ""
            if isinstance(email, str) and email:
                identities["email"] = email.strip().lower()
        AuthThrottleBucket.objects.filter(expires_at__lt=now).delete()
        for kind, identity in identities.items():
            limit, seconds = limits[kind]
            window = int(now.timestamp()) // seconds
            key = salted_hmac("account-rate-limit", f"{scope}:{kind}:{identity}:{window}", algorithm="sha256").hexdigest()
            with transaction.atomic():
                bucket, _ = AuthThrottleBucket.objects.get_or_create(key=key, defaults={"expires_at": now + timedelta(seconds=seconds)})
                bucket = AuthThrottleBucket.objects.select_for_update().get(pk=bucket.pk)
                if bucket.attempts >= limit:
                    self.retry_after = max(1, (window + 1) * seconds - int(now.timestamp()))
                    return False
                bucket.attempts += 1
                bucket.save(update_fields=["attempts"])
        return True

    def wait(self):
        return self.retry_after
