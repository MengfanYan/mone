"""ASGI cloud transport. Local access codes and caller tenant IDs are never used."""
import hashlib
import json
import time
import secrets
import logging
import os
from uuid import uuid4
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response
from starlette.concurrency import run_in_threadpool

from services.api import agent, terminal
from services.api.business import BusinessAPI
from services.api.domain import Problem, require
from services.api.localization import result_for, error_message
from services.cloud.auth import SupabaseIdentity
from services.cloud.config import Config
from services.cloud.store import CloudStore, create_pool

LOG=logging.getLogger("finagent.cloud")
if not LOG.handlers: LOG.addHandler(logging.StreamHandler())
LOG.setLevel(logging.INFO)
LOG.propagate=False


class PersistentChallenges:
    def __init__(self, store): self.store=store
    def __setitem__(self, nonce, value):
        with self.store.transaction() as db:
            db.db.execute("DELETE FROM model_challenges WHERE expires_at<now()")
            db.db.execute("INSERT INTO model_challenges(nonce,content,expires_at) VALUES(%s,%s,to_timestamp(%s))",(nonce,json.dumps(value),value["expires"]))
    def pop(self, nonce, default=None):
        with self.store.transaction() as db:
            row=db.db.execute("DELETE FROM model_challenges WHERE nonce=%s RETURNING content",(nonce,)).fetchone()
            return row["content"] if row else default
    def __len__(self):
        with self.store.connect() as db: return db.db.execute("SELECT count(*) FROM model_challenges").fetchone()["count"]


class CloudBusiness(BusinessAPI):
    def __init__(self, store, actor, identity):
        self.store,self.actor,self.identity=store,actor,identity
        self.terminal_challenges=PersistentChallenges(store)
    def authorize_sensitive(self, data, session_id):
        self.identity.reauthenticate(self.actor,data.pop("access_code",None))
    def on_privacy_deleted(self, session_id):
        pass # Cloud privacy hook revokes sessions in the financial deletion transaction.


def session_check(store, actor):
    with store.transaction() as db:
        db.db.execute("INSERT INTO cloud_sessions(session_ref,user_id,expires_at) VALUES(%s,%s,to_timestamp(%s)) ON CONFLICT(tenant_id,session_ref) DO NOTHING",(actor.session_ref,actor.user_id,actor.claims["exp"]))
        row=db.db.execute("SELECT revoked,expires_at,created_at FROM cloud_sessions WHERE session_ref=%s AND user_id=%s",(actor.session_ref,actor.user_id)).fetchone()
        require(row and not row["revoked"] and row["created_at"]+timedelta(hours=12)>datetime.now(timezone.utc),"UNAUTHENTICATED","This device session expired or was revoked",401)
        fence=db.db.execute("SELECT reauth_after FROM workspaces WHERE id=%s",(store.tenant_id,)).fetchone()["reauth_after"].timestamp()
        if fence>0:
            require(any(isinstance(item,dict) and item.get("method") in {"password","oauth","otp","totp","phone","webauthn","sso/saml"} and isinstance(item.get("timestamp"),(int,float)) and item["timestamp"]>=fence for item in actor.claims.get("amr",[])),"REAUTH_REQUIRED","Sign in again after the recovery operation",401)
        # Token refresh extends the same still-valid provider session, never revives revoked sessions.
        db.db.execute("UPDATE cloud_sessions SET expires_at=to_timestamp(%s) WHERE session_ref=%s",(actor.claims["exp"],actor.session_ref))
    store.session_ref=actor.session_ref


def create_app(config=None, *, pool=None, identity=None, deletion_journal=None):
    config=config or Config.from_env()
    owned=pool is None
    pool=pool or create_pool(config.database_url)
    identity=identity or SupabaseIdentity(config)
    if deletion_journal is None:
        from .journal import from_env
        deletion_journal=from_env(config.supabase_url)
    @asynccontextmanager
    async def lifespan(app):
        yield
        if owned: pool.close()
        if hasattr(deletion_journal,"close"): deletion_journal.close()
    app=FastAPI(title="Mone cloud API",docs_url=None,redoc_url=None,openapi_url=None,lifespan=lifespan)

    @app.middleware("http")
    async def headers(request, call_next):
        started=time.monotonic();trace=str(uuid4())
        request.state.trace_id=trace
        try: response=await call_next(request)
        except Exception:
            # No DSN, provider body, prompt, token or financial fields in logs/response.
            response=JSONResponse({"error":{"code":"INTERNAL_ERROR","message":"The request could not be completed"}},status_code=500)
        response.headers["Cache-Control"]="private, no-store"
        response.headers["X-Content-Type-Options"]="nosniff"
        response.headers["Referrer-Policy"]="no-referrer"
        response.headers["X-Request-ID"]=trace
        group=request.url.path.split("/")[2:3]
        group=group[0] if group and group[0] in {"health","session","state","account","accounts","drafts","commands","imports","investments","statements","analyses","privacy","terminal","documents","migration","personal-rules","feedback","billing"} else "other"
        LOG.info(json.dumps({"event":"http.complete","trace_id":trace,"route_group":group,"method":request.method,"status":response.status_code,"elapsed_ms":round((time.monotonic()-started)*1000)}))
        return response

    @app.exception_handler(Problem)
    async def problem(request,error):
        locale="zh" if request.headers.get("accept-language","").startswith("zh") else "en"
        return JSONResponse({"error":{"code":error.code,"message":error_message(error.message,error.code,locale)},"trace_id":getattr(request.state,"trace_id",None)},status_code=error.status)

    @app.api_route("/v1/{path:path}",methods=["GET","POST","PUT","PATCH","DELETE"])
    async def dispatch(path, request:Request):
        if path=="health" and request.method=="GET":
            boot=os.environ.get("CLOUD_BOOT_TOKEN")
            return {"data":{"status":"ok","mode":"cloud","billing":False,"bank_sync":False,"trading":False,"boot_id":hashlib.sha256(boot.encode()).hexdigest() if boot else None}}
        if request.method!="GET":
            require(request.headers.get("origin")==config.public_origin,"ORIGIN_FORBIDDEN","Same-origin requests are required",403)
        require(set(request.query_params)<={"period"},"INVALID_FIELDS","Only public period scope is accepted in query parameters",400)
        auth=request.headers.get("authorization","")
        require(auth.startswith("Bearer "),"UNAUTHENTICATED","Sign in to your cloud account",401)
        actor=await run_in_threadpool(identity.verify,auth[7:])
        store=await run_in_threadpool(CloudStore,pool,actor.user_id,require_invite=not config.public_signup)
        store.deletion_journal=deletion_journal
        await run_in_threadpool(session_check,store,actor)
        needs_mfa=any(f.get("status")=="verified" for f in actor.factors) and actor.claims.get("aal")!="aal2"
        if needs_mfa:
            if path=="session" and request.method=="GET": return {"data":{"authenticated":False,"needs_mfa":True}}
            raise Problem("MFA_REQUIRED","Verify your authenticator before opening private records",403)
        raw=await request.body()
        require(len(raw)<=7_100_000,"REQUEST_LIMIT","Request body is too large",413)
        try:
            data=json.loads(raw) if raw else {}
        except (ValueError,UnicodeError): raise Problem("INVALID_JSON","A JSON object is required",400)
        require(isinstance(data,dict),"INVALID_JSON","A JSON object is required",400)
        require(not ({"tenant_id","user_id","workspace_id"}&set(data)),"INVALID_FIELDS","Identity cannot be supplied in a request body",400)
        if not config.test:
            def has_mock(value):
                return isinstance(value,dict) and (value.get("mock") is True or any(has_mock(v) for v in value.values())) or isinstance(value,list) and any(has_mock(v) for v in value)
            require(not has_mock(data),"MOCK_FORBIDDEN","Synthetic records belong in the separate Demo",400)
        return await run_in_threadpool(execute,store,actor,path,request.method,data,dict(request.query_params),request.headers.get("idempotency-key"),request.headers.get("accept-language","en"),auth[7:])

    def execute(store,actor,path,method,data,query,key,locale,token):
        business=CloudBusiness(store,actor,identity)
        if path=="session":
            if method=="GET": return {"data":{"authenticated":True,"mode":"CLOUD_PERSONAL_WORKSPACE","artifact":agent.ARTIFACT}}
            if method=="DELETE":
                with store.transaction() as db: db.db.execute("UPDATE cloud_sessions SET revoked=true WHERE session_ref=%s",(actor.session_ref,))
                return {"data":{"authenticated":False}}
            raise Problem("NOT_FOUND","Cloud login is managed by the identity provider",404)
        if path=="account" or path.startswith(("account/","personal-rules","feedback","billing")):
            from .controls import dispatch as controls_dispatch
            return {"data":controls_dispatch(store,actor,method,path,data)}
        if path=="documents" and method=="GET":
            with store.connect() as db:
                rows=db.db.execute("SELECT id,status,size_bytes,mime_type,purpose,expires_at,created_at FROM documents ORDER BY created_at DESC LIMIT 100").fetchall()
            return {"data":[{**r,"id":str(r["id"]),"created_at":r["created_at"].isoformat(),"expires_at":r["expires_at"].isoformat() if r["expires_at"] else None} for r in rows]}
        if (path=="documents" and method=="POST") or (path.startswith("documents/") and ((path.endswith("/download") and method=="GET") or method=="DELETE")):
            from .storage import PrivateStorage
            storage=PrivateStorage(config,actor,token)
            try:
                if method=="POST": return {"data":storage.intake(store,data)}
                if method=="DELETE":
                    require(set(data)=={"confirmed"} and data["confirmed"] is True,"CONFIRMATION_REQUIRED","Explicitly confirm private file removal")
                    return {"data":storage.remove(store,path.split("/")[1])}
                raw=storage.download(store,path.split("/")[1])
                return Response(raw,media_type="application/octet-stream",headers={"Content-Disposition":"attachment; filename=private-document.bin","Cache-Control":"no-store"})
            finally: storage.close()
        if path=="migration/preview" and method=="POST":
            from .migration import inspect_archive
            require(set(data)=={"archive"},"INVALID_FIELDS","Choose one local export archive")
            manifest=inspect_archive(data["archive"]);nonce=secrets.token_urlsafe(32)
            with store.transaction() as db:
                require(db.execute("SELECT count(*) FROM accounts").fetchone()[0]==0,"MIGRATION_NOT_EMPTY","Use an empty cloud workspace",409)
                content={"purpose":"migration","session":actor.session_ref,"archive":data["archive"],"source_hash":manifest["source_hash"],"version":store.version(db,"resource_version"),"expires":time.time()+120,"consumed":False}
                db.db.execute("DELETE FROM model_challenges WHERE expires_at<now()")
                db.db.execute("INSERT INTO model_challenges(nonce,content,expires_at) VALUES(%s,%s,to_timestamp(%s))",(nonce,json.dumps(content),content["expires"]))
            return {"data":{"nonce":nonce,"content_hash":manifest["source_hash"],"manifest":manifest,"expires_in":120}}
        if path=="migration/commit" and method=="POST":
            from .migration import import_archive
            require(set(data)=={"nonce","content_hash","access_code"},"INVALID_FIELDS","Review and reauthenticate this local import")
            business.authorize_sensitive(data,actor.session_ref)
            with store.connect() as db: row=db.db.execute("SELECT content FROM model_challenges WHERE nonce=%s",(data["nonce"],)).fetchone()
            require(row,"CONFIRMATION_EXPIRED","Import preview expired or is unavailable",409)
            def authorize(db):
                current=db.db.execute("SELECT content FROM model_challenges WHERE nonce=%s FOR UPDATE",(data["nonce"],)).fetchone()
                content=current["content"] if current else {}
                require(content.get("purpose")=="migration" and content.get("session")==actor.session_ref and content.get("expires",0)>time.time() and content.get("source_hash")==data["content_hash"],"CONFIRMATION_EXPIRED","Review this archive again",409)
                if not content.get("consumed"):
                    require(store.version(db,"resource_version")==content["version"],"PROPOSAL_STALE","Cloud records changed; preview again",409)
                    db.db.execute("UPDATE model_challenges SET content=jsonb_set(content,'{consumed}','true') WHERE nonce=%s",(data["nonce"],))
            return {"data":import_archive(store,row["content"]["archive"],authorize)}
        if path=="terminal/model-preview" or path=="terminal/model-explanation":
            raise Problem("CLOUD_AI_DISABLED","Cloud AI is disabled until provider consent, task budgets and release gates are configured",503)
        if path.startswith("terminal/"):
            value=terminal.dispatch(business,method,path[len("terminal/"):],data,actor.session_ref)
            if path=="terminal/settings": value={**value,"key_configured":False,"cloud_available":False,"database_encrypted":None}
        elif path in {"receipts","evidence-imports"}:
            # Synchronous local OCR is never exposed as an unbounded cloud parser.
            raise Problem("PARSER_WORKER_REQUIRED","Use private file intake; isolated OCR workers must be configured first",503)
        else:
            value,_=business.dispatch_business(method,"/v1/"+path,{k:[v] for k,v in query.items()},data,actor.session_ref,key)
        if path!="privacy/delete":
            with store.connect() as db:
                # In-flight revocation/deletion invalidates the response. Analysis
                # also rechecks its financial/consent snapshot after the last tool.
                if path=="analyses" and value.get("scope",{}).get("ledger_version") is not None:
                    require(store.settings(db,"consents")["analysis"],"CONSENT_REVOKED","Analysis consent was withdrawn",403)
                    require(store.version(db)==value["scope"]["ledger_version"] and store.version(db,"settings_version")==value["scope"]["settings_version"],"SNAPSHOT_STALE","Data or consent changed; analyze again",409)
                if path.startswith("statements/"):
                    require(store.settings(db,"consents")["analysis"],"CONSENT_REVOKED","Report access was withdrawn",403)
                if path=="notifications" and value["items"]:
                    require(store.settings(db,"consents")["analysis"],"CONSENT_REVOKED","Notification analysis consent was withdrawn",403)
                    require(store.version(db)==value["ledger_version"] and store.version(db,"settings_version")==value["settings_version"],"SNAPSHOT_STALE","Records changed; refresh notifications",409)
        return {"data":result_for("/v1/"+path,value,"zh" if locale.startswith("zh") else "en")}
    return app
