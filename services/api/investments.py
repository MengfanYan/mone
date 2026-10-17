"""Stable local investment records and evidence-backed, currency-separated history."""
import json
import uuid
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from .domain import require, Problem, canonical, digest, now, money, fmt, decimal_value, short_text, CURRENCIES

def identity(): return str(uuid.uuid4())

def observed(value):
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(result.tzinfo is not None and result <= datetime.now(timezone.utc), "INVALID_TIME", "估值时间必须带时区且不在未来。")
        return result.astimezone(timezone.utc).isoformat()
    except (ValueError, AttributeError, TypeError) as exc:
        raise Problem("INVALID_TIME", "请输入带时区的估值时间。") from exc

def normalized_entry(raw):
    require(isinstance(raw, dict) and not set(raw) - {"name", "issuer", "currency", "asset_type", "account_ref", "history_complete", "mock"}, "INVALID_FIELDS", "投资条目包含未知字段。")
    money("0", raw.get("currency"))
    require(raw.get("asset_type", "fund") in {"stock", "etf", "fund", "bond", "cash", "complex"}, "INVALID_ASSET", "资产类型无效。")
    require(isinstance(raw.get("history_complete", False), bool) and isinstance(raw.get("mock", False), bool), "INVALID_FIELDS", "完整性和MOCK必须为布尔值。")
    return {"name": short_text(raw.get("name"), "投资名称"), "issuer": short_text(raw.get("issuer") or "User provided", "发行人"),
            "currency": raw["currency"], "asset_type": raw.get("asset_type", "fund"), "account_ref": raw.get("account_ref"),
            "history_complete": raw.get("history_complete", False), "mock": raw.get("mock", False)}

def normalized_valuation(raw, currency):
    allowed = {"observed_at", "market_value", "quantity", "price", "cost_basis", "reported_gain", "daily_gain", "reported_semantics", "supersedes", "evidence", "fees_taxes_known"}
    require(isinstance(raw, dict) and not set(raw) - allowed, "INVALID_FIELDS", "估值包含未知字段。")
    result = {"observed_at": observed(raw.get("observed_at")), "supersedes": raw.get("supersedes"),
              "evidence": raw.get("evidence") or {"source": "user_valuation", "quality": "USER_PROVIDED"},
              "fees_taxes_known": raw.get("fees_taxes_known", False)}
    require(isinstance(result["fees_taxes_known"], bool), "INVALID_FIELDS", "税费完整性必须明确。")
    require(isinstance(result["evidence"], dict) and len(canonical(result["evidence"])) < 40000, "EVIDENCE_LIMIT", "来源信息超限。")
    for key in ("market_value", "cost_basis", "reported_gain", "daily_gain"):
        result[key] = None if raw.get(key) in (None, "") else fmt(money(raw[key], currency), currency)
    for key in ("market_value", "cost_basis"):
        require(result[key] is None or Decimal(result[key]) >= 0, "INVALID_COST", "市值和成本不能为负。")
    result["quantity"] = None if raw.get("quantity") in (None, "") else str(decimal_value(raw["quantity"]))
    result["price"] = None if raw.get("price") in (None, "") else str(decimal_value(raw["price"]))
    require(result["price"] is None or Decimal(result["price"]) >= 0, "INVALID_DECIMAL", "价格不能为负。")
    require(result["quantity"] is None or Decimal(result["quantity"]) >= 0, "INVALID_DECIMAL", "数量不能为负。")
    require((result["quantity"] is None) == (result["price"] is None), "VALUATION_FIELDS", "数量和价格需同时提供，或直接提供市值。")
    if result["quantity"] is not None:
        value = fmt(Decimal(result["quantity"]) * Decimal(result["price"]), currency)
        quantum=Decimal(1).scaleb(-CURRENCIES[currency])
        require(result["market_value"] is None or abs(Decimal(value)-Decimal(result["market_value"])) <= quantum, "VALUATION_MISMATCH", "数量乘价格与市值不一致。")
        result["market_value"] = value
    result["reported_semantics"] = raw.get("reported_semantics") or ("CUMULATIVE" if result["reported_gain"] is not None else None)
    require(result["reported_semantics"] in {None, "CUMULATIVE", "UNREALIZED", "DAILY"}, "PERFORMANCE_SEMANTICS", "请明确收益口径。")
    require(result["market_value"] is not None or result["reported_gain"] is not None, "VALUATION_FIELDS", "请提供市值或有明确口径的报告收益。")
    return result

def performance(entry, valuations, events, observations):
    """No interpolation. Equal-time revisions replace the displayed point only."""
    currency = entry["currency"]
    latest = {}
    for p in sorted(valuations, key=lambda p: (p["observed_at"], p["version"])): latest[p["observed_at"]] = p
    points, initial = [], None
    for p in latest.values():
        v = p["content"]
        if initial is None and v.get("cost_basis") is not None: initial = p
        applicable = [e for e in events if e["observed_at"] <= p["observed_at"]]
        gain = Decimal(v["market_value"]) - Decimal(v["cost_basis"]) if v.get("market_value") is not None and v.get("cost_basis") is not None else None
        realized = distribution = fees = taxes = Decimal(0)
        complete = bool(entry.get("history_complete") and initial and v.get("fees_taxes_known"))
        expected_basis = Decimal(initial["content"]["cost_basis"]) if initial else None
        for e in applicable:
            x = e["content"]
            if x["type"] == "sell":
                if x.get("cost_allocated") is None: complete = False
                else:
                    realized += Decimal(x["amount"]) - Decimal(x["cost_allocated"])
                    if expected_basis is not None and e["observed_at"] > initial["observed_at"]: expected_basis -= Decimal(x["cost_allocated"])
            elif x["type"] == "distribution":
                if not x.get("distribution_in_cost"):distribution += Decimal(x["amount"])
                elif expected_basis is not None and e["observed_at"] > initial["observed_at"]:expected_basis -= Decimal(x["amount"])
            elif x["type"] in {"buy", "reinvestment"} and expected_basis is not None and e["observed_at"] > initial["observed_at"]:
                expected_basis += Decimal(x.get("cost_added") or x["amount"])+(Decimal(x.get("fee") or "0") if x.get("capitalized") and not x.get("cost_added") else Decimal(0))
            elif x["type"] == "fee" and not x.get("capitalized") and not x.get("included_in_net"): fees += Decimal(x["amount"])
            elif x["type"] == "tax" and not x.get("included_in_net"): taxes += Decimal(x["amount"])
            if x["type"] in {"sell", "buy", "distribution", "reinvestment"}:
                if x.get("fee") is None or x.get("tax") is None: complete = False
                else:
                    if not x.get("capitalized") and not x.get("included_in_net"): fees += Decimal(x["fee"])
                    if not x.get("included_in_net"): taxes += Decimal(x["tax"])
        if expected_basis is not None and v.get("cost_basis") is not None and expected_basis != Decimal(v["cost_basis"]): complete = False
        total = gain + realized + distribution - fees - taxes if gain is not None else None
        points.append({"id": p["id"], "observed_at": p["observed_at"], "currency": currency, "market_value": v.get("market_value"),
                       "unrealized": fmt(gain, currency) if gain is not None else None,
                       "unrealized_percent": str((gain/Decimal(v["cost_basis"])*100).quantize(Decimal("0.0001"),rounding=ROUND_HALF_UP)) if gain is not None and Decimal(v["cost_basis"])>0 else None,
                       "net_gain": fmt(total, currency) if total is not None else None, "net_quality": "VERIFIED_HISTORY" if complete and total is not None else "KNOWN_COMPONENTS",
                       "reported_gain": v.get("reported_gain") if v.get("reported_semantics") == "CUMULATIVE" else None,
                       "reported_semantics": v.get("reported_semantics"), "evidence": v["evidence"], "version": p["version"],
                       "event_refs": [e["id"] for e in applicable], "basis_matches": expected_basis is not None and v.get("cost_basis") is not None and expected_basis == Decimal(v["cost_basis"]),
                       "components": {"realized": fmt(realized, currency), "distribution": fmt(distribution, currency), "fees": fmt(fees, currency), "taxes": fmt(taxes, currency)}})
    reported = {}
    for p in points:
        if p["reported_gain"] is not None: reported[p["observed_at"]] = {**p, "amount": p["reported_gain"], "mode": "REPORTED_GAIN"}
    for p in sorted(observations, key=lambda p:(p["observed_at"],p["version"])):
        if p["content"]["reported_semantics"] == "CUMULATIVE": reported[p["observed_at"]] = {**p, "currency": currency, "amount": p["content"]["reported_gain"], "mode": "REPORTED_GAIN", "evidence": p["content"]["evidence"]}
    return {"investment_id": entry["id"], "currency": currency, "points": points, "reported_points": sorted(reported.values(),key=lambda p:p["observed_at"]), "events": events,
            "limits": ["观察点连线，不代表期间每日实测。", "收益口径不同的点不连接；未知资料不填零。"]}

class InvestmentStore:
    def migrate_investments(self, db):
        for row in db.execute("SELECT * FROM holdings"):
            if db.execute("SELECT 1 FROM investments WHERE legacy_id=?", (row["id"],)).fetchone(): continue
            x = json.loads(row["content"])
            entry = {"id": x["id"], "name": x["name"], "issuer": x["issuer"], "asset_type": x["asset_type"], "currency": x["currency"], "mock": x.get("mock", False), "history_complete": False, "account_ref": None}
            db.execute("INSERT INTO investments VALUES (?,?,1,?,0)", (entry["id"], canonical(entry), row["id"]))
            instant=observed(x["observed_at"])
            valuation = {"market_value": fmt(Decimal(x["quantity"])*Decimal(x["price"]), x["currency"]), "cost_basis": x.get("cost_basis"), "quantity": x["quantity"], "price": x["price"], "reported_gain": None,
                         "observed_at": instant, "reported_semantics": None, "fees_taxes_known": False, "evidence": {"source": "legacy_holding", "legacy_id": x["id"], "quality": "ONE_OBSERVATION", "mock": x.get("mock", False)}}
            db.execute("INSERT INTO investment_valuations VALUES (?,?,?,?,1,NULL,?)", (identity(),entry["id"],instant,canonical(valuation),now()))

    def investment_rows(self, db, include_archived=False):
        result = []
        for row in db.execute("SELECT * FROM investments ORDER BY rowid"):
            if row["archived"] and not include_archived: continue
            item = {**json.loads(row["content"]), "id": row["id"], "version": row["version"], "archived": bool(row["archived"])}
            point = db.execute("SELECT * FROM investment_valuations WHERE investment_id=? ORDER BY observed_at DESC,version DESC LIMIT 1", (row["id"],)).fetchone()
            item["latest"] = {**json.loads(point["content"]), "id": point["id"], "version": point["version"]} if point else None
            item["history_count"] = db.execute("SELECT count(DISTINCT observed_at) FROM investment_valuations WHERE investment_id=?", (row["id"],)).fetchone()[0]
            result.append(item)
        return result

    def investment_history(self, db, investment_id):
        row = db.execute("SELECT * FROM investments WHERE id=?", (investment_id,)).fetchone()
        require(row is not None, "RESOURCE_NOT_FOUND", "投资条目不存在。", 404)
        entry = {**json.loads(row["content"]), "id":row["id"], "version":row["version"], "archived":bool(row["archived"])}
        records = {}
        for table, key in [("investment_valuations","valuations"),("investment_performance_events","events"),("reported_performance_observations","observations")]:
            records[key] = [{**dict(r), "content":json.loads(r["content"])} for r in db.execute(f"SELECT * FROM {table} WHERE investment_id=? ORDER BY observed_at,created_at", (investment_id,))]
        return entry, records

    def investment_performance(self, investment_id):
        with self.connect() as db:
            require(self.settings(db,"consents")["analysis"],"CONSENT_REVOKED","本地分析用途未授权。",403)
            entry, records = self.investment_history(db,investment_id)
            return performance(entry,**records)

    def investment_preview(self, db, resource, payload):
        require(isinstance(payload,dict) and set(payload) <= {"action","entry","valuation","event","patch","version"}, "INVALID_FIELDS","投资操作字段无效。")
        action=payload.get("action")
        require(action in {"create","valuation","performance_event","metadata","archive"},"INVALID_FIELDS","投资操作无效。")
        if action == "create":
            require(resource=="new","INVALID_RESOURCE","新投资资源无效。")
            require(db.execute("SELECT count(*) FROM investments").fetchone()[0] < 200,"INVESTMENT_LIMIT","投资条目最多200项。")
            entry=normalized_entry(payload.get("entry"))
            if entry["account_ref"]: require(entry["account_ref"] in self.account_map(db),"RESOURCE_NOT_FOUND","账户不存在。")
            valuation=normalized_valuation(payload["valuation"],entry["currency"]) if payload.get("valuation") else None
            return {"action":action,"entry":entry,"valuation":valuation}, self.version(db,"resource_version")
        entry, records=self.investment_history(db,resource)
        require(sum(len(v) for v in records.values()) < 5000 or action in {"archive","metadata"}, "HISTORY_LIMIT", "投资历史最多5000条。")
        require(payload.get("version")==entry["version"],"VERSION_MISMATCH","投资已变化，请重新打开。",412)
        require(not entry["archived"] or action=="metadata","ARCHIVED_RESOURCE","投资已归档，历史保留。")
        result={"action":action,"investment_id":resource,"version":entry["version"],"previous":entry}
        if action=="valuation":
            v=normalized_valuation(payload.get("valuation"),entry["currency"])
            table="reported_performance_observations" if v["market_value"] is None else "investment_valuations"
            prior=db.execute(f"SELECT * FROM {table} WHERE investment_id=? AND observed_at=? ORDER BY version DESC LIMIT 1",(resource,v["observed_at"])).fetchone()
            require(not prior or v.get("supersedes")==prior["id"],"OBSERVATION_CONFLICT","同一观察时间已有记录，请明确选择修订版本。",409)
            result.update(valuation=v,table=table,point_version=prior["version"]+1 if prior else 1)
        elif action=="performance_event":
            x=payload.get("event")
            require(isinstance(x,dict) and not set(x)-{"type","amount","observed_at","cost_allocated","cost_added","fee","tax","capitalized","included_in_net","distribution_in_cost","ledger_event_ref","source_key","evidence"},"INVALID_FIELDS","收益事件字段无效。")
            require(x.get("type") in {"buy","sell","distribution","fee","tax","reinvestment"},"INVALID_FIELDS","收益事件类型无效。")
            result["event"]={**x,"observed_at":observed(x.get("observed_at")),"amount":fmt(money(x.get("amount"),entry["currency"],positive=True),entry["currency"])}
            for k in ("cost_allocated","cost_added","fee","tax"):
                result["event"][k]=None if x.get(k) in (None,"") else fmt(money(x[k],entry["currency"]),entry["currency"])
                require(result["event"][k] is None or Decimal(result["event"][k])>=0,"INVALID_COST","成本及税费不能为负。")
            for k in ("capitalized","included_in_net","distribution_in_cost"):
                require(isinstance(x.get(k,False),bool),"INVALID_FIELDS","费用口径需明确。")
                result["event"][k]=x.get(k,False)
            ref=x.get("ledger_event_ref")
            if ref:
                event=next((e for e in self.events(db) if e["id"]==ref),None)
                require(event and event["currency"]==entry["currency"] and event["kind"] in {"dividend","investment_buy","investment_sell"} and not event["reverses"] and not any(e["reverses"]==ref for e in self.events(db)),"LEDGER_LINK","关联现金事件不存在或币种/类型不匹配。")
                require(event["amount"]==result["event"]["amount"],"LEDGER_LINK","现金事件金额不匹配。")
            require(isinstance(x.get("evidence",{}),dict) and len(canonical(x.get("evidence",{})))<40000,"EVIDENCE_LIMIT","来源信息超限。")
            key=x.get("source_key") or ref
            if key:require(isinstance(key,str) and len(key)<=200,"INVALID_FIELDS","来源ID无效。")
            if key: require(not db.execute("SELECT 1 FROM investment_performance_events WHERE source_key=?",(key,)).fetchone(),"DUPLICATE_SOURCE","此收益来源已录入。",409)
            result["event"]["source_key"]=key
        elif action=="metadata":
            patch=payload.get("patch",{})
            require(isinstance(patch,dict) and not set(patch)-{"name","issuer","archived"},"INVALID_FIELDS","仅可修改名称、发行人和归档状态。")
            result["patch"]=patch
            for k in ("name","issuer"):
                if k in patch: short_text(patch[k],"投资名称")
            if "archived" in patch: require(isinstance(patch["archived"],bool),"INVALID_FIELDS","归档状态无效。")
        return result,self.version(db,"resource_version")

    def investment_apply_in_transaction(self, db, preview):
        action=preview["action"]
        if action=="create":
            entry={**preview["entry"],"id":identity()}
            db.execute("INSERT INTO investments VALUES (?,?,1,NULL,0)",(entry["id"],canonical(entry)))
            if preview.get("valuation"):
                p=preview["valuation"];table="reported_performance_observations" if p["market_value"] is None else "investment_valuations"
                db.execute(f"INSERT INTO {table} VALUES (?,?,?,?,1,NULL,?)",(identity(),entry["id"],p["observed_at"],canonical(p),now()))
            resource=entry["id"]
        else:
            resource=preview["investment_id"]
            if action=="valuation":
                p=preview["valuation"]
                db.execute(f"INSERT INTO {preview['table']} VALUES (?,?,?,?,?,?,?)",(identity(),resource,p["observed_at"],canonical(p),preview["point_version"],p.get("supersedes"),now()))
            elif action=="performance_event":
                x=preview["event"]
                db.execute("INSERT INTO investment_performance_events VALUES (?,?,?,?,?,?)",(identity(),resource,x["observed_at"],canonical(x),x.get("source_key"),now()))
            elif action=="metadata":
                p=preview["patch"];entry={**preview["previous"],**p};entry.pop("version",None)
                db.execute("UPDATE investments SET content=?,archived=? WHERE id=?",(canonical(entry),int(entry.get("archived",False)),resource))
            elif action=="archive": db.execute("UPDATE investments SET archived=1 WHERE id=?",(resource,))
            db.execute("UPDATE investments SET version=version+1 WHERE id=?",(resource,))
        self.bump(db,"portfolio_version");self.bump(db,"resource_version");self.bump(db)
        self.audit(db,"investment."+action,resource)
        db.execute("INSERT INTO outbox VALUES (?,?,?,?,0,?)",(identity(),"investment.changed.v2",resource,self.version(db,"portfolio_version"),now()))
        return {"resource_type":"investment","resource_id":resource,"status":"APPLIED"}

    def investment_change(self,resource,data,session_id,idempotency_key):
        require(idempotency_key,"IDEMPOTENCY_REQUIRED","请提供幂等键。")
        with self.transaction() as db:
            operation="investment:"+resource+":"+session_id
            cached=self.retry_result(db,idempotency_key,operation,data)
            if cached is not None:return cached
            preview=self.consume(db,data,session_id,"investment_change",resource,data.get("payload"))
            result=self.investment_apply_in_transaction(db,preview)
            self.remember_result(db,idempotency_key,operation,data,result)
            return result
