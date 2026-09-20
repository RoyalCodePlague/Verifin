from datetime import timedelta
from pathlib import Path
import os
from urllib.parse import urlparse
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")
load_dotenv()
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-key-change-in-production")
DEBUG = os.getenv("DEBUG", "False").lower() in ("1", "true", "yes")
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver,.railway.app,.vercel.app").split(",")
    if host.strip()
]
if DEBUG and "*" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append("*")


# Pesepay Configuration
PESEPAY_ENABLED = os.getenv("PESEPAY_ENABLED", "False").lower() in ("1", "true", "yes")
PESEPAY_ENV = os.getenv("PESEPAY_ENV", "sandbox")
PESEPAY_INTEGRATION_KEY = os.getenv("PESEPAY_INTEGRATION_KEY", "")
PESEPAY_ENCRYPTION_KEY = os.getenv("PESEPAY_ENCRYPTION_KEY", "")
PESEPAY_RESULT_URL = os.getenv("PESEPAY_RESULT_URL", "")
PESEPAY_RETURN_URL = os.getenv("PESEPAY_RETURN_URL", "")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "corsheaders",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "django_filters",
    "accounts",
    "inventory",
    "sales",
    "expenses",
    "audits",
    "customers",
    "reports",
    "notifications",
    "assistant",  # Retired models retained for existing migration history only.
    "billing",
    "sync",
    "core",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    'whitenoise.middleware.WhiteNoiseMiddleware',
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]
WSGI_APPLICATION = "config.wsgi.application"
DATABASE_URL = os.getenv("DATABASE_URL")

def is_usable_database_url(value):
    if not value:
        return False
    parsed = urlparse(value)
    db_name = parsed.path.lstrip("/")
    return bool(parsed.hostname and parsed.hostname != "host" and db_name and db_name != "dbname")


if is_usable_database_url(DATABASE_URL):
    db_url = urlparse(DATABASE_URL)
    try:
        db_port = db_url.port or 5432
    except ValueError:
        db_port = 5432

    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": db_url.path.lstrip("/"),
            "USER": db_url.username,
            "PASSWORD": db_url.password,
            "HOST": db_url.hostname,
            "PORT": db_port,
        }
    }
elif os.getenv("DB_NAME"):
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DB_NAME"),
            "USER": os.getenv("DB_USER"),
            "PASSWORD": os.getenv("DB_PASSWORD"),
            "HOST": os.getenv("DB_HOST"),
            "PORT": os.getenv("DB_PORT") or 5432,
        }
    }
else:
    DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}}


AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": ("accounts.authentication.StaffAwareJWTAuthentication",),
    "DEFAULT_FILTER_BACKENDS": (
        "django_filters.rest_framework.DjangoFilterBackend",
        "rest_framework.filters.SearchFilter",
        "rest_framework.filters.OrderingFilter",
    ),
    "DEFAULT_PAGINATION_CLASS": "core.pagination.StandardCursorPagination",
    "DEFAULT_VERSIONING_CLASS": "rest_framework.versioning.URLPathVersioning",
    "DEFAULT_VERSION": "v1",
    "ALLOWED_VERSIONS": ["v1"],
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=30),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "strict-origin-when-cross-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SAMESITE = "Lax"
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

if not DEBUG:
    CSRF_COOKIE_SECURE = True
    SESSION_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.getenv("SECURE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = os.getenv("SECURE_HSTS_INCLUDE_SUBDOMAINS", "false").lower() in ("1", "true", "yes")
    SECURE_HSTS_PRELOAD = os.getenv("SECURE_HSTS_PRELOAD", "false").lower() in ("1", "true", "yes")

CORS_ALLOW_CREDENTIALS = True

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://verifin-tau.vercel.app").rstrip("/")

MAILGUN_API_KEY = os.getenv("MAILGUN_API_KEY", "").strip()
MAILGUN_DOMAIN = os.getenv("MAILGUN_DOMAIN", "").strip()
MAILGUN_REGION = os.getenv("MAILGUN_REGION", "us").strip().lower()

# Mailgun credentials take precedence as a group to avoid mixing SMTP providers.
MAILGUN_SMTP_CONFIGURED = any(os.getenv(name) for name in (
    "MAILGUN_SMTP_HOST", "MAILGUN_SMTP_USERNAME", "MAILGUN_SMTP_PASSWORD",
))
EMAIL_BACKEND = os.getenv(
    "EMAIL_BACKEND",
    "accounts.mailgun_backend.EmailBackend" if MAILGUN_API_KEY else (
        "django.core.mail.backends.console.EmailBackend" if DEBUG and not MAILGUN_SMTP_CONFIGURED else "django.core.mail.backends.smtp.EmailBackend"
    ),
)
if MAILGUN_SMTP_CONFIGURED:
    EMAIL_HOST = os.getenv("MAILGUN_SMTP_HOST") or "smtp.mailgun.org"
    EMAIL_PORT = int(os.getenv("MAILGUN_SMTP_PORT") or "587")
    EMAIL_HOST_USER = os.getenv("MAILGUN_SMTP_USERNAME", "").strip()
    EMAIL_HOST_PASSWORD = os.getenv("MAILGUN_SMTP_PASSWORD", "")
else:
    EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com" if os.getenv("EMAIL_HOST_USER") else "")
    EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
    EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
    EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "").strip()
if EMAIL_HOST.endswith("gmail.com"):
    EMAIL_HOST_PASSWORD = EMAIL_HOST_PASSWORD.replace(" ", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() in ("1", "true", "yes")
EMAIL_TIMEOUT = int(os.getenv("EMAIL_TIMEOUT", "15"))
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", f"Verifin <{EMAIL_HOST_USER}>" if EMAIL_HOST_USER else "Verifin <noreply@verifin.app>")
EMAIL_VERIFICATION_TOKEN_TTL_HOURS = int(os.getenv("EMAIL_VERIFICATION_TOKEN_TTL_HOURS", "24"))
EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = int(os.getenv("EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", "60"))

CORS_ALLOWED_ORIGINS = [
    "http://localhost:4489",
    "http://127.0.0.1:4489",
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://127.0.0.1:8081",
    "http://localhost:8081",
    "http://127.0.0.1:8082",
    "http://localhost:8082",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://192.168.100.4:8080",
    "https://verifin-tau.vercel.app",
    # Vercel production - UPDATE AFTER DEPLOYMENT
    "https://your-project.vercel.app",
]

if FRONTEND_URL not in CORS_ALLOWED_ORIGINS:
    CORS_ALLOWED_ORIGINS.append(FRONTEND_URL)

CORS_ALLOWED_ORIGIN_REGEXES = [
    r"^https://.*\.vercel\.app$",
]

CSRF_TRUSTED_ORIGINS = [
    "http://127.0.0.1:8080",
    "http://localhost:8080",
    "http://127.0.0.1:8081",
    "http://localhost:8081",
    "http://127.0.0.1:8082",
    "http://192.168.100.4:8080",
    "http://localhost:8082",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "https://verifin-tau.vercel.app",
    # Vercel production - UPDATE AFTER DEPLOYMENT
    "https://your-project.vercel.app",
]

if FRONTEND_URL not in CSRF_TRUSTED_ORIGINS:
    CSRF_TRUSTED_ORIGINS.append(FRONTEND_URL)

STORAGES = {
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# The folder where everything gets collected
STATIC_ROOT = BASE_DIR / 'staticfiles'

# The URL prefix users use to access these files (e.g., /static/styles.css)
STATIC_URL = '/static/'


# Launch offer: one 30-day promotion per newly registered account.
LAUNCH_PROMO_ENABLED = os.getenv("LAUNCH_PROMO_ENABLED", "True").lower() in ("1", "true", "yes")
BILLING_TEST_MODE = DEBUG and os.getenv("BILLING_TEST_MODE", "False").lower() in ("1", "true", "yes")

# Public OAuth Web client ID; no client secret is needed for GIS ID-token sign-in.
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "").strip()

# Local mail previews must be explicitly enabled; SMTP is required for real delivery.
EMAIL_ALLOW_LOCAL_VERIFICATION = os.getenv("EMAIL_ALLOW_LOCAL_VERIFICATION", "False").lower() in ("1", "true", "yes")
EMAIL_USE_SSL = os.getenv("EMAIL_USE_SSL", "False").lower() in ("1", "true", "yes")
ACCOUNT_AUTH_LIMITS = {
    "register": {"ip": (5, 3600), "email": (3, 3600)},
    "login": {"ip": (30, 300), "email": (10, 900)},
    "resend": {"ip": (10, 3600), "email": (3, 3600)},
    "verify": {"ip": (30, 900)},
}
# Set only when requests arrive through that many trusted reverse proxies.
REST_FRAMEWORK["NUM_PROXIES"] = int(os.getenv("AUTH_TRUSTED_PROXY_COUNT", "0"))
