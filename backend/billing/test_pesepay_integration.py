import json

from django.test import SimpleTestCase, override_settings

from billing.pesepay import decrypt_pesepay_payload, encrypt_pesepay_payload
from billing.providers import PesepayProvider


class PesepayPayloadTests(SimpleTestCase):
    def test_encrypt_and_decrypt_round_trip(self):
        key = "0123456789abcdef0123456789abcdef"
        payload = {
            "amountDetails": {"amount": 150.0, "currencyCode": "ZWL"},
            "reasonForPayment": "Verifin subscription",
            "resultUrl": "https://example.com/pesepay/result",
            "returnUrl": "https://example.com/billing",
        }

        encrypted = encrypt_pesepay_payload(payload, key)
        self.assertIsInstance(encrypted, str)
        self.assertNotEqual(encrypted, "")

        decrypted = decrypt_pesepay_payload(encrypted, key)
        self.assertEqual(json.loads(decrypted), payload)


class PesepayProviderStatusTests(SimpleTestCase):
    @override_settings(PESEPAY_ENABLED=False)
    def test_provider_is_disabled_when_feature_flag_is_off(self):
        provider = PesepayProvider()
        self.assertFalse(provider.enabled)
        self.assertFalse(provider.ready)
        self.assertFalse(provider.status().ready)

    @override_settings(PESEPAY_ENABLED=True, PESEPAY_INTEGRATION_KEY="", PESEPAY_ENCRYPTION_KEY="")
    def test_provider_flags_missing_credentials_as_unready(self):
        provider = PesepayProvider()
        self.assertTrue(provider.enabled)
        self.assertFalse(provider.ready)
        self.assertFalse(provider.status().ready)
