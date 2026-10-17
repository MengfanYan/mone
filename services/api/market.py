"""One fixed public connector. No user financial context or arbitrary URLs."""
import calendar
import hashlib
import http.client
import ipaddress
import json
import socket
import ssl
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from .domain import Problem, canonical, digest, now, require, valid_date
from .store import uid

HOST = "api.bls.gov"
SERIES = "CUUR0000SA0"
PATH = "/publicAPI/v2/timeseries/data/" + SERIES


def fetch_bls():
    try:
        addresses = list(dict.fromkeys(item[4][0] for item in socket.getaddrinfo(HOST, 443, type=socket.SOCK_STREAM)))
        require(addresses and all(ipaddress.ip_address(a).is_global for a in addresses), "MARKET_HOST_BLOCKED", "来源DNS地址不符合公共出网策略。", 503)
        class PinnedConnection(http.client.HTTPSConnection):
            def connect(self):
                raw = socket.create_connection((addresses[0], 443), timeout=8)
                self.sock = self._context.wrap_socket(raw, server_hostname=HOST)
        connection = PinnedConnection(HOST, timeout=8, context=ssl.create_default_context())
        try:
            connection.request("GET", PATH, headers={"Accept": "application/json", "User-Agent": "LocalWallet/1.0"})
            response = connection.getresponse()
            require(response.status == 200, "MARKET_UNAVAILABLE", "官方数据暂不可取得，保留历史证据。", 503)
            payload = response.read(1024 * 1024 + 1)
            require(len(payload) <= 1024 * 1024, "MARKET_SIZE", "供应商响应超限。", 503)
            return json.loads(payload), hashlib.sha256(payload).hexdigest()
        finally:
            connection.close()
    except Problem:
        raise
    except (OSError, ValueError, http.client.HTTPException) as exc:
        raise Problem("MARKET_UNAVAILABLE", "无法连接BLS官方来源；不生成替代数据。", 503) from exc


def normalize_bls(payload, payload_hash, retrieved_at):
    require(isinstance(payload, dict) and payload.get("status") == "REQUEST_SUCCEEDED", "MARKET_CONTRACT", "BLS响应状态无效。", 503)
    results = payload.get("Results", {})
    # Current documented JSON shape is {Results: {series: [...]}}.
    require(isinstance(results, dict), "MARKET_CONTRACT", "BLS响应结构不匹配。", 503)
    series = results.get("series")
    require(isinstance(series, list) and len(series) == 1 and series[0].get("seriesID") == SERIES, "MARKET_CONTRACT", "官方系列标识不匹配。", 503)
    rows = series[0].get("data")
    require(isinstance(rows, list) and len(rows) <= 60, "MARKET_CONTRACT", "数据行数异常。", 503)
    evidence = []
    for row in rows:
        if row.get("period") == "M13":  # Annual average is not a monthly observation.
            continue
        try:
            year, month = int(row["year"]), int(row["period"][1:])
            require(row["period"] == f"M{month:02d}" and 1 <= month <= 12, "MARKET_CONTRACT", "观察期无效。", 503)
            start = valid_date(f"{year:04d}-{month:02d}-01")
            end = valid_date(f"{year:04d}-{month:02d}-{calendar.monthrange(year, month)[1]}")
            raw_value = row["value"]
            require(isinstance(raw_value, str), "MARKET_CONTRACT", "指数值必须为字符串。", 503)
            value = None if raw_value == "-" else raw_value
            require(value is None or (Decimal(value).is_finite() and Decimal(value) > 0), "MARKET_CONTRACT", "指数值无效。", 503)
        except (KeyError, ValueError, TypeError, InvalidOperation) as exc:
            raise Problem("MARKET_CONTRACT", "BLS数据字段无效。", 503) from exc
        content_hash = digest([SERIES, start, row["value"], row.get("footnotes", [])])
        evidence.append({"evidence_id": uid(), "source_id": "bls-cpi-u-us-all-items", "series_id": SERIES,
                         "label": "美国城市消费者全部项目CPI（未季调）", "source_url": "https://data.bls.gov/timeseries/" + SERIES,
                         "provider": "US Bureau of Labor Statistics", "original_provider": "BLS", "geography": "US urban average",
                         "value": value, "unit": "index: 1982-84=100", "currency": None, "frequency": "monthly",
                         "observation_start": start, "observation_end": end, "published_at": None, "effective_at": None,
                         "retrieved_at": retrieved_at, "quote_observed_at": None, "provider_delay_seconds": None,
                         "vintage_id": content_hash, "revised_from": None, "seasonal_adjustment": "not seasonally adjusted",
                         "payload_sha256": payload_hash, "license_tag": "BLS-public-data", "mock": False,
                         "quality_status": "MISSING_OBSERVATION" if value is None else "HISTORICAL_OBSERVATION", "parse_version": "bls-cpi-1", "access_entitlement": "public",
                         "footnotes": row.get("footnotes", []),
                         "limitations": ["发布时间未知，保留null。", "美国总体历史指数不能预测个人食品支出；不视为实时行情。"] + (["官方标注此观察期数据缺失，不填造数值。"] if value is None else [])})
    require(evidence, "INSUFFICIENT_EVIDENCE", "来源未返回月度观察。", 503)
    return evidence


def refresh(store):
    with store.connect() as db:
        require(store.settings(db, "consents")["analysis"], "CONSENT_REVOKED", "分析授权已撤回。", 403)
        version = store.version(db, "settings_version")
        last = float(db.execute("SELECT value FROM meta WHERE key='market_last_refresh'").fetchone()[0])
        require(time.time() - last >= 3600, "MARKET_RATE_LIMIT", "公共数据每小时最多刷新一次。", 429)
    payload, payload_hash = fetch_bls()
    records = normalize_bls(payload, payload_hash, now())
    added = 0
    with store.transaction() as db:
        require(store.settings(db, "consents")["analysis"] and store.version(db, "settings_version") == version, "CONSENT_REVOKED", "处理期间授权已变化；结果未保存。", 403)
        last = float(db.execute("SELECT value FROM meta WHERE key='market_last_refresh'").fetchone()[0])
        require(time.time() - last >= 3600, "MARKET_RATE_LIMIT", "公共数据刚刚更新，请稍后再试。", 429)
        for record in records:
            old = [json.loads(r[0]) for r in db.execute("SELECT content FROM evidence WHERE json_extract(content,'$.series_id')=? AND json_extract(content,'$.observation_start')=? ORDER BY rowid DESC", (SERIES, record["observation_start"]))]
            if any(r["vintage_id"] == record["vintage_id"] for r in old):
                continue
            record["revised_from"] = old[0]["evidence_id"] if old else None
            db.execute("INSERT INTO evidence VALUES (?,?)", (record["evidence_id"], canonical(record)))
            added += 1
        if added:
            store.bump(db)
        db.execute("UPDATE meta SET value=? WHERE key='market_last_refresh'", (str(time.time()),))
        store.audit(db, "market.refresh", "bls-cpi-u-us-all-items")
    return {"added": added, "source_id": "bls-cpi-u-us-all-items", "mock": False, "published_at": None}
