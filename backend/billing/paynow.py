from __future__ import annotations

import hmac
from hashlib import sha512
from decimal import Decimal
from urllib.error import URLError
from urllib.parse import parse_qsl, urlencode, urlparse
from urllib.request import Request, urlopen

from django.conf import settings


class PaynowError(Exception):
    pass


def _signature(values: dict[str, str], key: str) -> str:
    message = "".join(str(value) for name, value in values.items() if name.lower() != "hash") + key
    return sha512(message.encode("utf-8")).hexdigest().upper()


def verify_hash(values: dict[str, str]) -> bool:
    received = next((str(value) for name, value in values.items() if name.lower() == "hash"), "")
    expected = _signature(values, settings.PAYNOW_INTEGRATION_KEY) if settings.PAYNOW_INTEGRATION_KEY else ""
    return bool(received and expected and hmac.compare_digest(expected, received.upper()))


def _parse_response(body: bytes) -> dict[str, str]:
    # Paynow's examples use both lower and upper case field names.
    return {key.lower(): value for key, value in parse_qsl(body.decode("utf-8"), keep_blank_values=True)}


def _validate_paynow_url(value: str, *, label: str) -> str:
    parsed = urlparse(value)
    allowed_hosts = {"www.paynow.co.zw", "staging.paynow.co.zw"}
    try:
        port = parsed.port
    except ValueError as exc:
        raise PaynowError(f"Paynow returned an invalid {label} URL.") from exc
    if (
        parsed.scheme != "https"
        or (parsed.hostname or "").lower() not in allowed_hosts
        or port not in (None, 443)
        or parsed.username
        or parsed.password
    ):
        raise PaynowError(f"Paynow returned an invalid {label} URL.")
    return value


def _post_form(url: str, fields: dict[str, str]) -> dict[str, str]:
    request = Request(url, data=urlencode(fields).encode("utf-8"), headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    try:
        with urlopen(request, timeout=20) as response:
            result = _parse_response(response.read())
    except (URLError, TimeoutError, UnicodeDecodeError) as exc:
        raise PaynowError("Could not contact Paynow. Please try again.") from exc
    if not verify_hash(result):
        raise PaynowError("Paynow response signature could not be verified.")
    return result


def initiate_checkout(*, reference: str, amount: Decimal, description: str, return_url: str, result_url: str) -> dict[str, str]:
    fields = {
        "id": settings.PAYNOW_INTEGRATION_ID,
        "reference": reference,
        "amount": f"{amount:.2f}",
        "additionalinfo": description[:255],
        "returnurl": return_url,
        "resulturl": result_url,
        "status": "Message",
    }
    fields["hash"] = _signature(fields, settings.PAYNOW_INTEGRATION_KEY)
    response = _post_form(f"{settings.PAYNOW_API_BASE}/initiatetransaction", fields)
    if response.get("status", "").lower() != "ok" or not response.get("browserurl") or not response.get("pollurl"):
        raise PaynowError(response.get("error") or "Paynow did not return a checkout link.")
    _validate_paynow_url(response["browserurl"], label="checkout")
    _validate_paynow_url(response["pollurl"], label="payment status")
    return response


def initiate_mobile_checkout(
    *,
    reference: str,
    amount: Decimal,
    description: str,
    return_url: str,
    result_url: str,
    method: str,
    phone: str,
    auth_email: str,
) -> dict[str, str]:
    method = method.lower().strip()
    if method not in {"ecocash", "onemoney"}:
        raise PaynowError("Choose EcoCash or OneMoney for mobile checkout.")
    if not auth_email:
        raise PaynowError("An email address is required to start a Paynow mobile payment.")

    fields = {
        "id": settings.PAYNOW_INTEGRATION_ID,
        "reference": reference,
        "amount": f"{amount:.2f}",
        "additionalinfo": description[:255],
        "returnurl": return_url,
        "resulturl": result_url,
        "authemail": auth_email,
        "authphone": phone,
        "phone": phone,
        "method": method,
        "merchanttrace": reference[:32],
        "status": "Message",
    }
    fields["hash"] = _signature(fields, settings.PAYNOW_INTEGRATION_KEY)
    response = _post_form(f"{settings.PAYNOW_API_BASE}/remotetransaction", fields)
    if response.get("status", "").lower() not in {"ok", "awaiting delivery", "sent"} or not response.get("pollurl"):
        raise PaynowError(response.get("error") or "Paynow could not start the mobile payment.")
    _validate_paynow_url(response["pollurl"], label="payment status")
    return response


def poll_status(poll_url: str) -> dict[str, str]:
    _validate_paynow_url(poll_url, label="payment status")
    request = Request(poll_url, data=b"", headers={"Content-Length": "0"}, method="POST")
    try:
        with urlopen(request, timeout=20) as response:
            values = _parse_response(response.read())
    except (URLError, TimeoutError, UnicodeDecodeError) as exc:
        raise PaynowError("Could not check payment status with Paynow.") from exc
    if not verify_hash(values):
        raise PaynowError("Paynow payment status signature could not be verified.")
    return values
