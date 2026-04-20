from datetime import timedelta
from pathlib import Path
import os
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.getenv("SECRET_KEY", "dev-only-secret-key-change-in-production")
DEBUG = os.getenv("DEBUG", "False").lower() in ("1", "true", "yes")
ALLOWED_HOSTS = [
    host.strip()
    for host in os.getenv("ALLOWED_HOSTS", "localhost,127.0.0.1,testserver,.railway.app,.vercel.app").split(",")
    if host.strip()
]
if DEBUG and "*" not in ALLOWED_HOSTS:
    ALLOWED_HOSTS.append("*")

# Groq AI Configuration
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

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
    "assistant",
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
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

AUTH_USER_MODEL = "accounts.User"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    "DEFAULT_AUTHENTICATION_CLASSES": ("rest_framework_simplejwt.authentication.JWTAuthentication",),
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

CORS_ALLOW_CREDENTIALS = True

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://verifin-tau.vercel.app").rstrip("/")

EMAIL_BACKEND = os.getenv("EMAIL_BACKEND", "django.core.mail.backends.smtp.EmailBackend" if os.getenv("EMAIL_HOST_USER") else "django.core.mail.backends.console.EmailBackend")
EMAIL_HOST = os.getenv("EMAIL_HOST", "smtp.gmail.com" if os.getenv("EMAIL_HOST_USER") else "")
EMAIL_PORT = int(os.getenv("EMAIL_PORT", "587"))
EMAIL_HOST_USER = os.getenv("EMAIL_HOST_USER", "")
EMAIL_HOST_PASSWORD = os.getenv("EMAIL_HOST_PASSWORD", "")
if EMAIL_HOST.endswith("gmail.com"):
    EMAIL_HOST_PASSWORD = EMAIL_HOST_PASSWORD.replace(" ", "")
EMAIL_USE_TLS = os.getenv("EMAIL_USE_TLS", "True").lower() in ("1", "true", "yes")
DEFAULT_FROM_EMAIL = os.getenv("DEFAULT_FROM_EMAIL", f"Verifin <{EMAIL_HOST_USER}>" if EMAIL_HOST_USER else "Verifin <noreply@verifin.app>")
EMAIL_VERIFICATION_TOKEN_TTL_HOURS = int(os.getenv("EMAIL_VERIFICATION_TOKEN_TTL_HOURS", "24"))
EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS = int(os.getenv("EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS", "60"))

CORS_ALLOWED_ORIGINS = [
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

