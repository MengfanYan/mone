from . import duplicates
"""Confirmed local commands share one transaction with the existing ledger."""
import json
import re
import time
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from . import commands
from .domain import require, Problem, canonical, now, validate_event, postings, money, fmt, digest
from .investments import InvestmentStore, identity

NEW_TABLES = ("command_plans", "import_batches", "investment_performance_events", "reported_performance_observations", "investment_valuations", "investments", "account_overrides")

def stable_items(plan):
    for key in ("budgets", "goals"):
        for item in plan.get(key, []):
            item.setdefault("id", str(uuid.uuid5(uuid.NAMESPACE_URL, f"wallet/{key}/{plan.get('currency')}/{item.get('category', item.get('name'))}")))
            item.setdefault("version", 1)
            require(isinstance(item["id"], str) and 0 < len(item["id"]) <= 120 and isinstance(item["version"], int) and not isinstance(item["version"], bool) and item["version"] > 0, "INVALID_FIELDS", "规划ID或版本无效。")
        require(len({x["id"] for x in plan.get(key,[])}) == len(plan.get(key,[])), "INVALID_FIELDS", "规划条目ID不能重复。")
    return plan

class ExperienceStore(InvestmentStore):
    def migrate_experience(self):
        mapping = {
            "演示 · 银行": "Demo · Bank",
            "演示·银行": "Demo · Bank",
            "演示 · 贷款": "Demo · Loan",
            "演示·贷款": "Demo · Loan",
            "合成工资": "Synthetic salary",
            "合成生活支出": "Synthetic living costs",
            "合成债务利息": "Synthetic loan interest",
            "合成本金还款": "Synthetic principal repayment",
            "期初余额": "Opening balance",
            "工资": "Salary",
            "生活": "Living",
            "利息": "Interest",
            "本金": "Principal",
        }
        with self.transaction() as db:
            self.migrate_investments(db)
            plan=stable_items(self.settings(db,"planning"))
            db.execute("UPDATE settings SET content=? WHERE key='planning'",(canonical(plan),))
            db.execute("DROP TRIGGER IF EXISTS immutable_event")
            db.execute("DROP TRIGGER IF EXISTS immutable_posting")
            try:
                for k, v in mapping.items():
                    db.execute("UPDATE accounts SET name=? WHERE name=?", (v, k))
                    db.execute("UPDATE account_overrides SET name=? WHERE name=?", (v, k))
                    db.execute("UPDATE postings SET account_ref=? WHERE account_ref=?", (f"expense:{v}", f"expense:{k}"))
                    db.execute("UPDATE postings SET account_ref=? WHERE account_ref=?", (f"income:{v}", f"income:{k}"))
                for table in ("drafts", "events"):
                    for row_id, raw in db.execute(f"SELECT id, content FROM {table}").fetchall():
                        data = json.loads(raw)
                        changed = False
                        for field in ("merchant", "category"):
                            if data.get(field) in mapping:
                                data[field] = mapping[data[field]]
                                changed = True
                        if changed:
                            db.execute(f"UPDATE {table} SET content=? WHERE id=?", (canonical(data), row_id))
            finally:
                db.execute("CREATE TRIGGER IF NOT EXISTS immutable_event BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT, 'events are immutable'); END")
                db.execute("CREATE TRIGGER IF NOT EXISTS immutable_posting BEFORE UPDATE ON postings BEGIN SELECT RAISE(ABORT, 'postings are immutable'); END")

    def command_get_in_transaction(self,db,resource,session):
        row=db.execute("SELECT * FROM command_plans WHERE id=? AND session_ref=?",(resource,session)).fetchone()
        require(row is not None,"RESOURCE_NOT_FOUND","此会话的任务不存在。",404)
        require(row["expires_at"]>time.time(),"COMMAND_EXPIRED","任务已过期，请重新输入。",409)
        return {**json.loads(row["content"]),"command_id":row["id"],"version":row["version"],"status":row["status"]}

    def command_get(self,resource,session):
        with self.connect() as db:return self.command_get_in_transaction(db,resource,session)

    def target_rows(self,db,obj):
        if obj=="record":
            drafts=[{**dict(r),"resource_type":"draft","content":json.loads(r["content"])} for r in db.execute("SELECT * FROM drafts WHERE status='DRAFT'")]
            events=self.events(db); reversed_ids={e["reverses"] for e in events if e["reverses"]}
            return drafts+[{"id":e["id"],"version":1,"resource_type":"transaction","content":e} for e in events if not e["reverses"] and e["id"] not in reversed_ids and e["kind"]!="opening"]
        if obj in {"budget","goal"}:return [{**x,"resource_type":obj} for x in stable_items(self.settings(db,"planning")).get("budgets" if obj=="budget" else "goals",[])]
        if obj=="account":return [{**x,"resource_type":"account"} for x in self.account_map(db).values()]
        return [{**x,"resource_type":"investment"} for x in self.investment_rows(db,True)]

    def command_plan(self,data,session):
        require(isinstance(data,dict) and not set(data)-{"text","account_id","currency","period","recent_resource_ids"},"INVALID_FIELDS","任务包含未知字段。")
        with self.transaction() as db:
            zone=self.settings(db,"planning").get("timezone","Australia/Sydney")
            plan=commands.parse(data.get("text"),list(self.account_map(db).values()),account_id=data.get("account_id"),currency=data.get("currency"),zone=zone)
            plan.update(input_text=data["text"],mode="LOCAL_USER_COMMAND",period=data.get("period"),warnings=[],results=[])
            if plan["intent"] in {"query","update","delete"}:
                targets=commands.matching(data["text"],self.target_rows(db,plan["object"]),plan.get("date"))
                recent=data.get("recent_resource_ids",[])
                require(isinstance(recent,list) and len(recent)<=20,"INVALID_FIELDS","最近记录范围无效。")
                if recent and re.search(r"刚才|最近|last|recent|just",data["text"],re.I):
                    recent_targets=[r for r in self.target_rows(db,plan["object"]) if r["id"] in recent]
                    targets=[r for r in targets if r["id"] in recent] or commands.matching(data["text"],recent_targets,plan.get("date")) or recent_targets
                if plan["intent"]=="query":
                    if not targets and re.search(r"全部|本月|list|this month",data["text"],re.I):targets=self.target_rows(db,plan["object"])
                    if data.get("account_id") and plan["object"]=="record":targets=[r for r in targets if r["content"].get("account_id")==data["account_id"]]
                    period=data.get("period")
                    if period and plan["object"]=="record" and re.search(r"本月|this month",data["text"],re.I):targets=[r for r in targets if r.get("content",{}).get("date","").startswith(period)]
                    plan["query_total"]=len(targets)
                    plan["results"]=[{"resource_type":r["resource_type"],"resource_id":r["id"],"resource_version":r.get("version",1),"fields":r.get("content",r)} for r in targets[:100]]
                    plan["status"]="APPLIED"
                    plan["query_summary"]=[]
                    if self.settings(db,"consents")["analysis"] and plan["object"]=="record":
                        from decimal import Decimal
                        grouped={}
                        for r in targets:
                            if r["resource_type"]!="transaction":continue
                            x=r["content"];g=grouped.setdefault(x["currency"],{"income":Decimal(0),"expenses":Decimal(0),"count":0});g["count"]+=1
                            if x["kind"] in {"income","dividend"}:g["income"]+=Decimal(x["amount"])
                            elif x["kind"] in {"expense","interest","refund"}:g["expenses"]+=Decimal(x["amount"])*(-1 if x["kind"]=="refund" else 1)
                        plan["query_summary"]=[{"currency":c,"income":fmt(v["income"],c),"expenses":fmt(v["expenses"],c),"count":v["count"]} for c,v in grouped.items()]
                else:
                    chosen=targets[0] if len(targets)==1 else None
                    op={"op_id":"o1","kind":plan["intent"]+"_"+plan["object"],"targets":[{"id":r["id"],"resource_type":r["resource_type"],"label":r.get("content",r).get("merchant",r.get("name",r.get("category",r["id"]))) } for r in targets],"resource_id":chosen["id"] if chosen else None,"resource_type":chosen["resource_type"] if chosen else plan["object"],"fields":{},"selected":True,"source_span":data["text"]}
                    if chosen:
                        op=self.bind_target(db,op,chosen,plan.get("amount"))
                        renamed=re.search(r"(?:改名为|rename.+?\bto\b)\s*([^，。\n]+)$",data["text"],re.I)
                        if renamed and op["resource_type"] in {"account","investment","goal"}:op["fields"]["name"]=renamed[1].strip()
                    else:op["fields"]={"amount":plan.get("amount")}
                    if plan["object"]=="investment" and op["fields"].get("amount") is not None:op["fields"]["observed_at"]=now()
                    plan["operations"]=[op]
            elif plan["object"] in {"budget","goal","account","investment"}:
                text=data["text"]
                name=re.sub(r"\b(create|add|budget|goal|account|investment)\b|新增|添加|预算|目标|账户|投资|\d+(?:\.\d+)?|AUD|CNY|USD", "",text,flags=re.I).strip() or "Local item"
                approved=self.account_map(db).get(data.get("account_id"))
                fields={"name":name,"amount":plan.get("amount"),"currency":plan.get("currency") or data.get("currency") or (approved["currency"] if approved else None),"category":name}
                if plan["object"]=="investment" and plan.get("amount") is not None:fields["observed_at"]=now()
                plan["operations"]=[{"op_id":"o1","kind":"create_"+plan["object"],"fields":fields,"selected":True,"source_span":text}]
            plan=self.review_plan(db,plan)
            resource=identity();self.bump(db,"resource_version")
            plan["base_versions"]={"ledger":self.version(db),"settings":self.version(db,"settings_version")}
            db.execute("DELETE FROM command_plans WHERE expires_at<?",(time.time(),))
            require(db.execute("SELECT count(*) FROM command_plans WHERE session_ref=?",(session,)).fetchone()[0]<100,"COMMAND_LIMIT","当前会话最多100项任务。")
            db.execute("INSERT INTO command_plans VALUES (?,?,?,1,?,?,?)",(resource,session,canonical(plan),plan["status"],time.time()+43200,now()))
            return self.command_get_in_transaction(db,resource,session)

    def bind_target(self,db,op,target,amount=None):
        values=target.get("content",target)
        fields={k:v for k,v in values.items() if k in commands.EVENT_FIELDS} if target["resource_type"] in {"draft","transaction"} else {k:v for k,v in values.items() if k in {"name","category","amount","target","saved","deadline","currency","type","opened_on","observed_at"}}
        if amount is not None:fields["target" if target["resource_type"]=="goal" else "amount"]=amount
        return {**op,"resource_id":target["id"],"resource_type":target["resource_type"],"resource_version":target.get("version",1),"fields":fields,"previous":values}

    def review_plan(self,db,plan):
        questions=[]
        for op in plan["operations"]:
            errors=[] if op.get("selected",True) else list(op.get("errors",[]))
            if op.get("selected",True):
                fields=op.get("fields",{})
                if op["kind"]=="create_draft" or (op["kind"]=="update_record" and op.get("resource_id")):
                    missing=[k for k in ("amount","currency","date","merchant","account_id","kind") if not fields.get(k) or fields.get(k)=="needs_classification"]
                    errors.extend(missing)
                    if fields.get("kind") in {"transfer","card_payment","loan_received","debt_principal"} and not fields.get("counterparty_id"):errors.append("counterparty_id")
                    if not missing:
                        try:validate_event(fields,self.account_map(db))
                        except Problem as exc:errors.append(exc.code)
                elif op["kind"].startswith(("update_","delete_")) and not op.get("resource_id"):errors.append("target")
                elif op["kind"] in {"create_budget","create_goal"}:
                    if not fields.get("amount") and not fields.get("target"):errors.append("amount")
                elif op["kind"] in {"create_investment","create_account"} and not fields.get("currency"):errors.append("currency")
                elif op["kind"]=="investment_observation":
                    errors.extend(k for k in ("name","currency","observed_at") if not fields.get(k))
                    if not fields.get("market_value") and not fields.get("reported_gain"):errors.append("market_value/reported_gain")
                    if not op.get("resource_id"):errors.append("investment")
                if op.get("evidence",{}).get("requires_ocr"):
                    if not self.settings(db,"consents")["ocr"]:errors.append("CONSENT_REVOKED")
                    if op.get("source_key"):
                        prior=db.execute("SELECT id,status FROM drafts WHERE source_key=?",(op["source_key"],)).fetchone()
                        if prior and prior["status"]!="DRAFT":errors.append("DUPLICATE_SOURCE")
            op["errors"]=errors
            if errors and op.get("selected",True):questions.append({"op_id":op["op_id"],"fields":errors})
        plan["questions"]=questions
        if plan.get("intent")!="query":plan["status"]="NEEDS_CLARIFICATION" if questions or not any(o.get("selected",True) for o in plan["operations"]) else "READY"
        return plan

    def command_patch(self,resource,data,session):
        require(set(data)=={"version","operations"} and isinstance(data["operations"],list),"INVALID_FIELDS","任务修改需版本和操作。")
        with self.transaction() as db:
            plan=self.command_get_in_transaction(db,resource,session)
            require(plan["version"]==data["version"] and plan["status"] not in {"APPLIED","DRAFT_CREATED","CANCELLED"},"PROPOSAL_STALE","任务已变化或已提交。",409)
            for change in data["operations"]:
                require(isinstance(change,dict) and not set(change)-{"op_id","fields","selected","resource_id"},"INVALID_FIELDS","候选字段无效。")
                op=next((x for x in plan["operations"] if x["op_id"]==change.get("op_id")),None)
                require(op is not None,"RESOURCE_NOT_FOUND","候选不存在。")
                if "resource_id" in change:
                    if op["kind"]=="investment_observation" and change["resource_id"]=="new":
                        op.update(resource_id="new",resource_version=0)
                        target=None
                    else:
                        target=next((x for x in self.target_rows(db,plan["object"]) if x["id"]==change["resource_id"]),None)
                        require(target is not None and any(x["id"]==target["id"] for x in op.get("targets",[])),"TARGET_INVALID","请选择本次匹配的条目。")
                        if op["kind"]=="investment_observation":op.update(resource_id=target["id"],resource_version=target["version"])
                        else:op.update(self.bind_target(db,op,target,plan.get("amount")))
                if "selected" in change:require(isinstance(change["selected"],bool),"INVALID_FIELDS","选择状态无效。");op["selected"]=change["selected"]
                if "fields" in change:
                    allowed=commands.EVENT_FIELDS if op["kind"]=="create_draft" or op["kind"].endswith("record") else {"name","category","amount","target","saved","deadline","currency","type","opened_on","observed_at"}
                    if op["kind"] in {"update_account","delete_account"}:allowed={"name"}
                    if op["kind"].endswith("investment"):allowed={"name","currency","amount","observed_at","market_value","cost_basis","reported_gain","daily_gain","reported_semantics","quantity","price","supersedes","fees_taxes_known"}
                    if op["kind"]=="investment_observation":allowed={"name","currency","observed_at","market_value","cost_basis","reported_gain","daily_gain","reported_semantics","quantity","price","supersedes"}
                    require(isinstance(change["fields"],dict) and not set(change["fields"])-allowed,"INVALID_FIELDS","候选包含未知字段。")
                    op["fields"].update(change["fields"])
            plan=self.review_plan(db,plan);self.bump(db,"resource_version")
            db.execute("UPDATE command_plans SET content=?,version=version+1,status=? WHERE id=?",(canonical(plan),plan["status"],resource))
            return self.command_get_in_transaction(db,resource,session)

    def command_cancel(self,resource,data,session):
        require(isinstance(data,dict) and set(data)=={"version"},"INVALID_FIELDS","取消需提供任务版本。")
        with self.transaction() as db:
            plan=self.command_get_in_transaction(db,resource,session)
            require(plan["version"]==data["version"] and plan["status"] not in {"APPLIED","CANCELLED"},"PROPOSAL_STALE","任务已变化或已完成。",409)
            db.execute("UPDATE command_plans SET status='CANCELLED',version=version+1 WHERE id=?",(resource,))
            self.bump(db,"resource_version");self.audit(db,"command.cancel",resource)
            return self.command_get_in_transaction(db,resource,session)

    def command_drafts(self,resource,data,session,key):
        require(key,"IDEMPOTENCY_REQUIRED","请提供幂等键。")
        with self.transaction() as db:
            operation="command-drafts:"+resource+":"+session
            cached=self.retry_result(db,key,operation,data)
            if cached is not None:return cached
            plan=self.command_get_in_transaction(db,resource,session)
            require(plan["version"]==data.get("version") and plan["status"]=="READY","PROPOSAL_STALE","请先补齐并保存候选字段。",409)
            selected=[o for o in plan["operations"] if o.get("selected",True)]
            require(selected and all(o["kind"]=="create_draft" for o in selected),"COMMAND_DRAFTS","只有新增交易可以保存为草稿。")
            results=[]
            for op in selected:
                evidence={"source":"local_command","command_id":resource,"source_span":op["source_span"],"quality":"USER_REVIEW_REQUIRED","date_basis":op.get("date_basis")}
                if op.get("evidence"):evidence=op["evidence"]
                item=self.add_draft(db,op["fields"],evidence,op.get("source_key") or "command:"+resource+":"+op["op_id"])
                results.append({"op_id":op["op_id"],"resource_type":"draft","resource_id":item["id"],"resource_version":1})
                op["draft_id"]=item["id"]
            plan["results"]=results
            db.execute("UPDATE command_plans SET content=?,status='DRAFT_CREATED',version=version+1 WHERE id=?",(canonical(plan),resource))
            self.bump(db,"resource_version")
            result={"command_id":resource,"status":"DRAFT_CREATED","results":results}
            self.remember_result(db,key,operation,data,result)
            return result

    def correction_preview(self,db,resource,payload):
        original,version=self.preview(db,"reverse_event",resource,None)
        require(original["original"]["kind"] in {"expense","income","interest","dividend","investment_buy","investment_sell"},"CORRECTION_DEPENDENCY","关联交易请使用专门处理流程。")
        require(isinstance(payload,dict) and set(payload)=={"content"},"INVALID_FIELDS","更正需提供新内容。")
        replacement=validate_event(payload["content"],self.account_map(db))
        zone=self.settings(db,"planning").get("timezone","Australia/Sydney")
        require(replacement["date"]<=datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d"),"FUTURE_DATE","未来记录不能确认。")
        replacement["mock"]=replacement["mock"] or original["original"].get("mock",False) or bool(self.account_map(db)[replacement["account_id"]]["mock"])
        return {"original":original["original"],"replacement":replacement,"event_id":resource,"effect":"原子冲正并替代；原记录保留"},version

    def reverse_in_transaction(self,db,resource):
        preview,_=self.preview(db,"reverse_event",resource,None)
        original=preview["original"]
        rows=[(r[0],str(-money(r[1],original["currency"]))) for r in db.execute("SELECT account_ref,signed_amount FROM postings WHERE event_id=?",(resource,))]
        content={**original,"direction":"-1","evidence":{"source":"user_reversal","original_event":resource}}
        return self.write_event(db,content,rows,reverses=resource)

    def correction_in_transaction(self,db,resource,payload):
        preview,_=self.correction_preview(db,resource,payload)
        reversed_id=self.reverse_in_transaction(db,resource)
        replacement={**preview["replacement"],"direction":"1","evidence":{"source":"user_correction","original_event":resource}}
        new_id=self.write_event(db,replacement,postings(replacement),"correction:"+resource)
        return {"resource_type":"transaction","resource_id":new_id,"resource_version":1,"reverses":resource,"reversal_id":reversed_id}

    def command_preview(self,db,resource,payload):
        row=db.execute("SELECT * FROM command_plans WHERE id=?",(resource,)).fetchone()
        require(row is not None and row["expires_at"]>time.time(),"RESOURCE_NOT_FOUND","任务不存在或已过期。")
        require(row["status"] in {"READY","DRAFT_CREATED"},"COMMAND_NOT_READY","请补齐、选择并保存候选。")
        plan=json.loads(row["content"])
        selected=[o for o in plan["operations"] if o.get("selected",True)]
        require(selected and len(selected)<=20,"COMMAND_LIMIT","请选择1至20个操作。")
        previews=[]
        for op in selected:
            kind=op["kind"];target=op.get("resource_id");fields=op.get("fields",{})
            if op.get("evidence",{}).get("requires_ocr"):require(self.settings(db,"consents")["ocr"],"CONSENT_REVOKED","识别授权已撤回。",403)
            value={"op_id":op["op_id"],"kind":kind,"resource_id":target,"fields":fields}
            if kind=="create_draft":
                if op.get("draft_id"):
                    original=db.execute("SELECT * FROM drafts WHERE id=? AND status='DRAFT'",(op["draft_id"],)).fetchone()
                    require(original is not None,"RESOURCE_NOT_FOUND","草稿已确认或被移除。",409)
                    value.update(draft_id=original["id"],draft_version=original["version"],fields=json.loads(original["content"]))
                if op.get("source_key"):
                    duplicate=db.execute("SELECT status FROM drafts WHERE source_key=?",(op["source_key"],)).fetchone()
                    require(not duplicate or duplicate["status"]=="DRAFT", "DUPLICATE_SOURCE", "此凭证来源已确认或已拒绝。",409)
                value["fields"]=validate_event(value["fields"],self.account_map(db))
                zone=self.settings(db,"planning").get("timezone","Australia/Sydney")
                require(value["fields"]["date"]<=datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d"),"FUTURE_DATE","未来记录只能保留草稿。")
            elif kind in {"update_record","delete_record"}:
                if op["resource_type"]=="draft":
                    r=db.execute("SELECT * FROM drafts WHERE id=? AND status='DRAFT'",(target,)).fetchone()
                    require(r is not None and r["version"]==op["resource_version"],"PROPOSAL_STALE","草稿已变化。",409)
                    value.update(resource_type="draft",previous=json.loads(r["content"]),resource_version=r["version"])
                    if kind=="update_record":
                        value["fields"]=validate_event(fields,self.account_map(db))
                        value["fields"]["mock"] = value["fields"].get("mock",False) or value["previous"].get("mock",False) or bool(self.account_map(db)[value["fields"]["account_id"]]["mock"])
                else:
                    before,_=self.preview(db,"reverse_event",target,None)
                    value.update(resource_type="transaction",previous=before["original"])
                    if kind=="update_record":value["correction"]=self.correction_preview(db,target,{"content":fields})[0]
            elif kind in {"create_budget","update_budget","delete_budget","create_goal","update_goal","delete_goal"}:
                plan_settings=stable_items(self.settings(db,"planning"))
                if not plan_settings.get("currency"):plan_settings["currency"]=fields.get("currency")
                require(not fields.get("currency") or fields["currency"]==plan_settings.get("currency"),"CURRENCY_MISMATCH","预算和目标使用规划币种。")
                obj="budgets" if kind.endswith("budget") else "goals"
                previous=next((x for x in plan_settings.get(obj,[]) if x["id"]==target),None)
                if not kind.startswith("create"):
                    require(previous and previous["version"]==op["resource_version"],"PROPOSAL_STALE","预算或目标已变化。",409)
                merged={**(previous or {}),**fields}
                merged["id"]=target or str(uuid.uuid5(uuid.NAMESPACE_URL,resource+"/"+op["op_id"]));merged["version"]=(previous or {}).get("version",0)+1
                if obj=="goals":
                    merged={k:v for k,v in merged.items() if k in {"id","version","name","target","saved","deadline"}}
                    merged.setdefault("target",fields.get("amount"));merged.setdefault("saved","0")
                    require(merged.get("deadline"),"INVALID_GOAL","请填写目标期限。")
                else:merged={k:v for k,v in merged.items() if k in {"id","version","category","amount"}}
                current=[x for x in plan_settings.get(obj,[]) if x["id"]!=target]
                if not kind.startswith("delete"):current.append(merged)
                plan_settings[obj]=current
                value.update(planning=self.validate_planning(plan_settings),previous=previous)
            elif kind=="create_account":
                zone=self.settings(db,"planning").get("timezone","Australia/Sydney")
                value["account_create"]=self.account_candidate(db,{"name":fields["name"],"currency":fields["currency"],"type":fields.get("type","cash"),"opening_balance":fields.get("amount") or "0","opened_on":fields.get("opened_on") or datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d")})
            elif kind in {"update_account","delete_account"}:
                account=self.account_map(db).get(target)
                require(account and account.get("version",1)==op["resource_version"],"PROPOSAL_STALE","账户已变化。",409)
                value.update(previous=account,name=fields.get("name",account["name"]))
                require(isinstance(value["name"],str) and 0<len(value["name"])<=60,"INVALID_FIELD","请填写账户名称。")
            elif kind=="investment_observation":
                valuation={k:v for k,v in fields.items() if k in {"observed_at","market_value","cost_basis","reported_gain","daily_gain","reported_semantics","quantity","price","supersedes"}}
                valuation["evidence"]=op["evidence"]
                if target=="new":investment_payload={"action":"create","entry":{"name":fields["name"],"currency":fields["currency"],"asset_type":"fund","mock":bool(op["evidence"].get("mock"))},"valuation":valuation}
                else:
                    entry,_=self.investment_history(db,target)
                    require(fields["currency"]==entry["currency"],"CURRENCY_MISMATCH","投资币种不一致。")
                    investment_payload={"action":"valuation","version":op["resource_version"],"valuation":valuation}
                value["investment_change"]=self.investment_preview(db,target,investment_payload)[0]
            elif kind in {"create_investment","update_investment","delete_investment"}:
                if kind=="create_investment":
                    investment_payload={"action":"create","entry":{"name":fields["name"],"currency":fields["currency"]}}
                    if any(fields.get(k) not in (None,"") for k in ("amount","market_value","reported_gain","quantity")):
                        investment_payload["valuation"]={k:v for k,v in fields.items() if k in {"observed_at","market_value","cost_basis","reported_gain","daily_gain","reported_semantics","quantity","price","supersedes","fees_taxes_known"}}
                        investment_payload["valuation"].setdefault("market_value",fields.get("amount"))
                elif kind=="delete_investment":investment_payload={"action":"archive","version":op["resource_version"]}
                elif any(fields.get(k) not in (None,"") for k in ("amount","market_value","reported_gain","quantity")):
                    valuation={k:v for k,v in fields.items() if k in {"observed_at","market_value","cost_basis","reported_gain","daily_gain","reported_semantics","quantity","price","supersedes","fees_taxes_known"}}
                    valuation.setdefault("market_value",fields.get("amount"))
                    investment_payload={"action":"valuation","version":op["resource_version"],"valuation":valuation}
                else:investment_payload={"action":"metadata","version":op["resource_version"],"patch":{"name":fields["name"]}}
                value["investment_change"]=self.investment_preview(db,target or "new",investment_payload)[0]
            else:raise Problem("COMMAND_UNSUPPORTED","此任务请使用相应编辑器补齐。")
            previews.append(value)
        return {"command_id":resource,"plan_version":row["version"],"operations":previews,"scope":"selected_local_records","ledger_version":self.version(db),"settings_version":self.version(db,"settings_version"),"portfolio_version":self.version(db,"portfolio_version")},self.version(db,"resource_version")

    def command_apply(self,resource,data,session,key):
        require(key,"IDEMPOTENCY_REQUIRED","请提供幂等键。")
        require(isinstance(data,dict) and {"nonce","content_hash","plan_version"}<=set(data) and set(data)<={"nonce","content_hash","plan_version","duplicate_resolutions"},"INVALID_FIELDS","提交字段无效。")
        with self.transaction() as db:
            operation="command-apply:"+resource+":"+session
            cached=self.retry_result(db,key,operation,data)
            if cached is not None:return cached
            plan=self.command_get_in_transaction(db,resource,session)
            require(data.get("plan_version")==plan["version"],"PROPOSAL_STALE","任务版本已变化。",409)
            preview=self.consume(db,data,session,"command_apply",resource)
            results=[]
            for item in preview["operations"]:
                kind=item["kind"];target=item.get("resource_id")
                if kind=="create_draft":
                    draft=item.get("draft_id")
                    if not draft:
                        op=next(x for x in plan["operations"] if x["op_id"]==item["op_id"])
                        evidence=op.get("evidence") or {"source":"local_command","source_span":op["source_span"],"quality":"USER_CONFIRMED","command_id":resource}
                        draft=self.add_draft(db,item["fields"],evidence,op.get("source_key") or "command:"+resource+":"+item["op_id"])["id"]
                    event=self.confirm_draft_in_transaction(db,draft,duplicates.resolution(data,item["op_id"]))
                    result={"resource_type":"transaction","resource_id":event,"resource_version":1}
                elif kind=="update_record" and item["resource_type"]=="transaction":result=self.correction_in_transaction(db,target,{"content":item["fields"]})
                elif kind=="delete_record" and item["resource_type"]=="transaction":result={"resource_type":"transaction","resource_id":self.reverse_in_transaction(db,target),"reverses":target}
                elif kind in {"update_record","delete_record"}:
                    if kind=="update_record":
                        previous=db.execute("SELECT evidence FROM drafts WHERE id=?",(target,)).fetchone()
                        evidence=json.loads(previous[0]);evidence.setdefault("corrections",[]).append({"at":now(),"command_id":resource})
                        db.execute("UPDATE drafts SET content=?,evidence=?,version=version+1 WHERE id=?",(canonical(item["fields"]),canonical(evidence),target))
                    else:db.execute("UPDATE drafts SET status='REJECTED',version=version+1 WHERE id=?",(target,))
                    self.bump(db,"resource_version");self.audit(db,"draft."+kind,target)
                    result={"resource_type":"draft","resource_id":target,"resource_version":item["resource_version"]+1}
                elif "planning" in item:
                    db.execute("UPDATE settings SET content=? WHERE key='planning'",(canonical(item["planning"]),))
                    self.bump(db,"settings_version");self.audit(db,"planning.command",target or resource)
                    result={"resource_type":"budget" if kind.endswith("budget") else "goal","resource_id":target or str(uuid.uuid5(uuid.NAMESPACE_URL,resource+"/"+item["op_id"]))}
                elif "account_create" in item:result={"resource_type":"account","resource_id":self.create_account_in_transaction(db,item["account_create"])["id"]}
                elif "investment_change" in item:result=self.investment_apply_in_transaction(db,item["investment_change"])
                elif kind in {"update_account","delete_account"}:
                    archived=kind=="delete_account" or item["previous"].get("archived",False)
                    db.execute("INSERT INTO account_overrides VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,archived=excluded.archived,version=excluded.version",(target,item["name"],int(archived),item["previous"].get("version",1)+1))
                    self.bump(db,"resource_version");self.audit(db,"account.metadata",target)
                    result={"resource_type":"account","resource_id":target}
                results.append({**result,"op_id":item["op_id"],"status":"APPLIED"})
            plan["results"]=results
            db.execute("UPDATE command_plans SET content=?,status='APPLIED',version=version+1 WHERE id=?",(canonical(plan),resource))
            self.bump(db,"resource_version")
            result={"command_id":resource,"status":"APPLIED","results":results}
            self.remember_result(db,key,operation,data,result)
            return result

    def evidence_import(self,data,session,extracted_evidence=None):
        from .evidence import extract,parse
        require(isinstance(data,dict) and not set(data)-{"text","image_base64","doc_type","account_id","currency","period"},"INVALID_FIELDS","凭证字段无效。")
        with self.connect() as db:require(self.settings(db,"consents")["ocr"],"CONSENT_REQUIRED","请先授权本地凭证识别。",403)
        evidence=extracted_evidence if extracted_evidence is not None else extract(data)
        with self.connect() as db:
            account=self.account_map(db).get(data.get("account_id"))
            ops=parse(evidence,data.get("doc_type"),account,data.get("currency"),self.settings(db,"planning").get("timezone","Australia/Sydney"))
        plan=self.command_plan({"text":"Evidence preview","period":data.get("period")},session)
        with self.transaction() as db:
            require(self.settings(db,"consents")["ocr"],"CONSENT_REVOKED","识别授权已撤回。",403)
            plan.update(operations=ops,intent="import_evidence",object="investment" if data["doc_type"]=="investment" else "record",evidence=evidence)
            for op in ops:
                if op["kind"]=="investment_observation":
                    targets=[x for x in self.investment_rows(db) if x["name"]==op["fields"].get("name")]
                    op["targets"]=[{"id":x["id"],"label":x["name"],"resource_type":"investment"} for x in targets]+[{"id":"new","label":"New local investment","resource_type":"investment"}]
                    if len(targets)==1:op.update(resource_id=targets[0]["id"],resource_version=targets[0]["version"])
                else:
                    prior=db.execute("SELECT id,status FROM drafts WHERE source_key=?",(op.get("source_key"),)).fetchone()
                    if prior and prior["status"]=="DRAFT":op["draft_id"]=prior["id"]
            plan=self.review_plan(db,plan)
            for op in plan["operations"]:
                if op["errors"]:op["selected"]=False
            plan=self.review_plan(db,plan)
            batch=identity();plan["batch_id"]=batch
            db.execute("INSERT INTO import_batches VALUES (?,?,?,?)",(batch,plan["command_id"],canonical({"doc_type":data["doc_type"],"sha256":evidence["sha256"],"evidence":evidence}),now()))
            db.execute("UPDATE command_plans SET content=?,status=?,version=version+1 WHERE id=?",(canonical(plan),plan["status"],plan["command_id"]))
            self.bump(db,"resource_version")
            return self.command_get_in_transaction(db,plan["command_id"],session)

    def batch_preview(self,db,payload):
        require(isinstance(payload,dict) and set(payload)=={"drafts"} and isinstance(payload["drafts"],list) and 0<len(payload["drafts"])<=20,"BATCH_SELECTION","请选择1至20条草稿。")
        require(all(isinstance(x,dict) and set(x)=={"id","version"} for x in payload["drafts"]),"INVALID_FIELDS","批次条目需ID和版本。")
        require(len({x.get("id") for x in payload["drafts"]})==len(payload["drafts"]),"BATCH_SELECTION","批次不能重复选择同一条草稿。")
        result=[]
        for item in payload["drafts"]:
            row=db.execute("SELECT * FROM drafts WHERE id=? AND status='DRAFT'",(item.get("id"),)).fetchone()
            require(row and row["version"]==item.get("version"),"PROPOSAL_STALE","选中草稿已变化。",409)
            result.append({"id":row["id"],"version":row["version"],"content":json.loads(row["content"]),"requires_ocr":json.loads(row["evidence"]).get("requires_ocr",False)})
        return {"drafts":result,"ledger_version":self.version(db)},self.version(db,"resource_version")

    def batch_confirm(self,data,session,key):
        require(key,"IDEMPOTENCY_REQUIRED","请提供幂等键。")
        with self.transaction() as db:
            operation="batch:"+session
            cached=self.retry_result(db,key,operation,data)
            if cached is not None:return cached
            preview=self.consume(db,data,session,"confirm_draft_batch","batch",data.get("payload"))
            results=[{"resource_type":"transaction","resource_id":self.confirm_draft_in_transaction(db,x["id"],duplicates.resolution(data,x["id"]))} for x in preview["drafts"]]
            result={"status":"APPLIED","results":results}
            self.remember_result(db,key,operation,data,result)
            return result

    def correct_event(self,resource,data,session,key):
        require(key,"IDEMPOTENCY_REQUIRED","请提供幂等键。")
        with self.transaction() as db:
            operation="correct:"+resource+":"+session
            cached=self.retry_result(db,key,operation,data)
            if cached is not None:return cached
            self.consume(db,data,session,"correct_event",resource,data.get("payload"))
            result=self.correction_in_transaction(db,resource,data["payload"])
            self.remember_result(db,key,operation,data,result)
            return result
