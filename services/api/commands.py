"""Bounded local command grammar. Plans are data, never authority or executable code."""
import re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from .domain import require, valid_date, CURRENCIES

EVENT_FIELDS = {"amount", "currency", "date", "merchant", "category", "kind", "account_id", "counterparty_id", "refund_of", "external_id", "mock"}
CATEGORIES = [(r"咖啡|coffee|餐饮|dining|lunch|dinner", "Dining"), (r"食品|超市|grocer", "Groceries"),
              (r"房租|rent|housing", "Housing"), (r"出行|train|transport|taxi", "Transport")]
FORBIDDEN = r"转账到|自动买|买入股票|下单|支付给|删除全部|删除所有|导出全部|上传云|授权云|分享|delete all|erase all|export all|send money|place.*order|buy.*shares|cloud|share.*data"

def date_for(text, zone, clock=None):
    day = (clock or datetime.now(ZoneInfo(zone))).date()
    explicit = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if explicit:
        return valid_date(explicit[1]), "explicit ISO date"
    if re.search(r"昨天|yesterday", text, re.I): return (day - timedelta(days=1)).isoformat(), "user timezone / yesterday"
    if re.search(r"前天", text): return (day - timedelta(days=2)).isoformat(), "user timezone / two days ago"
    if re.search(r"明天|tomorrow", text, re.I): return (day + timedelta(days=1)).isoformat(), "user timezone / tomorrow"
    friday = re.search(r"上周五|last friday", text, re.I)
    if friday:
        delta = (day.weekday() - 4) % 7 or 7
        return (day - timedelta(days=delta)).isoformat(), "user timezone / last Friday"
    if re.search(r"月底|以后|later|next month", text, re.I): return None, "date needs clarification"
    return day.isoformat(), "user timezone / today"

def parse(text, accounts, *, account_id=None, currency=None, zone="Australia/Sydney", clock=None):
    require(isinstance(text, str) and 0 < len(text.strip()) <= 2000, "COMMAND_TEXT", "请输入2000字以内的本地任务。")
    require(not re.search(FORBIDDEN, text, re.I), "COMMAND_FORBIDDEN", "此请求请使用专门授权或隐私流程；文字任务不能支付、交易、共享或删除全库。", 403)
    selected = next((a for a in accounts if a["id"] == account_id and not a.get("archived")), None)
    require(not account_id or selected is not None, "RESOURCE_NOT_FOUND", "选定账户不存在或已归档。", 404)
    if currency is not None: require(currency in CURRENCIES, "CURRENCY_UNSUPPORTED", "请选择支持的币种。")
    if selected and currency: require(selected["currency"] == currency, "CURRENCY_MISMATCH", "账户与交易币种不一致。")
    normalized_text = re.sub(r"(?<=\d),(?=\d{3}(?:\D|$))", "", text)
    day, basis = date_for(text, zone, clock)
    obj = "budget" if re.search(r"预算|budget", text, re.I) else "goal" if re.search(r"目标|goal", text, re.I) else "account" if re.search(r"账户|account", text, re.I) else "investment" if re.search(r"投资|持仓|investment|holding", text, re.I) else "record"
    if re.search(r"删除|移除|归档|delete|remove|archive", text, re.I): intent = "delete"
    elif re.search(r"改成|改为|改名|修改|不是|其实|rename|change|correct|update|was actually", text, re.I): intent = "update"
    elif re.search(r"查|找|多少|show|find|search|how much|list", text, re.I): intent = "query"
    else: intent = "create"
    if intent != "create" or obj != "record":
        numbers = re.findall(r"(?<![\d-])(\d+(?:\.\d+)?)(?![\d-])", re.sub(r"\d{4}-\d{2}-\d{2}", "", normalized_text))
        return {"intent": intent, "object": obj, "operations": [], "selector": text,
                "amount": numbers[-1] if numbers else None, "currency": next((c for c in CURRENCIES if re.search(r"\b"+c+r"\b",text,re.I)), currency or (selected["currency"] if selected else None)), "date": day if re.search(r"昨天|前天|yesterday|\d{4}-\d{2}-\d{2}", text, re.I) else None, "date_basis": basis}
    clauses = re.split(r"[，,；;。\n]|\band\b", normalized_text, flags=re.I)
    operations = []
    for clause in clauses:
        clause = clause.strip()
        if not clause: continue
        cleaned = re.sub(r"\d{4}-\d{2}-\d{2}", "", clause)
        match = re.search(r"(?:(AUD|CNY|USD|EUR|GBP|NZD|JPY|KWD|HKD|SGD|CAD|KRW|BHD)\s*|[$¥￥]\s*)?(\d+(?:\.\d+)?)(?:\s*(AUD|CNY|USD|EUR|GBP|NZD|JPY|KWD|HKD|SGD|CAD|KRW|BHD))?", cleaned, re.I)
        if not match: continue
        clause_day,clause_basis = date_for(clause,zone,clock) if re.search(r"今天|昨天|前天|明天|上周五|today|yesterday|tomorrow|last friday|\d{4}-\d{2}-\d{2}",clause,re.I) else (day,basis)
        amount_candidates=re.findall(r"(?<![\d-])\d+(?:\.\d+)?(?![\d-])",cleaned)
        explicit = (match[1] or match[3] or "").upper()
        code = explicit or (selected["currency"] if selected else currency)
        account = selected["id"] if selected and selected["currency"] == code else None
        income = bool(re.search(r"赚|收入|工资|到账|earn|salary|income|received", clause, re.I))
        kind = "income" if income else "expense"
        if re.search(r"借款|loan|transfer|转账|还款|repay|赎回|redeem|分红|dividend", clause, re.I): kind = "needs_classification"
        merchant = "咖啡" if "咖啡" in clause else "Coffee" if re.search(r"coffee", clause, re.I) else "兼职" if "兼职" in clause else "Salary" if re.search(r"salary", clause, re.I) else "Part-time work" if re.search(r"part.?time", clause, re.I) else None
        if not merchant:
            merchant = re.sub(r"今天|昨天|我|买了?|花了?|支出|收入|记一笔|赚了?|元|dollars?|\b(today|yesterday|spent|paid|record|earned|income|expense)\b", "", cleaned, flags=re.I)
            merchant = merchant.replace(match[0], "").strip(" :$¥￥") or "Manual record"
        category = next((label for pattern, label in CATEGORIES if re.search(pattern, clause, re.I)), "Income" if income else "Other")
        fields = {"kind": kind, "amount": match[2] if len(amount_candidates)==1 else None, "currency": code, "date": clause_day, "merchant": merchant[:120], "category": category,
                  "account_id": account, "counterparty_id": None, "refund_of": None, "external_id": None, "mock": False}
        operations.append({"op_id": f"o{len(operations)+1}", "kind": "create_draft", "fields": fields, "selected": True,
                           "source_span": clause, "date_basis": clause_basis, "resource_type": "candidate", "amount_candidates": amount_candidates})
    require(len(operations) <= 20, "COMMAND_LIMIT", "每次最多20个操作。")
    return {"intent": "create_transactions", "object": "record", "operations": operations,
            "status": "PARSED" if operations else "NEEDS_CLARIFICATION"}

def matching(text, candidates, date=None):
    """Names/IDs/recent IDs only; never pick an approximately equal amount."""
    aliases = ["咖啡", "coffee", "餐饮", "dining", "食品", "groceries", "房租", "housing", "兼职", "part-time", "工资", "salary"]
    words = [word for word in aliases if word in text.lower()]
    exact = [item for item in candidates if item["id"] in text]
    if exact:
        return [item for item in exact if not date or item.get("content",item).get("date") == date]
    result = []
    for item in candidates:
        values = item.get("content", item)
        names = " ".join(str(values.get(k, "")) for k in ("merchant", "category", "name")).lower()
        paired = {"咖啡": "coffee", "餐饮": "dining", "食品": "groceries", "房租": "housing", "兼职": "part-time", "工资": "salary"}
        matches = item["id"] in text or any(w in names or paired.get(w, w) in names for w in words) or any(str(values.get(k, "")) and str(values[k]).lower() in text.lower() for k in ("merchant", "name", "category"))
        if matches and (not date or values.get("date") == date): result.append(item)
    return result
