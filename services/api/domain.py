"""Versioned, exact-money calculations. No model or network dependencies."""
import calendar
import hashlib
import json
import re
from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

CALC_VERSION = "decimal-ledger-1"
CURRENCIES = {"AUD": 2, "CNY": 2, "USD": 2, "EUR": 2, "GBP": 2,
              "NZD": 2, "CAD": 2, "HKD": 2, "SGD": 2, "JPY": 0, "KRW": 0,
              "KWD": 3, "BHD": 3}
KINDS = {"income", "expense", "transfer", "card_payment", "loan_received",
         "debt_principal", "interest", "dividend", "investment_buy",
         "investment_sell", "refund"}


class Problem(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def require(condition, code, message, status=400):
    if not condition:
        raise Problem(code, message, status)


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def money(value, currency, positive=False):
    require(currency in CURRENCIES, "CURRENCY_UNSUPPORTED", "请选择支持的币种。")
    require(isinstance(value, str) and len(value) <= 32 and
            re.fullmatch(r"-?\d+(\.\d+)?", value), "INVALID_AMOUNT", "金额必须是十进制字符串。")
    try:
        amount = Decimal(value)
        quantum = Decimal(1).scaleb(-CURRENCIES[currency])
        require(amount == amount.quantize(quantum), "CURRENCY_PRECISION", "金额小数位不符合币种规则。")
        require(abs(amount) < Decimal("1000000000000"), "AMOUNT_LIMIT", "金额超出本地版本限制。")
        require(not positive or amount > 0, "INVALID_AMOUNT", "金额必须大于零。")
        return amount
    except InvalidOperation as exc:
        raise Problem("INVALID_AMOUNT", "无效金额。") from exc


def fmt(value, currency):
    amount = Decimal(value).quantize(Decimal(1).scaleb(-CURRENCIES[currency]), rounding=ROUND_HALF_UP)
    if amount == 0:
        amount = abs(amount)
    return f"{amount:.{CURRENCIES[currency]}f}"


def decimal_value(value, positive=False):
    require(isinstance(value, str) and len(value) <= 32 and
            re.fullmatch(r"\d+(\.\d{1,8})?", value), "INVALID_DECIMAL", "数量/价格必须是非负十进制字符串（最多8位小数）。")
    result = Decimal(value)
    require(result < Decimal("1000000000000") and (not positive or result > 0),
            "INVALID_DECIMAL", "数量/价格超出范围。")
    return result


def valid_date(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value),
            "INVALID_DATE", "日期格式应为 YYYY-MM-DD。")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise Problem("INVALID_DATE", "日期无效。") from exc
    return value


def valid_month(value):
    require(isinstance(value, str) and re.fullmatch(r"\d{4}-\d{2}", value),
            "INVALID_PERIOD", "期间格式应为 YYYY-MM。")
    valid_date(value + "-01")
    return value


def short_text(value, name, maximum=120):
    require(isinstance(value, str) and 0 < len(value.strip()) <= maximum,
            "INVALID_FIELD", f"{name}不能为空，且最多{maximum}字。")
    require(not any(ord(c) < 32 for c in value), "INVALID_FIELD", f"{name}不能包含控制字符。")
    return value.strip()


def validate_event(raw, accounts):
    allowed = {"amount", "currency", "date", "merchant", "category", "kind",
               "account_id", "counterparty_id", "refund_of", "external_id", "mock"}
    require(isinstance(raw, dict) and not (set(raw) - allowed), "INVALID_FIELDS", "交易包含未知字段。")
    data = {"kind": raw.get("kind", "expense"), "currency": raw.get("currency"),
            "amount": raw.get("amount"), "date": valid_date(raw.get("date")),
            "merchant": short_text(raw.get("merchant", "Manual record"), "商户/描述"),
            "category": short_text(raw.get("category", "Other"), "类别", 40),
            "account_id": raw.get("account_id"), "counterparty_id": raw.get("counterparty_id") or None,
            "refund_of": raw.get("refund_of") or None,
            "external_id": short_text(raw["external_id"], "来源ID") if raw.get("external_id") else None,
            "mock": raw.get("mock", False)}
    require(isinstance(data["mock"], bool), "INVALID_FIELD", "mock 必须是布尔值。")
    require(data["kind"] in KINDS, "INVALID_KIND", "不支持的交易类型。")
    amount = money(data["amount"], data["currency"], positive=True)
    data["amount"] = fmt(amount, data["currency"])
    require(data["account_id"] in accounts, "RESOURCE_NOT_FOUND", "账户不存在。", 404)
    account = accounts[data["account_id"]]
    require(not account.get("archived"), "ARCHIVED_RESOURCE", "账户已归档，请选择有效账户。")
    require(account["currency"] == data["currency"], "CURRENCY_MISMATCH", "账户与交易币种不一致。")
    if data["kind"] in {"transfer", "card_payment", "loan_received", "debt_principal"}:
        other = accounts.get(data["counterparty_id"])
        require(other is not None and not other.get("archived") and other["id"] != account["id"], "COUNTERPARTY_REQUIRED", "请选择不同的对方账户。")
        require(other["currency"] == data["currency"], "FX_REQUIRED", "跨币种转账需FX证据；本地版本仅支持同币种转账。")
        require(account["type"] == "cash", "INVALID_ACCOUNT_TYPE", "此交易的主账户必须是现金/银行账户。")
        expected = "cash" if data["kind"] == "transfer" else "liability"
        require(other["type"] == expected, "INVALID_ACCOUNT_TYPE", "对方账户类型不匹配。")
    if data["kind"] in {"income", "dividend", "investment_buy", "investment_sell"}:
        require(account["type"] == "cash", "INVALID_ACCOUNT_TYPE", "此交易需要现金/银行账户。")
    return data


def postings(event):
    """Signed decimal: positive debit, negative credit. Each event balances."""
    amount, account, kind = Decimal(event["amount"]), event["account_id"], event["kind"]
    category = event["category"]
    if kind in {"income", "dividend"}:
        rows = [(account, amount), ("income:" + category, -amount)]
    elif kind in {"expense", "interest"}:
        rows = [("expense:" + category, amount), (account, -amount)]
    elif kind == "refund":
        rows = [(account, amount), ("expense:" + category, -amount)]
    elif kind in {"transfer", "card_payment", "debt_principal"}:
        rows = [(event["counterparty_id"], amount), (account, -amount)]
    elif kind == "loan_received":
        rows = [(account, amount), (event["counterparty_id"], -amount)]
    elif kind == "investment_buy":
        rows = [("investment:principal", amount), (account, -amount)]
    elif kind == "investment_sell":
        rows = [(account, amount), ("investment:principal", -amount)]
    else:
        raise Problem("INVALID_KIND", "不支持的记账类型。")
    assert sum((x[1] for x in rows), Decimal(0)) == 0
    return [(key, str(value)) for key, value in rows]


def calculate(events, accounts, period):
    """Separate currencies; never guess an FX rate. Include cash bridge."""
    valid_month(period)
    currencies = sorted({a["currency"] for a in accounts} | {e["currency"] for e in events})
    result = []
    for currency in currencies:
        income = expenses = cash_change = opening = Decimal(0)
        categories = {}
        cash_ids = {a["id"] for a in accounts if a["currency"] == currency and a["type"] == "cash"}
        for event in events:
            if event["currency"] != currency:
                continue
            delta = sum((Decimal(value) for account, value in event["postings"] if account in cash_ids), Decimal(0))
            if event["date"] < period + "-01":
                opening += delta
            if not event["date"].startswith(period):
                continue
            cash_change += delta
            sign = Decimal(event.get("direction", "1"))
            amount = Decimal(event["amount"]) * sign
            if event["kind"] in {"income", "dividend"}:
                income += amount
            if event["kind"] in {"expense", "interest", "refund"}:
                cost = -amount if event["kind"] == "refund" else amount
                expenses += cost
                categories[event["category"]] = categories.get(event["category"], Decimal(0)) + cost
        result.append({"currency": currency, "income": fmt(income, currency),
                       "expenses": fmt(expenses, currency), "surplus": fmt(income - expenses, currency),
                       "cash_change": fmt(cash_change, currency), "opening_cash": fmt(opening, currency),
                       "closing_cash": fmt(opening + cash_change, currency),
                       "categories": {k: fmt(v, currency) for k, v in categories.items()},
                       "savings_rate_percent": str(((income - expenses) / income * 100).quantize(Decimal("0.01"))) if income > 0 else None})
        result[-1]["expense_income_percent"] = str((expenses / income * 100).quantize(Decimal("0.01"))) if income > 0 else None
    return result


def money_flow(events, accounts, period):
    """Weekly income/expense series with the same ledger definitions as summaries."""
    valid_month(period)
    last_day = calendar.monthrange(int(period[:4]), int(period[5:]))[1]
    result = []
    currencies = sorted({a["currency"] for a in accounts} | {e["currency"] for e in events})
    for currency in currencies:
        points = []
        for start in range(1, last_day + 1, 7):
            end = min(start + 6, last_day)
            income = expense = Decimal(0)
            for event in events:
                if event["currency"] != currency or not event["date"].startswith(period):
                    continue
                if not start <= int(event["date"][-2:]) <= end:
                    continue
                amount = Decimal(event["amount"]) * Decimal(event.get("direction", "1"))
                if event["kind"] in {"income", "dividend"}:
                    income += amount
                elif event["kind"] in {"expense", "interest", "refund"}:
                    expense += -amount if event["kind"] == "refund" else amount
            points.append({"label": f"{start:02d}–{end:02d}", "income": fmt(income, currency), "expenses": fmt(expense, currency)})
        result.append({"currency": currency, "points": points, "calc_version": CALC_VERSION})
    return result


def portfolio_analysis(holdings):
    groups = {}
    for item in holdings:
        currency = item["currency"]
        groups.setdefault(currency, []).append(item)
    result = []
    for currency, rows in groups.items():
        values = [Decimal(r["market_value"]) if r.get("market_value") is not None else Decimal(r["quantity"]) * Decimal(r["price"]) for r in rows]
        total = sum(values, Decimal(0))
        issuers = {}
        for row, value in zip(rows, values):
            issuers[row["issuer"]] = issuers.get(row["issuer"], Decimal(0)) + value
        positions = []
        for row, value in zip(rows, values):
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(row["observed_at"])).total_seconds()
            positions.append({**row, "market_value": fmt(value.quantize(Decimal(1).scaleb(-CURRENCIES[currency]), rounding=ROUND_HALF_UP), currency),
                              "weight_percent": str((value / total * 100).quantize(Decimal("0.01"))) if total else None,
                              "unrealized_gain": fmt(value - Decimal(row["cost_basis"]), currency) if row.get("cost_basis") is not None else None,
                              "quality": "STALE" if age > 900 else "USER_PROVIDED",
                              "coverage": "LIMITED" if row["asset_type"] not in {"stock", "etf", "bond", "cash"} else "SIMPLE_ASSET"})
        result.append({"currency": currency, "total": fmt(total, currency), "positions": positions,
                       "issuer_hhi": str(sum(((v / total) ** 2 for v in issuers.values()), Decimal(0)).quantize(Decimal("0.0001"))) if total else None,
                       "largest_issuer_percent": str((max(issuers.values()) / total * 100).quantize(Decimal("0.01"))) if total else None,
                       "limitations": ["手工估值，不是实时行情；不计算TWR/XIRR或交易建议。", "缺少FX时按币种分别汇总；未知成本不记为零。"]})
    return result
