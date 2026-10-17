"""Owner-only versioned migrations. Never import this module in web requests."""
import hashlib
import os
from pathlib import Path

import psycopg
from services.cloud.tls import require_verified_tls


def main():
    dsn=os.environ.get("CLOUD_MIGRATION_DATABASE_URL")
    if not dsn: raise SystemExit("Set CLOUD_MIGRATION_DATABASE_URL separately from runtime credentials")
    require_verified_tls(dsn)
    root=Path(__file__).resolve().parents[2]/"migrations/cloud"
    with psycopg.connect(dsn,autocommit=True) as db:
        db.execute("CREATE SCHEMA IF NOT EXISTS wallet_migrations")
        db.execute("REVOKE ALL ON SCHEMA wallet_migrations FROM PUBLIC")
        db.execute("CREATE TABLE IF NOT EXISTS wallet_migrations.applied(version TEXT PRIMARY KEY,sha256 TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
        db.execute("SELECT pg_advisory_lock(hashtextextended('finagent-cloud-migrations',0))")
        try:
            for path in sorted(root.glob("*.sql")):
                raw=path.read_text();digest=hashlib.sha256(raw.encode()).hexdigest()
                old=db.execute("SELECT sha256 FROM wallet_migrations.applied WHERE version=%s",(path.name,)).fetchone()
                if old:
                    if old[0]!=digest:raise RuntimeError("An applied migration changed; add a forward migration instead")
                    continue
                # Each checked-in migration contains its transaction. Receipt is
                # appended inside the same commit, preventing partial replay.
                end=raw.rfind("COMMIT;")
                if end<0:raise RuntimeError("Migration must have an explicit transaction")
                receipt="INSERT INTO wallet_migrations.applied(version,sha256) VALUES ('"+path.name+"','"+digest+"');\n"
                db.execute(raw[:end]+receipt+raw[end:],prepare=False)
                print("Applied",path.name)
        finally:db.execute("SELECT pg_advisory_unlock(hashtextextended('finagent-cloud-migrations',0))")

if __name__=="__main__":main()
