"""Explicit cloud configuration; no development identity bypass in deployed mode."""
from dataclasses import dataclass
import os
import re
from urllib.parse import urlsplit


@dataclass(frozen=True)
class Config:
    database_url: str
    supabase_url: str
    supabase_key: str
    public_origin: str
    billing_enabled: bool = False
    cloud_ai_enabled: bool = False
    test: bool = False
    public_signup: bool = False

    @classmethod
    def from_env(cls):
        url = os.environ.get("SUPABASE_URL", "").rstrip("/")
        if not re.fullmatch(r"https://[a-z0-9-]+\.supabase\.co", url):
            raise RuntimeError("SUPABASE_URL must be the fixed HTTPS project URL")
        origin = os.environ.get("CLOUD_PUBLIC_ORIGIN", "").rstrip("/")
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
            # Local cloud integration uses loopback, never a public HTTP host.
            if not re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):\d{4,5}", origin):
                raise RuntimeError("CLOUD_PUBLIC_ORIGIN requires HTTPS or loopback development")
        dsn = os.environ.get("CLOUD_DATABASE_URL", "")
        if not dsn or not os.environ.get("SUPABASE_PUBLISHABLE_KEY"):
            raise RuntimeError("Cloud database and Supabase publishable key are required")
        if os.environ.get("BILLING_ENABLED", "false").lower() == "true":
            raise RuntimeError("Billing is intentionally disabled until prices and policies are approved")
        return cls(dsn,url,os.environ["SUPABASE_PUBLISHABLE_KEY"],origin,public_signup=os.environ.get("CLOUD_PUBLIC_SIGNUP","false").lower()=="true")
