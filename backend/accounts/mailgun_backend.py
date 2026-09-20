"""Django email delivery using a domain-scoped Mailgun sending API key."""

from urllib.parse import quote

import requests
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.mail.backends.base import BaseEmailBackend


class MailgunDeliveryError(Exception):
    """A delivery error safe to log without the request, key or email body."""


class EmailBackend(BaseEmailBackend):
    def send_messages(self, email_messages):
        if not email_messages:
            return 0
        if not settings.MAILGUN_API_KEY or not settings.MAILGUN_DOMAIN:
            if self.fail_silently:
                return 0
            raise ImproperlyConfigured("Set MAILGUN_API_KEY and MAILGUN_DOMAIN.")
        if settings.MAILGUN_REGION not in ("us", "eu"):
            if self.fail_silently:
                return 0
            raise ImproperlyConfigured("MAILGUN_REGION must be us or eu.")

        host = "api.eu.mailgun.net" if settings.MAILGUN_REGION == "eu" else "api.mailgun.net"
        domain = quote(settings.MAILGUN_DOMAIN, safe="")
        url = f"https://{host}/v3/{domain}/messages.mime"
        sent = 0
        for message in email_messages:
            if not message.recipients():
                continue
            try:
                # Django builds the MIME, including HTML, attachments and headers.
                # Bcc is carried in the envelope, not the visible message headers.
                mime = message.message().as_bytes()
                try:
                    response = requests.post(
                        url,
                        auth=("api", settings.MAILGUN_API_KEY),
                        data={
                            "to": message.recipients(),
                            "o:tracking": "no",
                            "o:tracking-clicks": "no",
                            "o:tracking-opens": "no",
                        },
                        files={"message": ("message.eml", mime, "message/rfc822")},
                        timeout=settings.EMAIL_TIMEOUT,
                        allow_redirects=False,
                    )
                except requests.RequestException:
                    raise MailgunDeliveryError("Could not reach Mailgun. Check network access and retry later.") from None
                try:
                    if response.status_code != 200:
                        raise MailgunDeliveryError(
                            f"Mailgun rejected delivery (HTTP {response.status_code}). "
                            "Check the sending key, region and domain verification."
                        )
                    try:
                        result = response.json()
                    except ValueError:
                        result = None
                    if not isinstance(result, dict) or not result.get("id"):
                        raise MailgunDeliveryError("Mailgun did not confirm message acceptance.")
                finally:
                    response.close()
                sent += 1
            except Exception:
                if not self.fail_silently:
                    raise
        return sent
