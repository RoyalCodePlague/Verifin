import logging
from time import perf_counter

from django.db import DatabaseError


logger = logging.getLogger(__name__)


class ApiKeyUsageLogMiddleware:
    """Finish API-key usage records without storing request payloads or secrets."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.api_key_request_started_at = perf_counter()
        response = self.get_response(request)
        return self.process_response(request, response)

    def process_response(self, request, response):
        log_id = getattr(request, "api_key_request_log_id", None)
        if log_id:
            try:
                from .models import ApiKeyRequestLog

                elapsed_ms = max(0, int((perf_counter() - request.api_key_request_started_at) * 1000))
                ApiKeyRequestLog.objects.filter(pk=log_id).update(
                    status_code=response.status_code,
                    response_time_ms=elapsed_ms,
                )
            except DatabaseError:
                logger.exception("Could not update API-key usage log %s", log_id)
        return response
