from django.contrib import admin
from django.http import HttpResponse, JsonResponse
from django.urls import include, path
from django.conf import settings
from django.conf.urls.static import static
from .admin import configure_admin_site


configure_admin_site()


def api_root(request):
    return JsonResponse({
        "name": "Verifin API",
        "status": "ok",
        "frontend": getattr(settings, "FRONTEND_URL", "https://verifin-tau.vercel.app"),
        "health": "/health/",
        "api": "/api/v1/",
        "docs": f"{getattr(settings, 'FRONTEND_URL', 'https://verifin-tau.vercel.app').rstrip('/')}/api-docs",
    })


def favicon(request):
    return HttpResponse(status=204)


urlpatterns = [
    path('', api_root),
    path('health/', lambda request: JsonResponse({'status': 'ok'})),
    path('favicon.ico', favicon),
    path('admin/', admin.site.urls),
    path('api/v1/assistant/', include('assistant.urls')),
    path("api/v1/accounts/", include("accounts.urls")),
    path("api/v1/inventory/", include("inventory.urls")),
    path("api/v1/sales/", include("sales.urls")),
    path("api/v1/expenses/", include("expenses.urls")),
    path("api/v1/audits/", include("audits.urls")),
    path("api/v1/customers/", include("customers.urls")),
    path("api/v1/reports/", include("reports.urls")),
    path("api/v1/notifications/", include("notifications.urls")),
    path("api/v1/assistant/", include("assistant.urls")),
    path("api/v1/billing/", include("billing.urls")),
    path("api/v1/sync/", include("sync.urls")),
]

urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
