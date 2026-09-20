from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from django.conf import settings


@dataclass
class ProviderStatus:
    provider: str
    enabled: bool
    ready: bool
    label: str
    detail: str
    metadata: dict[str, Any] | None = None


class PaymentProvider(ABC):
    provider_name = "base"
    label = "Payment provider"

    @property
    def enabled(self) -> bool:
        return False

    @property
    def ready(self) -> bool:
        return False

    def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider=self.provider_name,
            enabled=self.enabled,
            ready=self.ready,
            label=self.label,
            detail="Provider is unavailable.",
            metadata={},
        )

    @abstractmethod
    def initiate_checkout(self, **kwargs: Any) -> dict[str, Any]:
        raise NotImplementedError


class MockProvider(PaymentProvider):
    provider_name = "mock"
    label = "Local mock"

    @property
    def enabled(self) -> bool:
        return settings.BILLING_TEST_MODE

    @property
    def ready(self) -> bool:
        return settings.BILLING_TEST_MODE

    def status(self) -> ProviderStatus:
        return ProviderStatus(
            provider=self.provider_name,
            enabled=self.enabled,
            ready=self.ready,
            label=self.label,
            detail="Local testing only." if self.enabled else "Test billing is disabled.",
            metadata={"mode": "demo"},
        )

    def initiate_checkout(self, **kwargs: Any) -> dict[str, Any]:
        return {
            "provider": self.provider_name,
            "mode": "demo",
            "status": "demo",
            "reference": kwargs.get("reference") or "mock-ref",
            "redirect_url": kwargs.get("return_url") or "http://localhost:8080/billing",
            "message": "Mock checkout was used for local testing.",
        }


class PesepayProvider(PaymentProvider):
    provider_name = "pesepay"
    label = "Pesepay"

    @property
    def enabled(self) -> bool:
        return getattr(settings, "PESEPAY_ENABLED", False)

    @property
    def ready(self) -> bool:
        return bool(
            getattr(settings, "PESEPAY_INTEGRATION_KEY", "").strip()
            and getattr(settings, "PESEPAY_ENCRYPTION_KEY", "").strip()
        )

    def status(self) -> ProviderStatus:
        if not self.enabled:
            return ProviderStatus(
                provider=self.provider_name,
                enabled=False,
                ready=False,
                label=self.label,
                detail="Pesepay is disabled by feature flag.",
                metadata={"enabled": False, "ready": False},
            )
        if not self.ready:
            return ProviderStatus(
                provider=self.provider_name,
                enabled=True,
                ready=False,
                label=self.label,
                detail="Pesepay is enabled but missing credentials. Add PESEPAY_INTEGRATION_KEY and PESEPAY_ENCRYPTION_KEY.",
                metadata={"enabled": True, "ready": False},
            )
        return ProviderStatus(
            provider=self.provider_name,
            enabled=True,
            ready=True,
            label=self.label,
            detail="Pesepay credentials are configured and ready.",
            metadata={"enabled": True, "ready": True},
        )

    def initiate_checkout(self, **kwargs: Any) -> dict[str, Any]:
        if not self.enabled:
            return {
                "provider": self.provider_name,
                "mode": "disabled",
                "status": "disabled",
                "reference": kwargs.get("reference") or "pesepay-disabled",
                "redirect_url": kwargs.get("return_url") or "http://localhost:8080/billing",
                "message": "Pesepay is disabled by feature flag.",
            }
        if not self.ready:
            return {
                "provider": self.provider_name,
                "mode": "unconfigured",
                "status": "disabled",
                "reference": kwargs.get("reference") or "pesepay-unconfigured",
                "redirect_url": kwargs.get("return_url") or "http://localhost:8080/billing",
                "message": "Pesepay is disabled until credentials are added.",
            }

        from .pesepay import initiate_pesepay_checkout

        return initiate_pesepay_checkout(**kwargs)


_PROVIDER_MAP = {
    "mock": MockProvider(),
    "pesepay": PesepayProvider(),
}


def get_checkout_provider(name: str | None = None) -> PaymentProvider:
    key = (name or "mock").lower()
    return _PROVIDER_MAP.get(key, MockProvider())


def get_provider_status() -> list[dict[str, Any]]:
    providers = []
    for name in ["mock", "pesepay"]:
        provider = get_checkout_provider(name)
        status = provider.status()
        providers.append({
            "provider": status.provider,
            "enabled": status.enabled,
            "ready": status.ready,
            "label": status.label,
            "detail": status.detail,
            "metadata": status.metadata or {},
        })
    return providers
