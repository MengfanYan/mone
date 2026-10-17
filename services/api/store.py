"""Single-operator SQLite store. BEGIN IMMEDIATE serializes confirmation races."""
import base64
import csv
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import sqlite3
import struct
import subprocess
import tempfile
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, ROUND_CEILING
from pathlib import Path
from zoneinfo import ZoneInfo

from . import duplicates
from .notifications import NotificationStore
from .experience import ExperienceStore, NEW_TABLES, stable_items
from .domain import (CALC_VERSION, CURRENCIES, Problem, calculate, canonical,
                     decimal_value, digest, fmt, money, money_flow, now, portfolio_analysis,
                     postings, require, short_text, valid_date, valid_month, validate_event)

ROOT = Path(__file__).resolve().parents[2]
OCR_SLOT = threading.BoundedSemaphore(1)


class Connection(sqlite3.Connection):
    def __exit__(self, *args):
        try:
            return super().__exit__(*args)
        finally:
            self.close()


def uid():
    return str(uuid.uuid4())


class Store(NotificationStore, ExperienceStore):
    def __init__(self, path):
        self.path = str(path)
        Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Establish private permissions before SQLite writes any financial data.
        # Refuse symlinks rather than changing permissions on an unrelated target.
        flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags, 0o600)
        try:
            os.fchmod(fd, 0o600)
        finally:
            os.close(fd)
        with self.connect() as db:
            db.executescript((ROOT / "migrations/001_local.sql").read_text())
            db.executescript((ROOT / "migrations/002_commands_investment_history.sql").read_text())
            db.execute("PRAGMA journal_mode=DELETE")
            db.execute("PRAGMA secure_delete=ON")
        self.migrate_experience()

    def connect(self):
        db = sqlite3.connect(self.path, timeout=15, factory=Connection)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA secure_delete=ON")
        return db

    def retry_result(self, db, key, operation, data):
        if not key:
            return None
        require(isinstance(key, str) and re.fullmatch(r"[a-zA-Z0-9_-]{8,100}", key), "IDEMPOTENCY_KEY", "幂等键无效。")
        row = db.execute("SELECT * FROM idempotency WHERE key=?", (key,)).fetchone()
        if not row:
            return None
        require(row["operation"] == operation and row["request_hash"] == digest(data), "IDEMPOTENCY_CONFLICT", "相同幂等键不能用于不同内容。", 409)
        return json.loads(row["response"])

    def remember_result(self, db, key, operation, data, result):
        if key:
            db.execute("INSERT INTO idempotency VALUES (?,?,?,?,?)", (key, operation, digest(data), canonical(result), now()))

    @contextmanager
    def transaction(self):
        db = self.connect()
        try:
            db.execute("BEGIN IMMEDIATE")
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def version(self, db, key="ledger_version"):
        return int(db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()[0])

    def bump(self, db, key="ledger_version"):
        version = self.version(db, key) + 1
        db.execute("UPDATE meta SET value=? WHERE key=?", (str(version), key))
        if key in {"ledger_version", "settings_version"}:
            db.execute("UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='resource_version'")
        return version

    def settings(self, db, key):
        return json.loads(db.execute("SELECT content FROM settings WHERE key=?", (key,)).fetchone()[0])

    def audit(self, db, action, resource):
        last = db.execute("SELECT hash FROM audit ORDER BY id DESC LIMIT 1").fetchone()
        previous = last[0] if last else "0" * 64
        at = now()
        row_hash = digest([action, resource, at, previous])
        db.execute("INSERT INTO audit(action,resource_id,at,previous_hash,hash) VALUES (?,?,?,?,?)",
                   (action, resource, at, previous, row_hash))

    def account_map(self, db):
        overrides={r["id"]:dict(r) for r in db.execute("SELECT * FROM account_overrides")}
        return {r["id"]: {**dict(r), "version":1, "archived":False, **overrides.get(r["id"],{})} for r in db.execute("SELECT * FROM accounts ORDER BY rowid")}

    def events(self, db):
        result = []
        for row in db.execute("SELECT * FROM events ORDER BY created_at, id"):
            item = {**json.loads(row["content"]), "id": row["id"], "reverses": row["reverses"], "created_at": row["created_at"]}
            item["postings"] = [(p[0], p[1]) for p in db.execute("SELECT account_ref,signed_amount FROM postings WHERE event_id=?", (row["id"],))]
            result.append(item)
        return result

    def write_event(self, db, content, rows, source_key=None, reverses=None):
        require(sum((Decimal(v) for _, v in rows), Decimal(0)) == 0, "UNBALANCED_LEDGER", "分录不平衡。", 500)
        event_id = uid()
        db.execute("INSERT INTO events VALUES (?,?,?,?,?)", (event_id, canonical(content), source_key, reverses, now()))
        db.executemany("INSERT INTO postings(event_id,account_ref,currency,signed_amount) VALUES (?,?,?,?)",
                       [(event_id, account, content["currency"], value) for account, value in rows])
        version = self.bump(db)
        db.execute("INSERT INTO outbox VALUES (?,?,?,?,0,?)", (uid(), "transaction.confirmed.v1", event_id, version, now()))
        self.audit(db, "ledger.confirm", event_id)
        return event_id

    def account_candidate(self, db, data):
        require(set(data) <= {"name", "type", "currency", "opening_balance", "opened_on", "mock"}, "INVALID_FIELDS", "账户包含未知字段。")
        name = short_text(data.get("name"), "账户名称", 60)
        currency = data.get("currency")
        balance = money(data.get("opening_balance", "0"), currency)
        kind = data.get("type", "cash")
        require(kind in {"cash", "liability"}, "INVALID_ACCOUNT_TYPE", "不支持的账户类型。")
        require(balance >= 0, "INVALID_BALANCE", "请输入现金余额或负债欠款的非负金额。")
        opened = valid_date(data.get("opened_on"))
        require(opened <= datetime.now(ZoneInfo(self.settings(db,"planning").get("timezone","Australia/Sydney"))).strftime("%Y-%m-%d"), "FUTURE_DATE", "期初余额观察日不能在未来。")
        require(isinstance(data.get("mock", False), bool), "INVALID_FIELD", "mock必须是布尔值。")
        return {"name":name,"currency":currency,"type":kind,"opening_balance":fmt(balance,currency),"opened_on":opened,"mock":data.get("mock",False)}

    def create_account_in_transaction(self, db, data):
        value=self.account_candidate(db,data)
        name,currency,kind,opened,balance=value["name"],value["currency"],value["type"],value["opened_on"],money(value["opening_balance"],value["currency"])
        account_id=uid()
        require(len(self.account_map(db))<100,"RESOURCE_LIMIT","最多100个账户。")
        db.execute("INSERT INTO accounts VALUES (?,?,?,?,?,?)",(account_id,name,kind,currency,opened,int(value["mock"])))
        if balance:
            signed=balance if kind=="cash" else -balance
            content={"kind":"opening","currency":currency,"amount":fmt(balance,currency),"date":opened,"merchant":"Opening balance","category":"Opening balance","account_id":account_id,"mock":value["mock"],"direction":"1"}
            self.write_event(db,content,[(account_id,str(signed)),("equity:opening",str(-signed))])
        else:self.bump(db)
        self.audit(db,"account.create",account_id)
        return {"id":account_id}

    def create_account(self, data):
        with self.transaction() as db:return self.create_account_in_transaction(db,data)

    def add_draft(self, db, raw, evidence, source_key=None):
        if source_key:
            previous = db.execute("SELECT id FROM drafts WHERE source_key=?", (source_key,)).fetchone()
            if previous:
                return {"id": previous[0], "duplicate": True}
        content = validate_event(raw, self.account_map(db))
        if content["kind"] == "refund" and content["refund_of"]:
            original = db.execute("SELECT content FROM events WHERE id=? AND reverses IS NULL", (content["refund_of"],)).fetchone()
            require(original is not None, "REFUND_LINK_REQUIRED", "原消费不存在。")
            content["category"] = json.loads(original[0])["category"]
        account = self.account_map(db)[content["account_id"]]
        content["mock"] = content["mock"] or bool(account["mock"])
        draft_id = uid()
        db.execute("INSERT INTO drafts(id,content,evidence,source_key,created_at) VALUES (?,?,?,?,?)",
                   (draft_id, canonical(content), canonical(evidence), source_key, now()))
        self.audit(db, "draft.create", draft_id)
        self.bump(db, "resource_version")
        return {"id": draft_id, "duplicate": False}

    def create_draft(self, raw):
        with self.transaction() as db:
            return self.add_draft(db, raw, {"source": "manual", "quality": "USER_PROVIDED", "observed_at": now()})

    def edit_draft(self, draft_id, data):
        require(set(data) == {"version", "content"}, "INVALID_FIELDS", "修改需包含version和content。")
        with self.transaction() as db:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (draft_id,)).fetchone()
            require(row is not None, "RESOURCE_NOT_FOUND", "草稿不存在。", 404)
            require(row["status"] == "DRAFT" and row["version"] == data["version"], "VERSION_MISMATCH", "草稿已变更，请刷新。", 412)
            content = validate_event(data["content"], self.account_map(db))
            content["mock"] = content["mock"] or json.loads(row["content"])["mock"] or bool(self.account_map(db)[content["account_id"]]["mock"])
            evidence = json.loads(row["evidence"])
            evidence.setdefault("corrections", []).append({"version": row["version"], "previous_hash": digest(json.loads(row["content"])), "at": now()})
            db.execute("UPDATE drafts SET content=?, evidence=?,version=version+1 WHERE id=?", (canonical(content), canonical(evidence), draft_id))
            self.audit(db, "draft.edit", draft_id)
            self.bump(db, "resource_version")
        return {"id": draft_id, "version": data["version"] + 1}

    def import_csv(self, data):
        require(set(data) <= {"csv", "account_id", "mock"}, "INVALID_FIELDS", "导入包含未知字段。")
        text = data.get("csv")
        require(isinstance(text, str) and len(text.encode()) <= 1024 * 1024, "FILE_LIMIT", "CSV限1MiB。")
        try:
            reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")), strict=True)
            require(reader.fieldnames is not None and {"date", "amount", "currency", "merchant"} <= set(reader.fieldnames), "CSV_HEADERS", "CSV必须含date,amount,currency,merchant列。")
            allowed = {"date", "amount", "currency", "merchant", "category", "kind", "account_id", "counterparty_id", "refund_of", "external_id"}
            require(len(reader.fieldnames) == len(set(reader.fieldnames)) and set(reader.fieldnames) <= allowed, "CSV_HEADERS", "CSV含重复或未知列。")
            rows = list(reader)
            require(0 < len(rows) <= 500, "ROW_LIMIT", "单次导入1–500行。")
        except csv.Error as exc:
            raise Problem("INVALID_CSV", "CSV格式无效。") from exc
        result = []
        # Validation and every insert share one transaction: malformed CSV never partially imports.
        with self.transaction() as db:
            for number, row in enumerate(rows, 2):
                require(None not in row and all(v is not None for v in row.values()), "CSV_ROW", f"第{number}行列数不匹配。")
                raw = {k: v.strip() for k, v in row.items() if v.strip()}
                raw.setdefault("account_id", data.get("account_id"))
                raw["mock"] = data.get("mock", False)
                normalized = validate_event(raw, self.account_map(db))
                # Stable external identifiers dedup across files; without one, identical rows are only candidates.
                key = digest(["csv", normalized["account_id"], normalized["external_id"]]) if normalized["external_id"] else digest(["csv-file", digest(text), normalized["account_id"], number])
                if key:
                    previous = db.execute("SELECT content FROM drafts WHERE source_key=?", (key,)).fetchone()
                    if previous:
                        old = json.loads(previous[0])
                        normalized["mock"] = normalized["mock"] or bool(self.account_map(db)[normalized["account_id"]]["mock"])
                        require(old == normalized, "SOURCE_CONFLICT", f"第{number}行来源ID已存在但内容不同；请手工更正。", 409)
                result.append(self.add_draft(db, normalized, {"source": "csv", "row": number, "payload_hash": digest(row), "quality": "USER_PROVIDED"}, key))
        return {"drafts": result, "duplicates": sum(x["duplicate"] for x in result), "mock": data.get("mock", False)}

    def receipt(self, data):
        require(set(data) <= {"text", "image_base64", "account_id", "currency", "date", "merchant", "amount"}, "INVALID_FIELDS", "凭证包含未知字段。")
        with self.connect() as db:
            require(self.settings(db, "consents")["ocr"], "CONSENT_REQUIRED", "请先开启本地凭证识别用途授权。", 403)
        text = data.get("text", "")
        require(isinstance(text, str) and len(text) <= 20000, "TEXT_LIMIT", "文本最多20000字。")
        boxes = []
        source = "receipt_text"
        if data.get("image_base64"):
            require(shutil.which("tesseract") is not None, "OCR_UNAVAILABLE", "未安装Tesseract；可以粘贴凭证文本。", 503)
            encoded = data["image_base64"]
            require(isinstance(encoded, str) and len(encoded) <= 7_000_000, "FILE_LIMIT", "图片限5MiB。")
            try:
                image = base64.b64decode(encoded, validate=True)
            except (ValueError, TypeError) as exc:
                raise Problem("INVALID_IMAGE", "图片编码无效。") from exc
            require(len(image) <= 5 * 1024 * 1024, "FILE_LIMIT", "图片限5MiB。")
            width = height = 0
            if image.startswith(b"\x89PNG\r\n\x1a\n") and len(image) >= 24:
                width, height = struct.unpack(">II", image[16:24])
                suffix = ".png"
            elif image.startswith(b"\xff\xd8"):
                suffix = ".jpg"
                stream = io.BytesIO(image[2:])
                while stream.tell() < len(image) - 2:
                    marker = stream.read(2)
                    if len(marker) < 2 or marker[0] != 255:
                        break
                    length_bytes = stream.read(2)
                    if len(length_bytes) != 2:
                        break
                    length = struct.unpack(">H", length_bytes)[0]
                    if marker[1] in {0xC0, 0xC1, 0xC2}:
                        body = stream.read(5)
                        if len(body) == 5:
                            height, width = struct.unpack(">HH", body[1:])
                        break
                    if length < 2:
                        break
                    stream.seek(length - 2, 1)
            else:
                raise Problem("FILE_TYPE", "只接受PNG/JPEG；PDF暂未开放。")
            require(0 < width * height <= 25_000_000 and max(width, height) <= 12000, "PIXEL_LIMIT", "图片尺寸无效或超限。")
            with tempfile.TemporaryDirectory(prefix="financial-ocr-") as directory:
                path = Path(directory) / ("receipt" + suffix)
                path.write_bytes(image)
                require(OCR_SLOT.acquire(blocking=False), "OCR_BUSY", "本地OCR正在处理另一张图片，请稍后重试。", 503)
                try:
                    completed = subprocess.run([shutil.which("tesseract"), str(path), "stdout", "-l", "eng", "tsv"],
                                               capture_output=True, timeout=25, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
                except subprocess.TimeoutExpired as exc:
                    raise Problem("OCR_TIMEOUT", "识别超时；请缩小图片或输入文本。", 503) from exc
                finally:
                    OCR_SLOT.release()
                require(completed.returncode == 0, "OCR_FAILED", "图片无法识别；请使用文本。")
                lines = {}
                for row in csv.DictReader(io.StringIO(completed.stdout.decode("utf-8", errors="replace")), delimiter="\t"):
                    if row.get("text", "").strip():
                        boxes.append({"text": row["text"], "page": row["page_num"], "x": row["left"], "y": row["top"], "width": row["width"], "height": row["height"], "raw_score": row["conf"]})
                        key = (row["page_num"], row["block_num"], row["par_num"], row["line_num"])
                        lines.setdefault(key, []).append(row["text"])
                text = "\n".join(" ".join(words) for words in lines.values())
            source = "tesseract-eng-local"
        require(bool(text.strip()), "RECEIPT_EMPTY", "请输入凭证文本或上传图片。")
        amount_match = re.search(r"(?:total|合计|总计|实付)\s*[:：]?\s*(?:AUD|CNY|USD|\$|¥)?\s*(\d+(?:\.\d+)?)", text, re.I)
        date_match = re.search(r"\b\d{4}-\d{2}-\d{2}\b", text)
        currency_match = re.search(r"\b(AUD|CNY|USD|EUR|GBP|JPY|KWD|NZD)\b", text)
        fields = {"amount": data.get("amount") or (amount_match[1] if amount_match else None),
                  "date": data.get("date") or (date_match[0] if date_match else None),
                  "currency": data.get("currency") or (currency_match[0] if currency_match else None),
                  "merchant": data.get("merchant") or text.splitlines()[0][:80]}
        evidence = {"source": source, "text": text, "boxes": boxes, "quality": "UNVALIDATED", "observed_at": now(),
                    "field_locations": {key: [box for box in boxes if fields.get(key) and fields[key] in box["text"]] for key in ("amount", "date", "currency")},
                    "limitations": ["未校准OCR；所有字段需人工复核。", "图片临时处理后删除；不上传云端。"]}
        missing = [k for k in ("amount", "date", "currency") if not fields[k]]
        if missing:
            return {"fields": fields, "missing": missing, "evidence": evidence, "draft_id": None}
        with self.transaction() as db:
            require(self.settings(db, "consents")["ocr"], "CONSENT_REVOKED", "识别用途已撤回。", 403)
            result = self.add_draft(db, {**fields, "kind": "expense", "category": "Uncategorized", "account_id": data.get("account_id")}, evidence)
        return {"fields": fields, "missing": [], "evidence": evidence, "draft_id": result["id"]}

    def preview(self, db, purpose, resource, payload):
        if purpose == "confirm_draft_batch":
            require(resource=="batch","INVALID_RESOURCE","批次资源无效。")
            return self.batch_preview(db,payload)
        if purpose == "command_apply": return self.command_preview(db,resource,payload)
        if purpose == "correct_event": return self.correction_preview(db,resource,payload)
        if purpose == "investment_change": return self.investment_preview(db,resource,payload)
        if purpose in {"confirm_draft", "reject_draft"}:
            row = db.execute("SELECT * FROM drafts WHERE id=?", (resource,)).fetchone()
            require(row is not None and row["status"] == "DRAFT", "RESOURCE_NOT_FOUND", "待确认草稿不存在。", 404)
            return json.loads(row["content"]), row["version"]
        if purpose == "reverse_event":
            row = db.execute("SELECT * FROM events WHERE id=?", (resource,)).fetchone()
            require(row is not None and not row["reverses"], "RESOURCE_NOT_FOUND", "原交易不存在。", 404)
            require(not db.execute("SELECT 1 FROM events WHERE reverses=?", (resource,)).fetchone(), "ALREADY_REVERSED", "交易已冲正。", 409)
            content = json.loads(row["content"])
            require(not db.execute("SELECT 1 FROM investment_performance_events WHERE json_extract(content,'$.ledger_event_ref')=?",(resource,)).fetchone(), "INVESTMENT_DEPENDENCY", "此现金事件已关联投资收益历史；请保留来源或先处理关联历史。",409)
            require(content["kind"] != "opening", "OPENING_IMMUTABLE", "期初余额不能在此冲正。")
            require(not db.execute("SELECT 1 FROM events WHERE reverses IS NULL AND json_extract(content,'$.refund_of')=? AND id NOT IN (SELECT reverses FROM events WHERE reverses IS NOT NULL)", (resource,)).fetchone(), "REFUND_DEPENDENCY", "原交易存在退款；请先冲正退款。", 409)
            return {"event_id": resource, "original": content, "effect": "追加反向分录；保留原交易"}, self.version(db)
        if purpose == "planning":
            require(resource == "planning", "INVALID_RESOURCE", "规划资源无效。")
            result=self.validate_planning(payload)
            old=self.settings(db,"planning")
            for collection in ("budgets","goals"):
                previous={x.get("id"):x for x in old.get(collection,[])}
                for item in result[collection]:
                    if item["id"] in previous:
                        prior=previous[item["id"]]
                        changed={k:v for k,v in prior.items() if k!="version"}!={k:v for k,v in item.items() if k!="version"}
                        item["version"]=prior.get("version",1)+int(changed)
            return result, self.version(db, "settings_version")
        if purpose == "consents":
            require(resource == "consents" and isinstance(payload, dict) and set(payload) == {"analysis", "ocr"} and all(isinstance(x, bool) for x in payload.values()), "INVALID_CONSENT", "仅支持本地分析/凭证识别两种用途。")
            return payload, self.version(db, "settings_version")
        if purpose in {"privacy_delete", "privacy_export"}:
            require(resource == "all", "INVALID_RESOURCE", "本地隐私操作范围为此工作台全部数据。")
            return {"scope": "all", "ledger_version": self.version(db), "settings_version": self.version(db, "settings_version"),
                    "resource_version": self.version(db, "resource_version"),
                    "counts": {table: db.execute("SELECT count(*) FROM " + table).fetchone()[0] for table in ("accounts", "drafts", "events", "statements", "investments", "investment_valuations", "command_plans", "import_batches")},
                    "limitations": "备份/已下载文件需自行清理；本地库不提供法定保留或托管生命周期。"}, self.version(db, "resource_version")
        raise Problem("PURPOSE_FORBIDDEN", "此操作不在确认白名单中。", 403)

    def reject_draft(self, draft_id, data, session_id):
        with self.transaction() as db:
            self.consume(db, data, session_id, "reject_draft", draft_id)
            db.execute("UPDATE drafts SET status='REJECTED',version=version+1 WHERE id=?", (draft_id,))
            self.audit(db, "draft.reject", draft_id)
            self.bump(db, "resource_version")
        return {"id": draft_id, "status": "REJECTED"}

    def validate_planning(self, payload):
        allowed = {"currency", "monthly_income", "essential_spend", "debt_payment", "earmarked", "budgets", "goals", "life_status", "timezone"}
        require(isinstance(payload, dict) and set(payload) <= allowed, "INVALID_FIELDS", "规划包含未知字段。")
        currency = payload.get("currency", "AUD")
        require(currency in CURRENCIES, "INVALID_CURRENCY", "币种不支持。")
        result = {"currency": currency}
        for key in ("monthly_income", "essential_spend", "debt_payment", "earmarked"):
            value = payload.get(key)
            result[key] = None if value in (None, "") else fmt(money(value, currency), currency)
            require(result[key] is None or Decimal(result[key]) >= 0, "INVALID_AMOUNT", "规划金额必须非负。")
        budgets = payload.get("budgets", [])
        goals = payload.get("goals", [])
        require(isinstance(budgets, list) and len(budgets) <= 30 and isinstance(goals, list) and len(goals) <= 30, "RESOURCE_LIMIT", "预算/目标最多30项。")
        result["budgets"] = []
        for b in budgets:
            require(isinstance(b, dict) and set(b) <= {"category", "amount", "id", "version"} and {"category", "amount"} <= set(b), "INVALID_BUDGET", "预算字段无效。")
            result["budgets"].append({**{k:b[k] for k in ("id","version") if k in b}, "category": short_text(b["category"], "预算类别", 40), "amount": fmt(money(b["amount"], currency, positive=True), currency)})
        require(len({b["category"] for b in result["budgets"]}) == len(budgets), "DUPLICATE_BUDGET", "类别预算不可重复。")
        result["goals"] = []
        for g in goals:
            require(isinstance(g, dict) and set(g) <= {"name", "target", "saved", "deadline", "id", "version"} and {"name", "target", "saved", "deadline"} <= set(g), "INVALID_GOAL", "目标字段无效。")
            target, saved = money(g["target"], currency, positive=True), money(g["saved"], currency)
            require(saved >= 0, "INVALID_AMOUNT", "已存金额不能为负。")
            result["goals"].append({**{k:g[k] for k in ("id","version") if k in g}, "name": short_text(g["name"], "目标名", 60), "target": fmt(target, currency), "saved": fmt(saved, currency), "deadline": valid_date(g["deadline"])})
        statuses = payload.get("life_status", [])
        require(isinstance(statuses, list) and len(statuses) <= 5 and all(x in {"student", "employed", "unemployed", "planning_family", "parent"} for x in statuses), "INVALID_PROFILE", "生活状态无效。")
        result["life_status"] = list(dict.fromkeys(statuses))
        zone = payload.get("timezone", "Australia/Sydney")
        try:
            ZoneInfo(zone)
        except (ValueError, KeyError, TypeError) as exc:
            raise Problem("INVALID_TIMEZONE", "时区无效。") from exc
        result["timezone"] = zone
        return stable_items(result)

    def challenge(self, data, session_id):
        require(set(data) <= {"purpose", "resource_id", "payload"}, "INVALID_FIELDS", "确认请求包含未知字段。")
        with self.transaction() as db:
            if data.get("purpose")=="command_apply": self.command_get_in_transaction(db,data.get("resource_id"),session_id)
            content, version = self.preview(db, data.get("purpose"), data.get("resource_id"), data.get("payload"))
            content=duplicates.decorate(content,data.get("purpose"),data.get("resource_id"),self.events(db),self.version(db))
            nonce = secrets.token_urlsafe(32)
            expires = time.time() + 300
            db.execute("INSERT INTO challenges VALUES (?,?,?,?,?,?,?,?,0)", (nonce, data["purpose"], data["resource_id"], digest(content), version, self.version(db, "settings_version"), session_id, expires))
            # Bound stale challenge storage without exposing credentials in audit.
            db.execute("DELETE FROM challenges WHERE expires_at<?", (time.time() - 3600,))
        return {"nonce": nonce, "content_hash": digest(content), "version": version, "preview": content, "purpose": data["purpose"], "resource_id": data["resource_id"], "expires_at": datetime.fromtimestamp(expires, timezone.utc).isoformat()}

    def consume(self, db, data, session_id, purpose, resource, payload=None):
        row = db.execute("SELECT * FROM challenges WHERE nonce=?", (data.get("nonce"),)).fetchone()
        require(row is not None and row["session_id"] == session_id and row["purpose"] == purpose and row["resource_id"] == resource,
                "CONFIRMATION_INVALID", "确认凭据无效。", 403)
        require(not row["consumed"] and row["expires_at"] > time.time(), "CONFIRMATION_EXPIRED", "确认已使用或过期。", 409)
        content, version = self.preview(db, purpose, resource, payload)
        content=duplicates.decorate(content,purpose,resource,self.events(db),self.version(db))
        require(row["version"] == version and row["settings_version"] == self.version(db, "settings_version") and row["content_hash"] == digest(content) and data.get("content_hash") == row["content_hash"], "PROPOSAL_STALE", "资料/授权已变化，请重新预览。", 409)
        duplicates.validate(content,data.get("duplicate_resolutions"))
        db.execute("UPDATE challenges SET consumed=1 WHERE nonce=? AND consumed=0", (data["nonce"],))
        return content

    def confirm_draft(self, draft_id, data, session_id, idempotency_key=None):
        with self.transaction() as db:
            operation = "confirm:" + draft_id + ":" + session_id
            cached = self.retry_result(db, idempotency_key, operation, data)
            if cached is not None:
                return cached
            self.consume(db, data, session_id, "confirm_draft", draft_id)
            event_id = self.confirm_draft_in_transaction(db, draft_id,duplicates.resolution(data,draft_id))
            result = {"event_id": event_id, "status": "CONFIRMED"}
            self.remember_result(db, idempotency_key, operation, data, result)
        return result


    def confirm_draft_in_transaction(self, db, draft_id,duplicate_resolution=None):
        row = db.execute("SELECT * FROM drafts WHERE id=? AND status='DRAFT'",(draft_id,)).fetchone()
        require(row is not None,"RESOURCE_NOT_FOUND","待确认草稿不存在。",404)
        content = validate_event(json.loads(row["content"]), self.account_map(db))
        zone = self.settings(db, "planning").get("timezone", "Australia/Sydney")
        require(content["date"] <= datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d"), "FUTURE_DATE", "未来记录可保留草稿，不能确认为已发生事件。")
        if content["kind"] == "refund":
            original = db.execute("SELECT * FROM events WHERE id=?", (content["refund_of"],)).fetchone()
            require(original is not None and not original["reverses"], "REFUND_LINK_REQUIRED", "退款必须关联已确认消费。")
            old = json.loads(original["content"])
            require(old["kind"] == "expense" and old["currency"] == content["currency"] and old["account_id"] == content["account_id"] and not db.execute("SELECT 1 FROM events WHERE reverses=?", (original["id"],)).fetchone(), "INVALID_REFUND", "退款币种/账户或原交易状态不匹配。")
            refunded = sum((Decimal(e["amount"]) * Decimal(e.get("direction", "1")) for e in self.events(db) if e.get("refund_of") == original["id"]), Decimal(0))
            require(refunded + Decimal(content["amount"]) <= Decimal(old["amount"]), "REFUND_LIMIT", "累计退款超过原消费金额。")
            require(content["category"] == old["category"], "REFUND_CATEGORY", "退款类别必须与原消费一致，请修正草稿。")
        content["direction"] = "1"
        content["draft_id"] = draft_id
        row = db.execute("SELECT source_key,evidence FROM drafts WHERE id=?", (draft_id,)).fetchone()
        content["evidence"] = json.loads(row["evidence"])
        if duplicate_resolution: content["evidence"]["duplicate_override"]={**duplicate_resolution,"at":now()}
        if content["evidence"].get("requires_ocr") or content["evidence"]["source"] in {"receipt_text", "tesseract-eng-local", "tesseract-local"}:
            require(self.settings(db, "consents")["ocr"], "CONSENT_REVOKED", "凭证处理授权已撤回。", 403)
        event_id = self.write_event(db, content, postings(content), row["source_key"] or "draft:" + draft_id)
        db.execute("UPDATE drafts SET status='CONFIRMED' WHERE id=?", (draft_id,))
        return event_id

    def reverse(self, event_id, data, session_id, idempotency_key=None):
        with self.transaction() as db:
            operation = "reverse:" + event_id + ":" + session_id
            cached = self.retry_result(db, idempotency_key, operation, data)
            if cached is not None:
                return cached
            preview = self.consume(db, data, session_id, "reverse_event", event_id)
            original = preview["original"]
            content = {**original, "direction": "-1", "evidence": {"source": "user_reversal", "original_event": event_id}}
            rows = [(row[0], str(-Decimal(row[1]))) for row in db.execute("SELECT account_ref,signed_amount FROM postings WHERE event_id=?", (event_id,))]
            new_id = self.write_event(db, content, rows, reverses=event_id)
            result = {"event_id": new_id, "reverses": event_id}
            self.remember_result(db, idempotency_key, operation, data, result)
        return result

    def save_settings(self, purpose, data, session_id):
        with self.transaction() as db:
            content = self.consume(db, data, session_id, purpose, purpose, data.get("payload"))
            db.execute("UPDATE settings SET content=? WHERE key=?", (canonical(content), purpose))
            self.bump(db, "settings_version")
            self.audit(db, purpose + ".change", purpose)
        return content

    def state(self, period):
        valid_month(period)
        with self.connect() as db:
            db.execute("BEGIN")
            accounts = list(self.account_map(db).values())
            events = self.events(db)
            for account in accounts:
                balance = sum((Decimal(v) for e in events for key, v in e["postings"] if key == account["id"]), Decimal(0))
                account["balance"] = fmt(-balance if account["type"] == "liability" else balance, account["currency"])
            drafts = []
            for row in db.execute("SELECT * FROM drafts WHERE status='DRAFT' ORDER BY created_at DESC"):
                content = json.loads(row["content"])
                candidates = [e["id"] for e in events if not e["reverses"] and e.get("direction", "1") == "1" and e["kind"] != "opening" and all(e.get(k) == content.get(k) for k in ("date", "amount", "currency", "merchant", "account_id"))]
                drafts.append({"id": row["id"], "version": row["version"], "content": content, "evidence": json.loads(row["evidence"]), "duplicate_candidates": candidates})
            consents = self.settings(db, "consents")
            planning = self.settings(db, "planning")
            summary = calculate(events, accounts, period) if consents["analysis"] else None
            zone = planning.get("timezone", "Australia/Sydney")
            daily_date = datetime.now(ZoneInfo(zone)).strftime("%Y-%m-%d")
            daily_summary = calculate([e for e in events if e["date"] == daily_date and e["kind"] != "opening"], accounts, daily_date[:7]) if consents["analysis"] else None
            investments=self.investment_rows(db,True)
            holdings=[{**x,"observed_at":x["latest"]["observed_at"], "quantity":x["latest"].get("quantity"), "price":x["latest"].get("price"), "cost_basis":x["latest"].get("cost_basis"),"market_value":x["latest"].get("market_value")} for x in investments if not x["archived"] and x["latest"] and x["latest"].get("market_value") is not None]
            result = {"accounts": accounts, "transactions": events, "drafts": drafts, "summary": summary,
                    "money_flow": money_flow(events, accounts, period) if consents["analysis"] else [],
                    "investments": investments, "portfolio_version":self.version(db,"portfolio_version"), "planning": planning, "consents": consents, "daily": {"date": daily_date, "summary": daily_summary}, "ledger_version": self.version(db),
                    "settings_version": self.version(db, "settings_version"), "period": period,
                    "portfolio": portfolio_analysis(holdings) if consents["analysis"] else [],
                    "holdings": holdings, "risk": self.risk(accounts, summary, planning) if summary is not None else None,
                    "statements": [dict(r) for r in db.execute("SELECT id,period,version,created_at FROM statements ORDER BY created_at DESC")],
                    "market_evidence": [json.loads(r[0]) for r in db.execute("SELECT content FROM evidence")],
                    "mock": any(bool(e.get("mock")) for e in events) or any(bool(h.get("mock")) for h in investments) or any(bool(a["mock"]) for a in accounts) or any(d["content"]["mock"] for d in drafts),
                    "as_of": now(), "calc_version": CALC_VERSION, "mode": "LOCAL_SINGLE_OPERATOR",
                    "capabilities": {"cloud_model": False, "bank_sync": False, "trading": False, "ocr": bool(shutil.which("tesseract")), "training": False},
                    "limitations": ["仅本地单用户；SQLite没有RLS或字段加密，依赖设备加密与文件权限。", "账户余额未经银行对账；导入覆盖未知。", "缺少FX时按原币种展示。"]}

            from .insights import enrich_state
            result["notifications"] = self.notification_state(db, result)
            return enrich_state(result)

    def risk(self, accounts, summaries, plan):
        currency = plan.get("currency", "AUD")
        cash = sum((Decimal(a["balance"]) for a in accounts if a["type"] == "cash" and a["currency"] == currency), Decimal(0))
        essential, income = plan.get("essential_spend"), plan.get("monthly_income")
        debt, earmarked = plan.get("debt_payment"), plan.get("earmarked")
        complete = all(x is not None for x in (essential, income, debt, earmarked))
        findings = []
        metrics = {"cash": fmt(cash, currency), "currency": currency, "available": None, "coverage_months": None, "cash_30d": None, "debt_burden_percent": None, "income_loss_months": None}
        if complete:
            spend, wage, repayment, reserve = map(Decimal, (essential, income, debt, earmarked))
            available = cash - reserve
            burn = spend + repayment
            metrics.update({"available": fmt(available, currency), "cash_30d": fmt(available + wage - burn, currency),
                            "coverage_months": str((available / burn).quantize(Decimal("0.01"))) if burn > 0 else None,
                            "income_loss_months": str((max(available, Decimal(0)) / burn).quantize(Decimal("0.01"))) if burn > 0 else None,
                            "debt_burden_percent": str((repayment / wage * 100).quantize(Decimal("0.01"))) if wage > 0 else None})
            if available < burn:
                findings.append({"severity": "HIGH", "message": "可用现金不足一个月必要支出和偿债。", "metric_id": "risk.coverage_months"})
            if available + wage - burn < 0:
                findings.append({"severity": "HIGH", "message": "在用户输入的稳定收入假设下，30天现金出现缺口。", "metric_id": "risk.cash_30d"})
        else:
            findings.append({"severity": "DATA_GAP", "message": "请填写稳定收入、必要支出、月偿债与圈定资金；缺资料不表示安全。", "metric_id": None})
        summary = next((s for s in summaries if s["currency"] == currency), None)
        budgets = []
        for b in plan.get("budgets", []):
            actual = Decimal(summary["categories"].get(b["category"], "0")) if summary else Decimal(0)
            delta = actual - Decimal(b["amount"])
            budgets.append({**b, "actual": fmt(actual, currency), "delta": fmt(delta, currency), "used_percent": str((actual / Decimal(b["amount"]) * 100).quantize(Decimal("0.01")))})
            if delta > 0:
                findings.append({"severity": "WATCH", "message": f"{b['category']}已超过用户批准预算。", "metric_id": "budget:" + b["category"]})
        today = datetime.now(ZoneInfo(plan.get("timezone", "Australia/Sydney"))).date()
        goals = []
        for g in plan.get("goals", []):
            deadline = datetime.fromisoformat(g["deadline"]).date()
            months = max(1, (deadline.year - today.year) * 12 + deadline.month - today.month)
            gap = max(Decimal(g["target"]) - Decimal(g["saved"]), Decimal(0))
            goals.append({**g, "gap": fmt(gap, currency), "monthly_required": fmt((gap / months).quantize(Decimal(1).scaleb(-CURRENCIES[currency]), rounding=ROUND_CEILING), currency), "overdue": deadline < today})
        return {"metrics": metrics, "findings": findings, "budgets": budgets, "budget_remaining": fmt(sum((Decimal(b["amount"]) - Decimal(b["actual"]) for b in budgets), Decimal(0)), currency) if budgets else None, "goals": goals, "policy_version": "local-risk-1", "assumptions": ["稳定月收入与必要支出由用户声明。", "无收益目标情景；无预测保证。", "仅规划币种；圈定金额不重复加入可用现金。"]}

    def holding(self, data):
        allowed = {"name", "issuer", "asset_type", "currency", "quantity", "price", "cost_basis", "observed_at", "mock"}
        require(isinstance(data, dict) and not set(data) - allowed, "INVALID_FIELDS", "持仓包含未知字段。")
        currency = data.get("currency")
        money("0", currency)
        kind = data.get("asset_type", "stock")
        require(kind in {"stock", "etf", "bond", "cash", "complex"}, "INVALID_ASSET", "资产类型无效。")
        item = {"id": uid(), "name": short_text(data.get("name"), "资产名称"), "issuer": short_text(data.get("issuer"), "发行人"),
                "asset_type": kind, "currency": currency, "quantity": str(decimal_value(data.get("quantity"), True)), "price": str(decimal_value(data.get("price"))),
                "cost_basis": None if data.get("cost_basis") in (None, "") else fmt(money(data["cost_basis"], currency), currency), "mock": data.get("mock", False)}
        require(item["cost_basis"] is None or Decimal(item["cost_basis"]) >= 0, "INVALID_COST", "成本基础不能为负。")
        require(isinstance(item["mock"], bool), "INVALID_FIELD", "mock必须是布尔值。")
        try:
            observed = datetime.fromisoformat(data.get("observed_at", "").replace("Z", "+00:00"))
            require(observed.tzinfo is not None and observed <= datetime.now(timezone.utc), "INVALID_TIME", "估值时间必须带时区且不在未来。")
            item["observed_at"] = observed.astimezone(timezone.utc).isoformat()
        except (ValueError, AttributeError) as exc:
            raise Problem("INVALID_TIME", "请输入带时区的估值时间。") from exc
        with self.transaction() as db:
            require(db.execute("SELECT count(*) FROM holdings").fetchone()[0] < 200, "RESOURCE_LIMIT", "最多200条持仓。")
            db.execute("INSERT INTO holdings VALUES (?,?)", (item["id"], canonical(item)))
            self.bump(db)
            self.audit(db, "holding.create", item["id"])
            self.migrate_investments(db)
        return item

    def delete_holding(self, holding_id):
        with self.transaction() as db:
            db.execute("UPDATE investments SET archived=1,version=version+1 WHERE legacy_id=?",(holding_id,))
            require(db.execute("DELETE FROM holdings WHERE id=?", (holding_id,)).rowcount == 1, "RESOURCE_NOT_FOUND", "持仓不存在。", 404)
            self.bump(db)
            self.audit(db, "holding.delete", holding_id)
        return {"deleted": holding_id}

    def statement(self, period):
        valid_month(period)
        with self.transaction() as db:
            require(self.settings(db, "consents")["analysis"], "CONSENT_REVOKED", "本地分析用途已撤回。", 403)
            accounts = list(self.account_map(db).values())
            events = self.events(db)
            summary = calculate(events, accounts, period)
            pending = db.execute("SELECT count(*) FROM drafts WHERE status='DRAFT' AND json_extract(content,'$.date') LIKE ?", (period + "%",)).fetchone()[0]
            snapshot = {"snapshot_id": uid(), "period": period, "summary": summary, "ledger_version": self.version(db),
                        "settings_version": self.version(db, "settings_version"), "calc_version": CALC_VERSION, "cutoff": now(),
                        "timezone": self.settings(db, "planning").get("timezone", "Australia/Sydney"), "pending_drafts": pending,
                        "mock": any(e.get("mock") for e in events) or any(a["mock"] for a in accounts), "event_ids": [e["id"] for e in events if e["date"].startswith(period)],
                        "status": "PROVISIONAL", "limitations": ["账户未银行对账；覆盖完整性未知。", "不包含月末持仓估值或跨币种换汇。"]}
            previous = db.execute("SELECT * FROM statements WHERE period=? ORDER BY version DESC LIMIT 1", (period,)).fetchone()
            if previous:
                old = json.loads(previous["snapshot"])
                if all(old[k] == snapshot[k] for k in ("ledger_version", "settings_version", "pending_drafts")):
                    return {"id": previous["id"], "version": previous["version"], "reused": True}
            version = previous["version"] + 1 if previous else 1
            snapshot["supersedes"] = previous["id"] if previous else None
            snapshot["revision_reason"] = "账本/规划/待确认数据变化，保留旧版本。" if previous else "首次暂结。"
            lines = [f"# {period} 个人财务分析账单", f"版本：v{version} | 状态：暂结 | mock：{str(snapshot['mock']).lower()}",
                     f"分析截止：{snapshot['cutoff']} | 时区：{snapshot['timezone']}", f"账本版本：{snapshot['ledger_version']} | 计算：{CALC_VERSION}",
                     "本报告是个人聚合分析，不是银行官方账单或审计证明。", "", "## 数据覆盖与限制",
                     f"未确认草稿：{pending}；覆盖未知；缺FX时按币种展示。", *snapshot["limitations"], "", "## 收支与现金桥接"]
            for s in summary:
                lines.extend([f"### {s['currency']}", f"收入 {s['income']}；费用（含退款抵减）{s['expenses']}；费用口径结余 {s['surplus']}。",
                              f"期初现金 {s['opening_cash']} + 现金变化 {s['cash_change']} = 期末现金 {s['closing_cash']}。",
                              "信用卡消费记费用，还本不重复计费；投资/借款本金不计工资。", "", "| 类别 | 费用 |", "|---|---:|"])
                for category, value in s["categories"].items():
                    safe_category = category.replace("|", "\\|").replace("<", "&lt;").replace(">", "&gt;")
                    lines.append(f"| {safe_category} | {value} |")
            lines.extend(["", "## 修订与证据", snapshot["revision_reason"], f"快照：{snapshot['snapshot_id']}",
                          "交易ID：" + ", ".join(snapshot["event_ids"]), "", "## 市场与投资限制", "没有有效市场/月底估值证据时不提供实时背景或投资交易建议。"])
            artifact = "\n".join(lines)
            statement_id = uid()
            db.execute("INSERT INTO statements VALUES (?,?,?,?,?,?)", (statement_id, period, version, canonical(snapshot), artifact, now()))
            self.audit(db, "statement.create", statement_id)
            self.bump(db, "resource_version")
        return {"id": statement_id, "version": version, "reused": False}

    def statement_get(self, statement_id):
        with self.connect() as db:
            require(self.settings(db, "consents")["analysis"], "CONSENT_REVOKED", "分析用途已撤回。", 403)
            row = db.execute("SELECT * FROM statements WHERE id=?", (statement_id,)).fetchone()
            require(row is not None, "RESOURCE_NOT_FOUND", "报表不存在。", 404)
            return {"id": row["id"], "version": row["version"], "snapshot": json.loads(row["snapshot"]), "markdown": row["artifact"], "sha256": hashlib.sha256(row["artifact"].encode()).hexdigest(), "language": "zh"}

    def privacy(self, action, data, session_id):
        with self.transaction() as db:
            self.consume(db, data, session_id, "privacy_" + action, "all")
            if action == "export":
                tables = ("accounts", "drafts", "events", "postings", "settings", "statements", "holdings", "evidence", "idempotency") + NEW_TABLES
                result = {table: [dict(r) for r in db.execute("SELECT * FROM " + table)] for table in tables}
                self.audit(db, "privacy.export", "all")
                return self.privacy_extra(db,action,{"schema_version": "2", "exported_at": now(), "data": result, "mock": any(a["mock"] for a in result["accounts"]) or any(json.loads(r["content"]).get("mock") for table in ("events", "drafts", "holdings", "investments") for r in result[table])})
            self.privacy_extra(db,action,None)
            for table in NEW_TABLES + ("postings", "outbox", "challenges", "idempotency", "drafts", "statements", "holdings", "evidence", "audit"):
                db.execute("DELETE FROM " + table)
            # Self FK must be deferred while deleting original and reversal together.
            db.execute("PRAGMA defer_foreign_keys=ON")
            db.execute("DELETE FROM events")
            db.execute("DELETE FROM accounts")
            db.execute("UPDATE settings SET content='{}' WHERE key='planning'")
            db.execute("DELETE FROM settings WHERE key IN ('terminal','notification_receipts')")
            db.execute("UPDATE settings SET content=? WHERE key='consents'", (canonical({"analysis": False, "ocr": False}),))
            self.bump(db)
            self.bump(db, "settings_version")
        self.compact_after_delete()
        return {"status": "LOCAL_DATA_DELETED", "remaining": ["用户下载文件和自行制作的备份不在服务控制范围。"], "sessions_revoked": True}

    def privacy_extra(self, db, action, result):
        return result

    def compact_after_delete(self):
        with self.connect() as db: db.execute("VACUUM")
