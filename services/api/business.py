"""Shared domain dispatch. Transports supply verified identity and reauthentication."""
from datetime import datetime
from zoneinfo import ZoneInfo
from . import agent, market
from .domain import Problem, require

class BusinessAPI:
    def authorize_sensitive(self, data, session_id):
        raise NotImplementedError

    def on_privacy_deleted(self, session_id):
        raise NotImplementedError

    def dispatch_business(self, method, path, query, data, session_id, idempotency_key=None, extracted_evidence=None):
        if path == "/v1/notifications" and method == "GET":
            require(set(query) == {"period"}, "INVALID_FIELDS", "A notification period is required")
            return self.store.notifications(query["period"][0]), None
        if path == "/v1/notifications/read" and method == "POST":
            return self.store.read_notifications(data), None
        if path == "/v1/state" and method == "GET":
            with self.store.connect() as db:
                zone = self.store.settings(db, "planning").get("timezone", "Australia/Sydney")
            period = query.get("period", [datetime.now(ZoneInfo(zone)).strftime("%Y-%m")])[0]
            return self.store.state(period), None
        if path == "/v1/commands/plan" and method == "POST":
            return self.store.command_plan(data, session_id), None
        if path == "/v1/evidence-imports" and method == "POST":
            return self.store.evidence_import(data,session_id,extracted_evidence),None
        if path == "/v1/draft-batches/confirm" and method == "POST":
            return self.store.batch_confirm(data,session_id,idempotency_key),None
        parts = path.strip("/").split("/")
        if len(parts)==3 and parts[:2]==["v1","import-batches"] and method=="GET":
            with self.store.connect() as db:
                row=db.execute("SELECT * FROM import_batches WHERE id=?",(parts[2],)).fetchone()
                require(row is not None,"RESOURCE_NOT_FOUND","导入批次不存在。",404)
                return {"batch_id":row["id"],"command":self.store.command_get_in_transaction(db,row["command_id"],session_id)},None
        if len(parts) == 3 and parts[:2] == ["v1", "commands"]:
            if method == "GET": return self.store.command_get(parts[2],session_id), None
            if method == "PATCH": return self.store.command_patch(parts[2],data,session_id), None
        if len(parts) == 4 and parts[:2] == ["v1", "commands"] and method == "POST":
            if parts[3] == "cancel": return self.store.command_cancel(parts[2],data,session_id), None
            if parts[3] == "drafts": return self.store.command_drafts(parts[2],data,session_id,idempotency_key), None
            if parts[3] == "apply": return self.store.command_apply(parts[2],data,session_id,idempotency_key), None
        if len(parts) == 4 and parts[:2] == ["v1", "transactions"] and parts[3] == "corrections" and method == "POST":
            return self.store.correct_event(parts[2],data,session_id,idempotency_key), None
        if path == "/v1/investments" and method == "POST":
            return self.store.investment_change("new",data,session_id,idempotency_key), None
        if path == "/v1/investments" and method == "GET":
            with self.store.connect() as db: return self.store.investment_rows(db,True), None
        if len(parts)==3 and parts[:2]==["v1","investments"] and method=="PATCH":
            require(data.get("payload",{}).get("action") in {"metadata","archive"},"INVALID_FIELDS","修改条目只接受名称或归档。")
            return self.store.investment_change(parts[2],data,session_id,idempotency_key),None
        if len(parts)==4 and parts[:2]==["v1","investments"]:
            if parts[3]=="history" and method=="GET":
                with self.store.connect() as db:
                    entry,records=self.store.investment_history(db,parts[2])
                    return {"entry":entry,**records},None
            if parts[3]=="performance" and method=="GET": return self.store.investment_performance(parts[2]),None
            if parts[3] in {"valuations","performance-events"} and method=="POST":
                require(data.get("payload",{}).get("action")==("valuation" if parts[3]=="valuations" else "performance_event"),"INVALID_FIELDS","投资操作与接口不匹配。")
                return self.store.investment_change(parts[2],data,session_id,idempotency_key),None
        if path == "/v1/accounts" and method == "POST":
            return self.store.create_account(data), None
        if path == "/v1/drafts" and method == "POST":
            return self.store.create_draft(data), None
        parts = path.strip("/").split("/")
        if len(parts) == 3 and parts[:2] == ["v1", "drafts"] and method == "PUT":
            return self.store.edit_draft(parts[2], data), None
        if len(parts) == 4 and parts[:2] == ["v1", "drafts"] and parts[3] == "confirm" and method == "POST":
            require({"nonce", "content_hash"} <= set(data) and set(data) <= {"nonce", "content_hash", "duplicate_resolutions"}, "INVALID_FIELDS", "确认字段无效。")
            return self.store.confirm_draft(parts[2], data, session_id, idempotency_key), None
        if len(parts) == 4 and parts[:2] == ["v1", "drafts"] and parts[3] == "reject" and method == "POST":
            require(set(data) == {"nonce", "content_hash"}, "INVALID_FIELDS", "拒绝草稿确认字段无效。")
            return self.store.reject_draft(parts[2], data, session_id), None
        if len(parts) == 4 and parts[:2] == ["v1", "transactions"] and parts[3] == "reverse" and method == "POST":
            require(set(data) == {"nonce", "content_hash"}, "INVALID_FIELDS", "冲正确认字段无效。")
            return self.store.reverse(parts[2], data, session_id, idempotency_key), None
        if path == "/v1/imports" and method == "POST":
            return self.store.import_csv(data), None
        if path == "/v1/receipts" and method == "POST":
            return self.store.receipt(data), None
        if path == "/v1/confirmation-challenges" and method == "POST":
            if data.get("purpose") in {"privacy_delete", "privacy_export"}:
                self.authorize_sensitive(data, session_id)
            return self.store.challenge(data, session_id), None
        if path in {"/v1/planning", "/v1/consents"} and method == "PUT":
            require(set(data) == {"nonce", "content_hash", "payload"}, "INVALID_FIELDS", "设置确认字段无效。")
            return self.store.save_settings(parts[1], data, session_id), None
        if path == "/v1/holdings" and method == "POST":
            raise Problem("LEGACY_CONFIRMATION_REQUIRED", "请使用有确认保护的投资条目接口。", 409)
        if len(parts) == 3 and parts[:2] == ["v1", "holdings"] and method == "DELETE":
            raise Problem("LEGACY_CONFIRMATION_REQUIRED", "请通过投资条目归档流程保留历史。", 409)
        if path == "/v1/statements" and method == "POST":
            require(set(data) == {"period"}, "INVALID_FIELDS", "报表字段无效。")
            return self.store.statement(data["period"]), None
        if len(parts) == 3 and parts[:2] == ["v1", "statements"] and method == "GET":
            return self.store.statement_get(parts[2]), None
        if path == "/v1/analyses" and method == "POST":
            require(set(data) <= {"text", "period", "currency"}, "INVALID_FIELDS", "分析包含未知字段。")
            return agent.run(self.store, data.get("text"), data.get("period"), data.get("currency")), None
        if path == "/v1/market/refresh" and method == "POST":
            require(not data, "INVALID_FIELDS", "公共来源不接受私人上下文或URL。")
            return market.refresh(self.store), None
        if path in {"/v1/privacy/export", "/v1/privacy/delete"} and method == "POST":
            require(set(data) == {"nonce", "content_hash"}, "INVALID_FIELDS", "隐私确认字段无效。")
            result = self.store.privacy(parts[2], data, session_id)
            if parts[2] == "delete":
                self.on_privacy_deleted(session_id)
                return result, "wallet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
            return result, None
        raise Problem("NOT_FOUND", "端点不存在或功能未开放。", 404)
