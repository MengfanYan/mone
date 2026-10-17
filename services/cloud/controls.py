"""Tenant-scoped devices, feedback, personal rules and atomic task budgets."""
from datetime import datetime, timezone
from uuid import uuid4

from services.api.domain import CURRENCIES, Problem, require, short_text


def account_status(store,actor):
    with store.connect() as db:
        sessions=db.db.execute("SELECT session_ref,created_at,expires_at,revoked FROM cloud_sessions WHERE user_id=%s ORDER BY created_at DESC LIMIT 30",(actor.user_id,)).fetchall()
        rules=db.db.execute("SELECT id,merchant,category,currency,version,active FROM personal_rules ORDER BY created_at DESC").fetchall()
    return {"mode":"CLOUD_PERSONAL_WORKSPACE","billing_enabled":False,"plan":"Free development access","price":None,"quotas":None,"bank_sync":False,"cloud_ai":False,
            "sessions":[{"id":r["session_ref"],"current":r["session_ref"]==actor.session_ref,"created_at":r["created_at"].isoformat(),"expires_at":r["expires_at"].isoformat(),"revoked":r["revoked"]} for r in sessions],
            "rules":[{**r,"id":str(r["id"])} for r in rules],"training_default":False}


def dispatch(store,actor,method,path,data):
    if path=="account" and method=="GET": return account_status(store,actor)
    if path=="account/sessions/revoke-all" and method=="POST":
        require(not data,"INVALID_FIELDS","No identity fields are accepted")
        with store.transaction() as db:
            db.db.execute("UPDATE cloud_sessions SET revoked=true WHERE user_id=%s",(actor.user_id,))
            db.db.execute("DELETE FROM model_challenges")
            db.db.execute("UPDATE jobs SET status='cancelled',updated_at=now() WHERE status IN ('queued','running')")
            store.audit(db,"session.revoke_all","self")
        return {"revoked":True,"current":True}
    if path=="account/sessions/revoke" and method=="POST":
        require(set(data)=={"session_id"} and isinstance(data["session_id"],str),"INVALID_FIELDS","Select a device session")
        with store.transaction() as db:
            row=db.db.execute("UPDATE cloud_sessions SET revoked=true WHERE session_ref=%s AND user_id=%s RETURNING session_ref",(data["session_id"],actor.user_id)).fetchone()
            require(row,"RESOURCE_NOT_FOUND","Device session not found",404)
            db.db.execute("DELETE FROM model_challenges WHERE content->>'session'=%s",(data["session_id"],))
            db.db.execute("UPDATE jobs SET status='cancelled',updated_at=now() WHERE session_ref=%s AND status IN ('queued','running')",(data["session_id"],))
            store.audit(db,"session.revoke",data["session_id"][:12])
        return {"revoked":True,"current":data["session_id"]==actor.session_ref}
    if path=="feedback" and method=="POST":
        require(set(data)<={"kind","resource_id","comment"} and isinstance(data.get("kind"),str) and data["kind"] in {"recognition","classification","explanation","other"},"INVALID_FIELDS","Choose the feedback type")
        comment=short_text(data.get("comment"),"feedback",1000)
        resource=data.get("resource_id")
        require(resource is None or isinstance(resource,str) and len(resource)<=120,"INVALID_FIELDS","Invalid source reference")
        identity=str(uuid4())
        with store.transaction() as db:
            db.db.execute("INSERT INTO feedback(id,kind,resource_id,comment,training_consent) VALUES(%s,%s,%s,%s,false)",(identity,data["kind"],resource,comment))
            store.audit(db,"feedback.create",identity)
        return {"id":identity,"training_consent":False,"status":"RECORDED_IN_YOUR_WORKSPACE"}
    if path=="personal-rules" and method=="POST":
        require(set(data)=={"merchant","category","currency","confirmed"} and data["confirmed"] is True,"CONFIRMATION_REQUIRED","Review and explicitly save this personal rule")
        merchant=short_text(data["merchant"],"merchant",120);category=short_text(data["category"],"category",40)
        require(isinstance(data["currency"],str) and data["currency"] in CURRENCIES,"CURRENCY_UNSUPPORTED","Unsupported currency")
        identity=str(uuid4())
        with store.transaction() as db:
            db.db.execute("INSERT INTO personal_rules(id,merchant,category,currency) VALUES(%s,%s,%s,%s)",(identity,merchant,category,data["currency"]))
            store.bump(db,"settings_version")
            store.audit(db,"rule.create",identity)
        return {"id":identity,"version":1,"active":True,"scope":"YOUR_FUTURE_DRAFTS_ONLY","changes_existing_ledger":False}
    if path.startswith("personal-rules/") and method=="DELETE":
        import re
        require(set(data)=={"version"} and isinstance(data["version"],int) and not isinstance(data["version"],bool) and data["version"]>0 and re.fullmatch(r"[a-f0-9-]{36}",path.split("/")[-1]),"INVALID_FIELDS","The rule ID and current version are required")
        with store.transaction() as db:
            row=db.db.execute("UPDATE personal_rules SET active=false,version=version+1 WHERE id=%s AND version=%s AND active RETURNING id",(path.split("/")[-1],data["version"])).fetchone()
            require(row,"VERSION_CONFLICT","The rule changed or is unavailable",409)
            store.bump(db,"settings_version")
            store.audit(db,"rule.revoke",str(row["id"]))
        return {"active":False,"changes_existing_ledger":False}
    if path.startswith("billing"):
        if method=="GET": return {"enabled":False,"price":None,"checkout_available":False,"message":"Pricing and quotas have not been approved. No payment is collected."}
        raise Problem("BILLING_DISABLED","Billing is disabled; no checkout or paid entitlement is available",503)
    raise Problem("NOT_FOUND","Cloud account action is unavailable",404)


def reserve(store,task_id,period,units,limit):
    require(isinstance(units,int) and not isinstance(units,bool) and units>0 and isinstance(limit,int) and limit>=0,"INVALID_BUDGET","Invalid task budget")
    with store.transaction() as db:
        old=db.db.execute("SELECT id,units,period,status FROM usage_reservations WHERE task_id=%s",(task_id,)).fetchone()
        if old:
            require(old["units"]==units and old["period"]==period,"IDEMPOTENCY_CONFLICT","Task budget changed",409)
            return {**old,"id":str(old["id"])}
        used=db.db.execute("SELECT COALESCE(sum(CASE WHEN status='settled' THEN actual_units ELSE units END),0) AS used FROM usage_reservations WHERE period=%s AND status IN ('reserved','settled','unknown')",(period,)).fetchone()["used"]
        require(used+units<=limit,"QUOTA_EXCEEDED","This period's approved task budget is exhausted",429)
        identity=str(uuid4())
        db.db.execute("INSERT INTO usage_reservations(id,task_id,period,units,status,expires_at) VALUES(%s,%s,%s,%s,'reserved',now()+interval '5 minutes')",(identity,task_id,period,units))
        return {"id":identity,"units":units,"period":period,"status":"reserved"}


def settle(store,reservation_id,actual_units,*,provider=None,request_id=None):
    with store.transaction() as db:
        row=db.db.execute("SELECT * FROM usage_reservations WHERE id=%s",(reservation_id,)).fetchone()
        require(row,"RESOURCE_NOT_FOUND","Task reservation not found",404)
        require(isinstance(actual_units,int) and not isinstance(actual_units,bool) and 0<=actual_units<=row["units"],"INVALID_BUDGET","Usage exceeds the reserved budget")
        if row["status"]=="settled":
            require(row["actual_units"]==actual_units,"IDEMPOTENCY_CONFLICT","Task usage changed",409)
            return {"status":"settled","actual_units":actual_units}
        require(row["status"] in {"reserved","unknown"},"RESERVATION_CLOSED","Task reservation is closed",409)
        db.db.execute("UPDATE usage_reservations SET status='settled',actual_units=%s WHERE id=%s",(actual_units,reservation_id))
        db.db.execute("INSERT INTO usage_events(id,reservation_id,provider,provider_request_id,units) VALUES(%s,%s,%s,%s,%s)",(str(uuid4()),reservation_id,provider,request_id,actual_units))
        return {"status":"settled","actual_units":actual_units}


def uncertain(store,reservation_id):
    # A timeout can already have incurred provider cost. Keep it reserved until reconciliation.
    with store.transaction() as db:
        db.db.execute("UPDATE usage_reservations SET status='unknown' WHERE id=%s AND status='reserved'",(reservation_id,))
