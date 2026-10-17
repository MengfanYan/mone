"""E0 rules + tools baseline. Model text never performs writes or grants consent."""
import re
import time
from datetime import datetime
from zoneinfo import ZoneInfo

from .domain import CURRENCIES, Problem, now, require, valid_month
from .store import uid

ARTIFACT = {"id": "wallet-e0-1", "kind": "deterministic-template", "model": None,
            "prompt_version": "zh-templates-1", "tool_version": "readonly-1",
            "policy_version": "local-risk-1", "trained": False, "external_requests": False}


def intent(text):
    # Explanations do not grant write capabilities. Explicit second actions still block.
    education = bool(re.search(r"^(?:please\s+)?(?:explain|why|what|how|compare|describe)\b|^(?:请)?(?:解释|说明|比较|为什么|什么是)",text.strip(),re.I)) and not re.search(r"(?:^|[.!;。；]\s*|\b(?:then|and)\s+)(?:please\s+)?(?:buy|sell|pay|transfer|delete|execute|send)\b|然后(?:买入|卖出|支付|转账|删除|执行)",text,re.I)
    if education and re.search(r"transfer|expense|principal|内部转账|本金|费用",text,re.I): return "explain_spending"
    if education and re.search(r"sell|buy|卖出|买入",text,re.I): return "portfolio_risk"
    # Requests outside read-only education never reach the tool executor.
    if re.search(r"买入|卖出|下单|交易|调仓|buy|sell|trade|rebalance|recommend.*(?:stock|fund)", text, re.I):
        return "unsupported_trade"
    if re.search(r"删除|分享|发送|导出|授权|同意|确认|支付|转账|delete|share|send|export|consent|confirm|pay|transfer", text, re.I):
        return "privacy_or_write"
    if re.search(r"市场|行情|CPI|通胀|就业|market|inflation", text, re.I):
        return "market_context"
    if re.search(r"持仓|投资|组合|portfolio|holding|investment", text, re.I):
        return "portfolio_risk"
    if re.search(r"失业|压力|情景|收入.*减少|scenario|stress|unemploy", text, re.I):
        return "cashflow_scenario"
    if re.search(r"预算|目标|budget|goal", text, re.I):
        return "budget"
    if re.search(r"支出|收入|现金|月|日报|分析|spend|income|cash|month|daily|summary|analy", text, re.I):
        return "explain_spending"
    return "clarify"


class Gateway:
    schemas = {"read_financial_summary": {"snapshot_id"}, "compute_cashflow_risk": {"snapshot_id"},
               "compute_portfolio_risk": {"snapshot_id"}, "read_market_evidence": {"snapshot_id"}}

    def __init__(self, store, snapshot):
        self.store, self.snapshot = store, snapshot
        self.calls, self.started = 0, time.monotonic()

    def call(self, name, arguments):
        require(name in self.schemas, "TOOL_FORBIDDEN", "工具不在只读白名单。", 403)
        require(isinstance(arguments, dict) and set(arguments) == self.schemas[name], "TOOL_SCHEMA", "工具参数无效。")
        require(arguments["snapshot_id"] == self.snapshot["id"], "RESOURCE_FORBIDDEN", "快照不属于当前任务。", 403)
        require(self.calls < 8 and time.monotonic() - self.started < 120, "BUDGET_EXHAUSTED", "工具预算耗尽。", 429)
        # Always recheck current authorization and versions, even for frozen task references.
        with self.store.connect() as db:
            require(self.store.settings(db, "consents")["analysis"], "CONSENT_REVOKED", "分析用途已撤回。", 403)
            require(self.store.version(db) == self.snapshot["state"]["ledger_version"] and
                    self.store.version(db, "settings_version") == self.snapshot["state"]["settings_version"],
                    "SNAPSHOT_STALE", "数据已变化，请重新分析。", 409)
        self.calls += 1
        field = {"read_financial_summary": "summary", "compute_cashflow_risk": "risk",
                 "compute_portfolio_risk": "portfolio", "read_market_evidence": "market_evidence"}[name]
        return self.snapshot["state"][field]


def run(store, text, period=None, currency=None):
    require(currency is None or (isinstance(currency,str) and currency in CURRENCIES),"CURRENCY_UNSUPPORTED","请选择支持的币种。")
    require(isinstance(text, str) and 0 < len(text.strip()) <= 2000, "INVALID_PROMPT", "问题需为1–2000字。")
    category = intent(text)
    result = {"id": uid(), "intent": category, "artifact": ARTIFACT, "as_of": now(), "mock": False,
              "period":period,"scope":{"period":period,"currency":currency,"event_ids":[]}, "plan": [], "observations": [], "facts": [], "calculations": [], "assumptions": [], "actions": [],
              "limits": {"max_tool_calls": 8, "max_seconds": 120, "max_replans": 2}, "status": "COMPLETED"}
    if category in {"unsupported_trade", "privacy_or_write"}:
        result.update(status="BLOCKED", actions=["助手仅执行只读分析。资金交易和具体产品建议未开放；记账/授权/隐私操作请使用对应页面确认。"])
        return result
    if category == "clarify":
        result.update(status="CLARIFYING", actions=["请选择收支分析、预算目标、现金压力情景、持仓风险或市场证据，并说明期间。"])
        return result
    with store.connect() as db:
        require(store.settings(db, "consents")["analysis"], "CONSENT_REVOKED", "分析用途已撤回。", 403)
        plan = store.settings(db, "planning")
    today = datetime.now(ZoneInfo(plan.get("timezone", "Australia/Sydney")))
    if not period:
        explicit = re.search(r"\b\d{4}-\d{2}\b", text)
        if explicit:
            period = explicit[0]
        elif re.search(r"上个月|上月|last month", text, re.I):
            period = f"{today.year - (today.month == 1):04d}-{12 if today.month == 1 else today.month - 1:02d}"
        else:
            period = today.strftime("%Y-%m")
    valid_month(period)
    state = store.state(period)
    if currency:
        state["summary"] = [x for x in state["summary"] if x["currency"]==currency]
        state["portfolio"] = [x for x in state["portfolio"] if x["currency"]==currency]
        if state["risk"]["metrics"]["currency"] != currency:
            state["risk"] = {"metrics":{key:(currency if key=="currency" else None) for key in state["risk"]["metrics"]},"findings":[{"message":"当前币种缺少已批准的规划假设。"}],"assumptions":["当前币种缺少已批准的规划假设。"]}
    result["scope"]={"period":period,"currency":currency,"currencies":sorted({a["currency"] for a in state["accounts"] if not currency or a["currency"]==currency}),"ledger_version":state["ledger_version"],"settings_version":state["settings_version"],"event_ids":[e["id"] for e in state["transactions"] if e["date"].startswith(period) and (not currency or e["currency"]==currency)],"calculation_version":state["calc_version"]}
    if currency and not any(a["currency"]==currency for a in state["accounts"]) and not any(i["currency"]==currency for i in state["investments"]):
        result.update(status="DEGRADED",period=period,actions=["所选币种没有可分析的记录。"])
        return result
    snapshot = {"id": uid(), "state": state}
    result.update(snapshot_id=snapshot["id"], period=period, mock=state["mock"])
    gateway = Gateway(store, snapshot)
    names = {"market_context": ["read_market_evidence"], "portfolio_risk": ["compute_portfolio_risk"],
             "explain_spending": ["read_financial_summary", "compute_cashflow_risk"],
             "cashflow_scenario": ["compute_cashflow_risk"], "budget": ["compute_cashflow_risk"]}[category]
    for number, name in enumerate(names, 1):
        step_id = "s" + str(number)
        result["plan"].append({"id": step_id, "tool": name, "depends_on": [] if number == 1 else ["s" + str(number - 1)], "arguments": {"snapshot_id": snapshot["id"]}})
        value = gateway.call(name, {"snapshot_id": snapshot["id"]})
        result["observations"].append({"step_id": step_id, "result_ref": "obs:" + step_id, "quality": "PARTIAL", "cost": "0", "error_code": None})
        if name == "read_financial_summary":
            for s in value:
                for key, label in (("income", "确认收入"), ("expenses", "确认费用（扣除退款）"), ("cash_change", "现金变化")):
                    result["calculations"].append({"metric_id": f"summary:{period}:{s['currency']}:{key}", "label": label, "value": s[key], "unit": s["currency"]})
            result["actions"].append("检查待确认草稿与重复候选；本金、转账与现金变化的口径不同。")
        elif name == "compute_cashflow_risk":
            for key in ("available", "coverage_months", "cash_30d", "income_loss_months", "debt_burden_percent"):
                unit = "months" if "months" in key else "%" if "percent" in key else value["metrics"]["currency"]
                result["calculations"].append({"metric_id": "risk." + key, "label": {"available": "可用现金", "coverage_months": "必要支出覆盖月数", "cash_30d": "30天情景现金", "income_loss_months": "无收入情景月数", "debt_burden_percent": "内部偿债负担率"}[key], "value": value["metrics"][key], "unit": unit})
            result["assumptions"].extend(value["assumptions"])
            result["actions"].extend(f["message"] for f in value["findings"])
        elif name == "compute_portfolio_risk":
            for p in value:
                result["calculations"].append({"metric_id": "portfolio:" + p["currency"], "label": "手工持仓市值", "value": p["total"], "unit": p["currency"]})
                result["assumptions"].extend(p["limitations"])
            if not value:
                result["actions"].append("没有持仓快照，请在持仓页录入只读估值。")
                result["status"] = "DEGRADED"
        else:
            result["facts"] = value
            if not value:
                result.update(status="DEGRADED", actions=["INSUFFICIENT_EVIDENCE：没有有效市场来源；不生成当前行情或通胀数字。"])
    result["assumptions"] = list(dict.fromkeys(result["assumptions"] + state["limitations"]))
    if re.search(r"internal transfer|内部转账|转账.*费用",text,re.I):
        result["actions"].insert(0,"内部转账改变账户间的现金分布，不构成新的收入或费用；借款与还款本金也不重复计入费用。")
    if re.search(r"^(?:explain|why|what|how|compare|describe)|^(?:请)?(?:解释|说明|比较|为什么)",text.strip(),re.I) and re.search(r"sell|buy|卖出|买入",text,re.I):
        result["actions"].insert(0,"买卖会改变持仓与现金，税费、流动性和成本资料不足时不能判断净收益；本次只解释，不执行交易。")
    if category != "market_context" and not any(c["value"] is not None for c in result["calculations"]):
        result["status"] = "DEGRADED"
    result["tool_calls"] = gateway.calls
    require(all(c["value"] is None or isinstance(c["value"], str) for c in result["calculations"]), "OUTPUT_INVALID", "输出金额不是精确字符串。", 500)
    return result
