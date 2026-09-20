import base64
import json
from typing import Any

import requests
from django.conf import settings


def money_amount(value: Any) -> float:
    return float(value or 0)


def pesepay_base_url() -> str:
    env_name = getattr(settings, "PESEPAY_ENV", "sandbox").lower()
    if env_name == "production":
        return "https://api.pesepay.com/api/payments-engine/v1"
    return "https://api.test.sandbox.pesepay.com/payments-engine/v1"


def pesepay_requires_credentials() -> bool:
    return bool(getattr(settings, "PESEPAY_INTEGRATION_KEY", "").strip() and getattr(settings, "PESEPAY_ENCRYPTION_KEY", "").strip())


def encrypt_pesepay_payload(payload: dict[str, Any], encryption_key: str) -> str:
    from Crypto.Cipher import AES

    key = (encryption_key or "").strip()
    if len(key) < 16:
        raise ValueError("PESEPAY encryption key must be at least 16 characters long.")

    iv = key[:16].encode("utf-8")
    serialized = json.dumps(payload, separators=(",", ":"), default=str).encode("utf-8")
    pad = AES.block_size - (len(serialized) % AES.block_size)
    padded = serialized + bytes([pad]) * pad
    cipher = AES.new(key.encode("utf-8"), AES.MODE_CBC, iv)
    return base64.b64encode(cipher.encrypt(padded)).decode("utf-8")


def decrypt_pesepay_payload(encrypted_payload: str, encryption_key: str) -> str:
    from Crypto.Cipher import AES

    key = (encryption_key or "").strip()
    if len(key) < 16:
        raise ValueError("PESEPAY encryption key must be at least 16 characters long.")

    iv = key[:16].encode("utf-8")
    raw = base64.b64decode(encrypted_payload)
    cipher = AES.new(key.encode("utf-8"), AES.MODE_CBC, iv)
    padded = cipher.decrypt(raw)
    pad = padded[-1]
    if pad < 1 or pad > AES.block_size:
        raise ValueError("Pesepay payload could not be decrypted.")
    return padded[:-pad].decode("utf-8")


def build_pesepay_checkout_payload(
    *,
    plan_name: str,
    amount: float,
    currency: str,
    reference: str,
    reason: str,
    return_url: str,
    result_url: str,
    customer_email: str | None = None,
    customer_name: str | None = None,
    phone_number: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "amountDetails": {
            "amount": money_amount(amount),
            "currencyCode": (currency or "ZAR").upper(),
        },
        "merchantReference": reference,
        "reasonForPayment": reason or f"Verifin payment for {plan_name}",
        "resultUrl": result_url,
        "returnUrl": return_url,
    }

    if customer_email or customer_name or phone_number:
        payload["customer"] = {
            "email": customer_email or "",
            "phoneNumber": phone_number or "",
            "name": customer_name or "",
        }

    return payload


def initiate_pesepay_checkout(
    *,
    plan_name: str,
    amount: float,
    currency: str,
    reference: str,
    return_url: str,
    result_url: str,
    customer_email: str | None = None,
    customer_name: str | None = None,
    phone_number: str | None = None,
) -> dict[str, Any]:
    if not pesepay_requires_credentials():
        return {
            "mode": "demo",
            "provider": "pesepay",
            "reference": reference,
            "redirect_url": return_url,
            "result_url": result_url,
            "status": "demo",
            "transaction_status": "DEMO",
            "message": "Pesepay credentials were not configured. Using a local demo redirect for development.",
        }

    body = build_pesepay_checkout_payload(
        plan_name=plan_name,
        amount=amount,
        currency=currency,
        reference=reference,
        reason=f"Verifin {plan_name} subscription",
        return_url=return_url,
        result_url=result_url,
        customer_email=customer_email,
        customer_name=customer_name,
        phone_number=phone_number,
    )
    encrypted_payload = encrypt_pesepay_payload(body, getattr(settings, "PESEPAY_ENCRYPTION_KEY", ""))
    response = requests.post(
        f"{pesepay_base_url()}/payments/initiate",
        json={"payload": encrypted_payload},
        headers={
            "authorization": getattr(settings, "PESEPAY_INTEGRATION_KEY", ""),
            "Content-Type": "application/json",
        },
        timeout=20,
    )
    response.raise_for_status()

    response_data = response.json()
    encrypted_response = response_data.get("payload") or response_data.get("data")
    if not encrypted_response:
        raise ValueError("Pesepay did not return a payload in the transaction initiation response.")

    plaintext = decrypt_pesepay_payload(encrypted_response, getattr(settings, "PESEPAY_ENCRYPTION_KEY", ""))
    parsed = json.loads(plaintext)
    return {
        "mode": "live",
        "provider": "pesepay",
        "reference": parsed.get("referenceNumber") or reference,
        "redirect_url": parsed.get("redirectUrl") or return_url,
        "result_url": parsed.get("resultUrl") or result_url,
        "status": parsed.get("transactionStatus") or "INITIATED",
        "transaction_status": parsed.get("transactionStatus") or "INITIATED",
        "internal_reference": parsed.get("internalReference"),
        "message": "Pesepay checkout initiated successfully.",
        "raw": parsed,
    }


def check_pesepay_status(reference_number: str) -> dict[str, Any]:
    if not pesepay_requires_credentials():
        return {
            "provider": "pesepay",
            "reference": reference_number,
            "status": "demo",
            "message": "Pesepay credentials are not configured. Demo status only.",
        }

    response = requests.get(
        f"{pesepay_base_url()}/payments/check-payment",
        params={"referenceNumber": reference_number},
        headers={
            "authorization": getattr(settings, "PESEPAY_INTEGRATION_KEY", ""),
            "Content-Type": "application/json",
        },
        timeout=20,
    )
    response.raise_for_status()

    response_data = response.json()
    encrypted_response = response_data.get("payload") or response_data.get("data")
    if not encrypted_response:
        return {"provider": "pesepay", "reference": reference_number, "status": "unknown", "message": "No encrypted response returned."}

    plaintext = decrypt_pesepay_payload(encrypted_response, getattr(settings, "PESEPAY_ENCRYPTION_KEY", ""))
    parsed = json.loads(plaintext)
    return {
        "provider": "pesepay",
        "reference": parsed.get("referenceNumber") or reference_number,
        "status": parsed.get("transactionStatus") or "UNKNOWN",
        "transaction_status": parsed.get("transactionStatus") or "UNKNOWN",
        "message": parsed.get("transactionStatusDescription") or "Pesepay status check complete.",
        "raw": parsed,
    }
