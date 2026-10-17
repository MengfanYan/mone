"""Offline restore fence, executed BEFORE a recovered database is exposed.

Uses a separate operator credential. The normal API never imports this module
or receives the restore DSN. Does not claim to restore object bytes or meet RTO.
"""
import os
import json
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from services.cloud.store import COLUMNS
from services.api.domain import require, canonical

EXTRA=("usage_events","usage_reservations","personal_rules","feedback","jobs","documents","subscriptions","webhook_events","model_challenges","migration_receipts","cloud_sessions")


def apply_fences(db,journal):
    require(journal is not None,"JOURNAL_CONFIG","Independent deletion control must be available before restoring",503)
    role=db.execute("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user").fetchone()
    require(role["rolsuper"] or role["rolbypassrls"],"RESTORE_ROLE","Use the isolated restore operator role, never the application role",403)
    workspaces=db.execute("SELECT id,consent_epoch FROM wallet.workspaces ORDER BY id").fetchall()
    erased=0
    # Journal reads happen before database changes; unavailable control fails closed.
    generations={str(row["id"]):journal.generation(str(row["id"])) for row in workspaces}
    with db.transaction():
        db.execute("SET CONSTRAINTS ALL DEFERRED")
        for row in workspaces:
            tenant=str(row["id"]);generation=generations[tenant]
            if generation>row["consent_epoch"]:
                for table in EXTRA+tuple(t for t in COLUMNS if t not in {"settings","meta"}):
                    db.execute(f"DELETE FROM wallet.{table} WHERE tenant_id=%s",(tenant,))
                db.execute("DELETE FROM wallet.settings WHERE tenant_id=%s AND key!='consents'",(tenant,))
                db.execute("INSERT INTO wallet.settings(tenant_id,key,content) VALUES(%s,'planning','{}') ON CONFLICT(tenant_id,key) DO UPDATE SET content='{}'",(tenant,))
                db.execute("UPDATE wallet.workspaces SET consent_epoch=%s WHERE id=%s",(generation,tenant));erased+=1
            db.execute("UPDATE wallet.workspaces SET reauth_after=now() WHERE id=%s",(tenant,))
            db.execute("UPDATE wallet.cloud_sessions SET revoked=true WHERE tenant_id=%s",(tenant,))
            db.execute("DELETE FROM wallet.challenges WHERE tenant_id=%s",(tenant,))
            db.execute("DELETE FROM wallet.model_challenges WHERE tenant_id=%s",(tenant,))
            db.execute("UPDATE wallet.jobs SET status='cancelled',updated_at=now() WHERE tenant_id=%s",(tenant,))
            db.execute("UPDATE wallet.settings SET content=%s WHERE tenant_id=%s AND key='consents'",(canonical({"analysis":False,"ocr":False}),tenant))
        return {"restored_workspaces":len(workspaces),"erasure_fences_applied":erased,"all_sessions_require_fresh_provider_authentication":True,"processing_consents_reset":True}


def main():
    require(os.environ.get("CLOUD_RESTORE_ISOLATED")=="true","RESTORE_ISOLATION","Restore only into an isolated, non-serving database")
    dsn=os.environ.get("CLOUD_RESTORE_DATABASE_URL","")
    from services.cloud.tls import require_verified_tls
    require(bool(dsn),"CLOUD_CONFIG","A separate restore credential is required")
    require_verified_tls(dsn)
    from services.cloud.journal import from_env
    journal=from_env(os.environ.get("SUPABASE_URL",""))
    with psycopg.connect(dsn,row_factory=dict_row) as db:
        print(json.dumps(apply_fences(db,journal),indent=2))

if __name__=="__main__":main()
