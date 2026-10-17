"""Validate the effective connection option, including URL-form DSNs."""
from psycopg.conninfo import conninfo_to_dict
from services.api.domain import Problem, require


def require_verified_tls(dsn):
    try:
        options = conninfo_to_dict(dsn)
    except Exception:
        raise Problem("CLOUD_CONFIG", "Database connection configuration is invalid", 503) from None
    require(options.get("sslmode") == "verify-full", "CLOUD_CONFIG", "Database connections require verified TLS", 503)
