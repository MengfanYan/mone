import os
import unittest
from unittest.mock import patch

from services.cloud.config import Config
from services.cloud.tls import require_verified_tls
from services.api.domain import Problem


class ConfigTests(unittest.TestCase):
    def environment(self):
        return {
            "SUPABASE_URL": "https://synthetic.supabase.co",
            "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_synthetic",
            "CLOUD_PUBLIC_ORIGIN": "http://localhost:3002",
            "CLOUD_DATABASE_URL": "synthetic-connection-not-opened",
            "BILLING_ENABLED": "false",
        }

    def test_api_does_not_require_the_bff_only_recovery_secret(self):
        with patch.dict(os.environ, self.environment(), clear=True):
            config = Config.from_env()
        self.assertFalse(config.billing_enabled)
        self.assertFalse(config.cloud_ai_enabled)
        self.assertFalse(config.public_signup)

    def test_paid_mode_and_public_http_are_rejected(self):
        for key, value in (("BILLING_ENABLED", "true"), ("CLOUD_PUBLIC_ORIGIN", "http://example.com"), ("SUPABASE_URL", "https://arbitrary.example.com")):
            with self.subTest(key=key), patch.dict(os.environ, {**self.environment(), key: value}, clear=True):
                with self.assertRaises(RuntimeError): Config.from_env()

    def test_effective_tls_option_rejects_duplicates_and_accepts_uri_form(self):
        require_verified_tls("postgresql://synthetic@localhost/test?sslmode=verify-full")
        for dsn in ("host=localhost sslmode=verify-full sslmode=disable", "host=localhost application_name=sslmode=verify-full", "host=localhost"):
            with self.subTest(dsn=dsn), self.assertRaises(Problem): require_verified_tls(dsn)
