"""Loopback-only HTTP API with expiring HttpOnly sessions and origin checks."""
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from datetime import datetime
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from zoneinfo import ZoneInfo

from . import agent, market, terminal
from .domain import Problem, canonical, now, require
from .store import Store
from .business import BusinessAPI
from .localization import error_message, language, result_for


class Application(BusinessAPI):
    def __init__(self, store, access_code, web_port=3000):
        require(isinstance(access_code, str) and 12 <= len(access_code) <= 200, "ACCESS_CODE_REQUIRED", "本地访问码需为12–200个字符。")
        self.store = store
        self.salt = secrets.token_bytes(16)
        self.password = hashlib.scrypt(access_code.encode(), salt=self.salt, n=16384, r=8, p=1)
        self.sessions = {}
        self.failures = []
        self.terminal_challenges = {}
        self.lock = threading.RLock()
        self.origins = {f"http://localhost:{web_port}", f"http://127.0.0.1:{web_port}"}

    def check_code(self, code):
        require(isinstance(code, str) and len(code) <= 200, "AUTH_INVALID", "访问码无效。", 401)
        hashed = hashlib.scrypt(code.encode(), salt=self.salt, n=16384, r=8, p=1)
        return hmac.compare_digest(hashed, self.password)

    def authenticate(self, cookie):
        jar = SimpleCookie()
        try:
            jar.load(cookie or "")
            token = jar.get("wallet_session")
            key = hashlib.sha256(token.value.encode()).hexdigest() if token else None
        except Exception:
            key = None
        with self.lock:
            record = self.sessions.get(key)
            require(record and record["expires"] > time.time(), "UNAUTHENTICATED", "请输入终端显示的本地访问码。", 401)
        return key

    def dispatch(self, method, path, query, data, cookie, origin, idempotency_key=None):
        extracted=None
        if method=="POST" and path=="/v1/terminal/model-explanation":
            require(origin in self.origins,"ORIGIN_FORBIDDEN","写操作必须来自本地工作台。",403)
            with self.lock:
                session_id=self.authenticate(cookie)
                challenge=terminal.consume_model_preview(self,data,session_id)
            # A slow provider must not block lock, revocation or data deletion.
            result=terminal.fetch_explanation(challenge["payload"])
            with self.lock:
                self.authenticate(cookie)
                return terminal.finish_model_explanation(self,challenge,result),None
        if method=="POST" and path=="/v1/evidence-imports":
            # Bounded OCR may be slow. Recheck session + consent at commit, after any lock/delete.
            require(origin in self.origins,"ORIGIN_FORBIDDEN","写操作必须来自本地工作台。",403)
            self.authenticate(cookie)
            require(isinstance(data,dict) and not set(data)-{"text","image_base64","doc_type","account_id","currency","period"},"INVALID_FIELDS","凭证字段无效。")
            with self.store.connect() as db:require(self.store.settings(db,"consents")["ocr"],"CONSENT_REQUIRED","请先授权本地凭证识别。",403)
            from .evidence import extract
            extracted=extract(data)
        if method not in {"GET","HEAD"}:
            with self.lock:
                return self._dispatch(method,path,query,data,cookie,origin,idempotency_key,extracted)
        return self._dispatch(method,path,query,data,cookie,origin,idempotency_key,extracted)

    def _dispatch(self, method, path, query, data, cookie, origin, idempotency_key=None, extracted_evidence=None):
        if method not in {"GET", "HEAD"}:
            require(origin in self.origins, "ORIGIN_FORBIDDEN", "写操作必须来自本地工作台。", 403)
        if path == "/v1/health" and method == "GET":
            return {"status": "ok", "mode": "local", "version": "1"}, None
        if path == "/v1/session" and method == "POST":
            require(set(data) == {"access_code"}, "INVALID_FIELDS", "登录字段无效。")
            with self.lock:
                self.failures = [t for t in self.failures if t > time.time() - 60]
                require(len(self.failures) < 10, "AUTH_RATE_LIMIT", "尝试次数过多，请一分钟后重试。", 429)
                if not self.check_code(data["access_code"]):
                    self.failures.append(time.time())
                    raise Problem("AUTH_INVALID", "访问码不正确。", 401)
                token = secrets.token_urlsafe(32)
                self.sessions = {k: v for k, v in self.sessions.items() if v["expires"] > time.time()}
                require(len(self.sessions) < 50, "SESSION_LIMIT", "本地会话数量超限。", 429)
                self.sessions[hashlib.sha256(token.encode()).hexdigest()] = {"expires": time.time() + 43200}
            return {"authenticated": True, "mode": "LOCAL_SINGLE_OPERATOR"}, f"wallet_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200"
        session_id = self.authenticate(cookie)
        if path.startswith("/v1/terminal/"):
            return terminal.dispatch(self,method,path[len("/v1/terminal/"):],data,session_id), None
        if path == "/v1/session" and method == "DELETE":
            with self.lock:
                self.sessions.pop(session_id, None)
                self.terminal_challenges = {k:v for k,v in self.terminal_challenges.items() if v["session"] != session_id}
            return {"authenticated": False}, "wallet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0"
        if path == "/v1/session" and method == "GET":
            return {"authenticated": True, "artifact": agent.ARTIFACT}, None
        return self.dispatch_business(method,path,query,data,session_id,idempotency_key,extracted_evidence)

    def authorize_sensitive(self, data, session_id):
        code = data.pop("access_code", None)
        require(self.check_code(code), "REAUTH_REQUIRED", "导出/删除需要再次输入访问码。", 401)

    def on_privacy_deleted(self, session_id):
        with self.lock:
            self.sessions.clear()
            self.terminal_challenges.clear()


def handler_for(app):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def log_message(self, format, *args):
            pass  # No URLs, request bodies, financial content, or cookies in logs.

        def handle_request(self):
            trace_id = secrets.token_hex(12)
            locale = language(self.headers.get("Accept-Language"))
            try:
                host = urlsplit("http://" + self.headers.get("Host", "")).hostname
                require(host in {"localhost", "127.0.0.1"}, "HOST_FORBIDDEN", "服务仅允许本机访问。", 403)
                require(self.headers.get("Transfer-Encoding") is None, "INVALID_REQUEST", "不支持分块请求。")
                length = int(self.headers.get("Content-Length", "0"))
                require(0 <= length <= 7_100_000, "REQUEST_LIMIT", "请求体超限。", 413)
                data = {}
                if length:
                    require(self.headers.get("Content-Type", "").split(";")[0] == "application/json", "CONTENT_TYPE", "请求必须为JSON。", 415)
                    def reject_constant(value):
                        raise ValueError("non-finite JSON")
                    data = json.loads(self.rfile.read(length), parse_constant=reject_constant)
                    require(isinstance(data, dict), "INVALID_JSON", "请求应为JSON对象。")
                parsed = urlsplit(self.path)
                require(len(parsed.path) < 250 and len(parsed.query) < 200, "REQUEST_LIMIT", "请求路径超限。", 413)
                result, cookie = app.dispatch(self.command, parsed.path, parse_qs(parsed.query), data,
                                              self.headers.get("Cookie"), self.headers.get("Origin"), self.headers.get("Idempotency-Key"))
                self.respond(200, {"data": result_for(parsed.path, result, locale), "trace_id": trace_id, "as_of": now()}, cookie)
            except Problem as exc:
                self.respond(exc.status, {"error": {"code": exc.code, "message": error_message(exc.message, exc.code, locale), "retryable": exc.status in {429, 503}, "user_action_required": True}, "trace_id": trace_id})
            except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
                self.respond(400, {"error": {"code": "INVALID_REQUEST", "message": error_message("请求格式无效。", "INVALID_REQUEST", locale)}, "trace_id": trace_id})
            except Exception:
                self.respond(500, {"error": {"code": "INTERNAL_ERROR", "message": error_message("操作未完成；请刷新检查状态。", "INTERNAL_ERROR", locale)}, "trace_id": trace_id})

        def respond(self, status, value, cookie=None):
            payload = canonical(value).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Language", language(self.headers.get("Accept-Language")))
            self.send_header("X-Content-Type-Options", "nosniff")
            if cookie:
                self.send_header("Set-Cookie", cookie)
            self.end_headers()
            self.wfile.write(payload)

        do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = handle_request

    return Handler


def main():
    require(os.environ.get("WALLET_MODE", "local") == "local", "DEPLOYMENT_BLOCKED", "此实现仅限本地；托管部署未通过验收。")
    access = os.environ.get("LOCAL_ACCESS_CODE")
    if not access:
        access = secrets.token_urlsafe(18)
        print(f"Local access code: {access}", flush=True)
    db_path = Path(os.environ.get("WALLET_DB", str(Path(__file__).resolve().parents[2] / ".local-data/wallet.sqlite3")))
    app = Application(Store(db_path), access, int(os.environ.get("PORT", "3000")))
    server = ThreadingHTTPServer(("127.0.0.1", int(os.environ.get("API_PORT", "8765"))), handler_for(app))
    server.daemon_threads = True
    print(f"Local API ready on http://127.0.0.1:{server.server_port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
