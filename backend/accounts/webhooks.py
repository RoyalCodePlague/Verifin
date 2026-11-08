import base64
import hashlib
import hmac
import http.client
import ipaddress
import json
import socket
import ssl
from datetime import timedelta
from urllib.parse import urlsplit

from Crypto.Cipher import AES
from Crypto.Random import get_random_bytes
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .models import WebhookDelivery, WebhookEndpoint


SUPPORTED_WEBHOOK_EVENTS = {
    "sale.created",
    "product.low_stock",
    "product.out_of_stock",
    "audit.completed",
    "expense.created",
}
MAX_ATTEMPTS = 8
MAX_PAYLOAD_BYTES = 256 * 1024
SENDING_TIMEOUT_SECONDS = 15 * 60


class WebhookSafetyError(ValueError):
    pass


def _cipher_key():
    return hashlib.sha256((settings.SECRET_KEY + ":webhook-secret:v1").encode("utf-8")).digest()


def encrypt_webhook_secret(secret):
    nonce = get_random_bytes(12)
    cipher = AES.new(_cipher_key(), AES.MODE_GCM, nonce=nonce)
    cipher.update(b"verifin-webhook-secret-v1")
    ciphertext, tag = cipher.encrypt_and_digest(secret.encode("utf-8"))
    return base64.urlsafe_b64encode(nonce + tag + ciphertext).decode("ascii")


def decrypt_webhook_secret(ciphertext):
    raw = base64.urlsafe_b64decode(ciphertext.encode("ascii"))
    nonce, tag, encrypted = raw[:12], raw[12:28], raw[28:]
    cipher = AES.new(_cipher_key(), AES.MODE_GCM, nonce=nonce)
    cipher.update(b"verifin-webhook-secret-v1")
    return cipher.decrypt_and_verify(encrypted, tag).decode("utf-8")


def validate_webhook_url(value):
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise WebhookSafetyError("Webhook URLs must be public HTTPS URLs without credentials or fragments.")
    try:
        port = parsed.port
    except ValueError as exc:
        raise WebhookSafetyError("Webhook URL has an invalid port.") from exc
    if port not in (None, 443):
        raise WebhookSafetyError("Webhook URLs must use the standard HTTPS port.")
    try:
        address = ipaddress.ip_address(parsed.hostname)
    except ValueError:
        hostname = parsed.hostname.rstrip(".").lower()
        if hostname in {"localhost", "localhost.localdomain"} or hostname.endswith(".localhost"):
            raise WebhookSafetyError("Webhook URLs cannot target local hosts.")
    else:
        if not address.is_global:
            raise WebhookSafetyError("Webhook URLs cannot target private or reserved IP addresses.")
    return parsed


def resolve_public_addresses(hostname):
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None:
        if not address.is_global:
            raise WebhookSafetyError("Webhook URLs cannot target private or reserved IP addresses.")
        return [str(address)]
    answers = socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
    addresses = sorted({answer[4][0] for answer in answers})
    if not addresses:
        raise OSError("Webhook host did not resolve.")
    if any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise WebhookSafetyError("Webhook host resolved to a private or reserved IP address.")
    return addresses


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, hostname, address, timeout):
        super().__init__(hostname, port=443, timeout=timeout, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        raw_socket = socket.create_connection((self.address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(raw_socket, server_hostname=self.host)


def enqueue_webhook_event(user, event, payload):
    if event not in SUPPORTED_WEBHOOK_EVENTS:
        return 0
    endpoints = WebhookEndpoint.objects.filter(user=user, is_active=True, is_deleted=False)
    return sum(
        WebhookDelivery.objects.create(endpoint=endpoint, event=event, payload=payload) is not None
        for endpoint in endpoints
        if event in endpoint.events
    )


def enqueue_product_stock_event(user, product, previous_status=None):
    if product.status == previous_status:
        return 0
    event = {
        "low": "product.low_stock",
        "out": "product.out_of_stock",
    }.get(product.status)
    if not event:
        return 0
    return enqueue_webhook_event(user, event, {
        "product_id": product.id,
        "name": product.name,
        "sku": product.sku,
        "stock": product.stock,
        "reorder_level": product.reorder_level,
        "branch_id": product.branch_id,
    })


def _send_delivery(delivery, secret):
    parsed = validate_webhook_url(delivery.endpoint.url)
    addresses = resolve_public_addresses(parsed.hostname)
    path = parsed.path or "/"
    if parsed.query:
        path += f"?{parsed.query}"
    envelope = {
        "id": delivery.id,
        "event": delivery.event,
        "created_at": delivery.created_at.isoformat(),
        "data": delivery.payload,
    }
    body = json.dumps(envelope, separators=(",", ":"), sort_keys=True).encode("utf-8")
    if len(body) > MAX_PAYLOAD_BYTES:
        raise WebhookSafetyError("Webhook payload exceeds the maximum supported size.")
    signature = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    hostname = parsed.hostname
    host_header = f"[{hostname}]" if ":" in hostname else hostname
    connection = _PinnedHTTPSConnection(hostname, addresses[0], timeout=5)
    try:
        connection.request(
            "POST",
            path,
            body=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Verifin-Webhooks/1.0",
                "Host": host_header,
                "X-Verifin-Event": delivery.event,
                "X-Verifin-Delivery": str(delivery.id),
                "X-Verifin-Signature": f"sha256={signature}",
            },
        )
        response = connection.getresponse()
        response.read(1024)
        return response.status
    finally:
        connection.close()


def _finish_delivery(delivery_id, *, status_code=None, error="", retryable=False):
    now = timezone.now()
    with transaction.atomic():
        delivery = WebhookDelivery.objects.select_for_update().get(pk=delivery_id)
        delivery.last_status_code = status_code
        delivery.last_error = error[:255]
        if status_code is not None and 200 <= status_code < 300:
            delivery.status = "delivered"
            delivery.delivered_at = now
        elif retryable and delivery.attempts < MAX_ATTEMPTS:
            delivery.status = "pending"
            delay_seconds = min(60 * (2 ** max(delivery.attempts - 1, 0)), 24 * 60 * 60)
            delivery.next_attempt_at = now + timedelta(seconds=delay_seconds)
        else:
            delivery.status = "failed"
        delivery.save(update_fields=[
            "status", "last_status_code", "last_error", "delivered_at",
            "next_attempt_at", "updated_at",
        ])


def deliver_due_webhooks(limit=100):
    now = timezone.now()
    stale_sending = now - timedelta(seconds=SENDING_TIMEOUT_SECONDS)
    due_ids = list(
        WebhookDelivery.objects.filter(is_deleted=False)
        .filter(
            Q(status="pending", next_attempt_at__lte=now)
            | Q(status="sending", updated_at__lte=stale_sending)
        )
        .order_by("created_at", "id")
        .values_list("id", flat=True)[:limit]
    )
    processed = 0
    for delivery_id in due_ids:
        with transaction.atomic():
            delivery = WebhookDelivery.objects.select_for_update().select_related("endpoint").get(pk=delivery_id)
            if delivery.status not in {"pending", "sending"} or delivery.next_attempt_at > now:
                continue
            endpoint = delivery.endpoint
            if not endpoint.is_active or endpoint.is_deleted:
                delivery.status = "failed"
                delivery.last_error = "Webhook endpoint is disabled."
                delivery.save(update_fields=["status", "last_error", "updated_at"])
                continue
            delivery.status = "sending"
            delivery.attempts += 1
            delivery.save(update_fields=["status", "attempts", "updated_at"])
            secret_ciphertext = endpoint.secret_ciphertext
        processed += 1
        try:
            status_code = _send_delivery(delivery, decrypt_webhook_secret(secret_ciphertext))
        except WebhookSafetyError as exc:
            _finish_delivery(delivery_id, error=str(exc))
        except (OSError, ssl.SSLError, http.client.HTTPException, ValueError) as exc:
            _finish_delivery(delivery_id, error=f"Delivery request failed: {type(exc).__name__}.", retryable=True)
        else:
            retryable = status_code == 429 or status_code >= 500
            message = "" if 200 <= status_code < 300 else f"Webhook receiver returned HTTP {status_code}."
            _finish_delivery(delivery_id, status_code=status_code, error=message, retryable=retryable)
    return processed
