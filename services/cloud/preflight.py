"""Sanitized deployment checks. This deliberately does not self-certify release."""
import json
import os
from datetime import datetime, timezone

from services.cloud.config import Config
from services.cloud.store import create_pool

RELEASE_EVIDENCE=("identity_live","tenant_api_rls_objects","storage_encryption_keys","backup_restore_deletion_replay","privacy_retention","parser_isolation_or_disabled","incident_contacts_drill","australian_scope_review","supplier_data_processing","capacity_cost_limits")


def main():
    checks={"billing_disabled":os.environ.get("BILLING_ENABLED","false").lower()!="true","public_signup_closed":os.environ.get("CLOUD_PUBLIC_SIGNUP","false").lower()!="true","recovery_secret":len(os.environ.get("CLOUD_AUTH_FLOW_SECRET",""))>=32 and not os.environ.get("CLOUD_AUTH_FLOW_SECRET","").startswith("replace")}
    try:
        config=Config.from_env();pool=create_pool(config.database_url)
        with pool.connection() as db:
            row=db.execute("SELECT count(*) AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wallet' AND relkind='r' AND relrowsecurity AND relforcerowsecurity").fetchone()
            checks["runtime_role_and_force_rls"]=row["count"]>=30
        pool.close()
    except Exception:
        checks["runtime_role_and_force_rls"]=False
    # Documents, contracts and live provider tests cannot be manufactured by a code check.
    report={"generated_at":datetime.now(timezone.utc).isoformat(),"technical_checks":checks,"public_release_ready":False,"requires_external_evidence":list(RELEASE_EVIDENCE),"billing_enabled":False,"note":"A successful technical preflight is a staging check, not real-data or paid-release approval."}
    print(json.dumps(report,indent=2))
    return 0 if all(checks.values()) else 1

if __name__=="__main__":raise SystemExit(main())
