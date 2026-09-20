from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.core.mail import send_mail
from django.core.validators import validate_email

class Command(BaseCommand):
    help = "Check Mailgun API or SMTP configuration; optionally send a test with --to ADDRESS."
    def add_arguments(self, parser):
        parser.add_argument("--to", dest="recipient")
    def handle(self, *args, **options):
        if settings.EMAIL_BACKEND == "accounts.mailgun_backend.EmailBackend":
            provider = "Mailgun API"
            required = ("MAILGUN_API_KEY", "MAILGUN_DOMAIN", "DEFAULT_FROM_EMAIL")
            if settings.MAILGUN_REGION not in ("us", "eu"):
                raise CommandError("MAILGUN_REGION must be us or eu.")
        elif settings.EMAIL_BACKEND.endswith("smtp.EmailBackend"):
            provider = "SMTP"
            required = ("EMAIL_HOST", "EMAIL_HOST_USER", "EMAIL_HOST_PASSWORD", "DEFAULT_FROM_EMAIL")
            if settings.EMAIL_USE_SSL and settings.EMAIL_USE_TLS:
                raise CommandError("Enable EMAIL_USE_TLS or EMAIL_USE_SSL, not both.")
        else:
            raise CommandError("Email delivery is not ready. Configure EMAIL_BACKEND for Mailgun API or SMTP.")
        missing = [name for name in required if not getattr(settings, name, "")]
        if missing:
            raise CommandError("Email delivery is not ready. Configure: " + ", ".join(missing))
        self.stdout.write(f"{provider} settings are present. Credentials and DNS have not been validated remotely. No message has been sent yet.")
        if options["recipient"]:
            try:
                validate_email(options["recipient"])
                count = send_mail("Verifin email delivery test", "Verifin can send email through your configured email service.", settings.DEFAULT_FROM_EMAIL, [options["recipient"]], fail_silently=False)
            except Exception as exc:
                raise CommandError(f"{provider} test failed (" + type(exc).__name__ + "). Check the provider settings and sender verification.") from None
            if count != 1:
                raise CommandError("The provider did not accept the test message.")
            self.stdout.write(self.style.SUCCESS("Provider accepted the test message. Confirm it arrives in the recipient inbox."))
