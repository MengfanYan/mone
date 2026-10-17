"""PostgreSQL adapter for the existing deterministic domain, scoped per request.

SQL compatibility is restricted to application-owned statements, never model or
client SQL. Every private row is additionally protected by PostgreSQL RLS.
"""
import json
import re
import sqlite3
from decimal import Decimal
from contextlib import contextmanager
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from services.api.store import Store
from services.api.domain import Problem, canonical, require
from services.cloud.tls import require_verified_tls

COLUMNS = json.loads(Path(__file__).with_name("legacy_columns.json").read_text())


class Row(dict):
    def __getitem__(self, key):
        return list(self.values())[key] if isinstance(key, int) else super().__getitem__(key)


class Cursor:
    def __init__(self, cursor): self.cursor = cursor
    @property
    def rowcount(self): return self.cursor.rowcount
    def clean(self, row):
        if row is None: return None
        return Row((k, str(v) if isinstance(v,Decimal) else v) for k, v in row.items() if k not in {"tenant_id", "rowid"} and not (k == "account_id" and "content" in row))
    def fetchone(self): return self.clean(self.cursor.fetchone())
    def fetchall(self): return [self.clean(r) for r in self.cursor.fetchall()]
    def __iter__(self): return iter(self.fetchall())


class Connection:
    def __init__(self, store, db): self.store, self.db, self.closed = store, db, False
    def execute(self, sql, params=()):
        if sql in {"BEGIN IMMEDIATE", "VACUUM"}: return None
        if sql == "PRAGMA defer_foreign_keys=ON": sql = "SET CONSTRAINTS ALL DEFERRED"
        if sql.startswith("PRAGMA"): raise RuntimeError("Unsupported SQLite operation in cloud mode")
        match = re.match(r"INSERT INTO (\w+) VALUES", sql)
        if match and match[1] in COLUMNS:
            sql = sql.replace(f"INSERT INTO {match[1]} VALUES", f"INSERT INTO {match[1]}({','.join(COLUMNS[match[1]])}) VALUES", 1)
        if sql.startswith("INSERT OR REPLACE INTO settings"):
            sql = sql.replace("INSERT OR REPLACE", "INSERT", 1) + " ON CONFLICT(tenant_id,key) DO UPDATE SET content=excluded.content"
        sql = sql.replace("ON CONFLICT(id)", "ON CONFLICT(tenant_id,id)")
        sql = sql.replace("SET value=CAST(value AS INTEGER)+1", "SET value=(value::bigint+1)::text")
        sql = re.sub(r"json_extract\(content,'\$\.(\w+)'\)", r"(content::jsonb->>'\1')", sql)
        try:
            return Cursor(self.db.execute(sql.replace("?", "%s"), params))
        except psycopg.IntegrityError as error:
            # Domain code already translates bounded uniqueness failures.
            raise sqlite3.IntegrityError("Cloud integrity constraint rejected the operation") from error
    def executemany(self, sql, rows):
        for row in rows: self.execute(sql, row)
    def commit(self): self.db.commit()
    def rollback(self): self.db.rollback()
    def close(self):
        if not self.closed:
            self.closed = True
            self.store.pool.putconn(self.db)
    def __enter__(self): return self
    def __exit__(self, kind, value, trace):
        try:
            self.rollback() if kind else self.commit()
        finally: self.close()


def create_pool(dsn, *, test=False, max_size=5):
    if not test:
        require_verified_tls(dsn)
    def configure(db):
        role = db.execute("WITH RECURSIVE reachable AS (SELECT oid FROM pg_roles WHERE rolname=current_user UNION SELECT m.roleid FROM pg_auth_members m JOIN reachable r ON m.member=r.oid) SELECT 1 FROM pg_roles p JOIN reachable r ON r.oid=p.oid WHERE p.rolsuper OR p.rolbypassrls OR p.rolcreaterole OR p.rolcreatedb OR p.rolreplication LIMIT 1").fetchone()
        if role:
            raise RuntimeError("Runtime credentials must not reach administrative or BYPASSRLS roles")
        owned = db.execute("WITH RECURSIVE reachable AS (SELECT oid FROM pg_roles WHERE rolname=current_user UNION SELECT m.roleid FROM pg_auth_members m JOIN reachable r ON m.member=r.oid) SELECT 1 FROM pg_tables t JOIN pg_roles p ON p.rolname=t.tableowner JOIN reachable r ON r.oid=p.oid WHERE t.schemaname IN ('wallet','wallet_admission') LIMIT 1").fetchone()
        if owned: raise RuntimeError("Runtime credentials must not own cloud tables")
        db.execute("SET ROLE wallet_api") # prove role membership, then reset it
        db.execute("RESET ROLE")
        db.commit()
    pool = ConnectionPool(dsn, min_size=0, max_size=max_size, timeout=15,
                          kwargs={"row_factory":dict_row,"prepare_threshold":None}, configure=configure, open=True)
    with pool.connection() as db:
        unsafe = db.execute("SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='wallet' AND c.relkind='r' AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity) LIMIT 1").fetchone()
        if unsafe: pool.close(); raise RuntimeError("All private cloud tables require FORCE RLS")
    return pool


def set_runtime_context(db):
    # Transaction-local role AND namespace support transaction poolers without
    # relying on any previous connection's session settings.
    db.execute("SET LOCAL ROLE wallet_api")
    db.execute("SET LOCAL search_path TO wallet,pg_catalog")
    db.execute("SET LOCAL statement_timeout='15s'")
    db.execute("SET LOCAL idle_in_transaction_session_timeout='20s'")


class CloudStore(Store):
    def __init__(self, pool, user_id, *, require_invite=False):
        self.pool, self.user_id, self.tenant_id, self.session_ref = pool, str(UUID(user_id)), None, None
        self.deletion_journal=None
        with self.pool.connection() as db:
            set_runtime_context(db)
            db.execute("SELECT set_config('finagent.user_id',%s,true)", (self.user_id,))
            db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", ("identity:"+self.user_id,))
            row = db.execute("SELECT id,disabled FROM workspaces WHERE owner_id=%s", (self.user_id,)).fetchone()
            if row is None:
                if require_invite:
                    invitation=db.execute("SELECT 1 FROM wallet_admission.invites WHERE user_id=%s AND expires_at>now()",(self.user_id,)).fetchone()
                    require(invitation,"REGISTRATION_CLOSED","This closed preview requires an operator invitation",403)
                tenant_id = str(uuid4())
                db.execute("INSERT INTO workspaces(id,owner_id) VALUES(%s,%s)", (tenant_id,self.user_id))
                db.execute("INSERT INTO memberships(tenant_id,user_id,role) VALUES(%s,%s,'owner')", (tenant_id,self.user_id))
                self.tenant_id = tenant_id
            else:
                require(not row["disabled"], "ACCOUNT_DISABLED", "This workspace has been disabled", 403)
                self.tenant_id = str(row["id"])
        with self.transaction() as db:
            for key, value in {"schema_version":"2","ledger_version":"0","settings_version":"0","resource_version":"0","portfolio_version":"0","market_last_refresh":"0"}.items():
                db.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(tenant_id,key) DO NOTHING", (key,value))
            for key, value in {"planning":{},"consents":{"analysis":False,"ocr":False}}.items():
                db.execute("INSERT INTO settings(key,content) VALUES(?,?) ON CONFLICT(tenant_id,key) DO NOTHING", (key,canonical(value)))

    def connect(self):
        db = self.pool.getconn()
        try:
            set_runtime_context(db)
            db.execute("SELECT set_config('finagent.user_id',%s,true)", (self.user_id,))
            db.execute("SELECT set_config('finagent.tenant_id',%s,true)", (self.tenant_id,))
            # Same-tenant writes and confirmation versions serialize together.
            # Other tenants never share this lock; transaction-local GUCs reset.
            db.execute("SELECT pg_advisory_xact_lock(hashtextextended(%s,0))", (self.tenant_id,))
            require(db.execute("SELECT wallet.can_access(%s)", (self.tenant_id,)).fetchone()["can_access"], "WORKSPACE_FORBIDDEN", "Workspace membership is not active", 403)
            if self.session_ref:
                active=db.execute("SELECT 1 FROM cloud_sessions WHERE session_ref=%s AND user_id=%s AND NOT revoked AND created_at>now()-interval '12 hours'",(self.session_ref,self.user_id)).fetchone()
                require(active,"UNAUTHENTICATED","This device session expired or was revoked",401)
            return Connection(self,db)
        except Exception:
            db.rollback(); self.pool.putconn(db); raise

    @contextmanager
    def transaction(self):
        with self.connect() as db: yield db

    def state(self, period):
        result=super().state(period)
        result["mode"]="CLOUD_PERSONAL_WORKSPACE"
        result["capabilities"].update(cloud_model=False,ocr=False,billing=False,bank_sync=False,trading=False,training=False)
        result["limitations"]=["Cloud workspace: records are stored server-side in your private space. Hosting and recovery must pass the release checklist before real-data trials.","Account balances are not bank-reconciled; import coverage is unknown.","Currencies remain separate without exchange-rate evidence."]
        return result

    def add_draft(self, db, raw, evidence, source_key=None):
        # Commands already carry their reviewed category. Never alter financial
        # fields between a command confirmation preview and its actual commit.
        if not (source_key or "").startswith("command:") and raw.get("category") in {None,"","Other","Uncategorized"}:
            rules=db.db.execute("SELECT id,category,version FROM personal_rules WHERE lower(merchant)=lower(%s) AND currency=%s AND active ORDER BY created_at DESC LIMIT 1",(raw.get("merchant",""),raw.get("currency"))).fetchall()
            if rules:
                rule=rules[0]
                raw={**raw,"category":rule["category"]}
                evidence={**evidence,"personal_rule":{"id":str(rule["id"]),"version":rule["version"],"scope":"draft_candidate_only"}}
        return super().add_draft(db,raw,evidence,source_key)

    def privacy_extra(self, db, action, result):
        extra=("personal_rules","feedback","documents","jobs","usage_events","usage_reservations","migration_receipts")
        if action=="export":
            for table in extra:
                result["data"]["cloud_"+table]=db.db.execute(f"SELECT * FROM {table}").fetchall()
            result["storage_note"]="Private file bytes require separate authenticated downloads; they are not embedded in this JSON archive."
            return result
        # Never report complete deletion while unprocessed private objects remain.
        require(not db.db.execute("SELECT 1 FROM documents WHERE status!='deleted' LIMIT 1").fetchone(),"FILE_DELETION_REQUIRED","Remove private file objects before deleting the ledger",409)
        require(self.deletion_journal is not None,"JOURNAL_REQUIRED","Independent deletion control must be configured before cloud erasure",503)
        generation=db.db.execute("SELECT consent_epoch FROM workspaces WHERE id=%s",(self.tenant_id,)).fetchone()["consent_epoch"]+1
        self.deletion_journal.record(self.tenant_id,self.deletion_request_id,generation)
        for table in extra: db.db.execute(f"DELETE FROM {table}")
        db.db.execute("DELETE FROM model_challenges")
        db.db.execute("UPDATE cloud_sessions SET revoked=true")
        db.db.execute("UPDATE workspaces SET consent_epoch=consent_epoch+1 WHERE id=%s",(self.tenant_id,))

    def compact_after_delete(self):
        pass # PostgreSQL vacuum/backup lifecycle belongs to platform operations.

    def privacy(self, action, data, session_id):
        if action=="delete":
            import hashlib
            self.deletion_request_id=hashlib.sha256(str(data.get("nonce","")).encode()).hexdigest()
        result=super().privacy(action,data,session_id)
        if action=="delete":
            result["status"]="CLOUD_LEDGER_DATA_DELETED"
            result["remaining"]=["Downloaded files and operator backups are separate copies. This action clears your application data; it does not delete your identity-provider account or any legally retained billing records."]
        return result
