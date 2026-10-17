"""Presentation facts with scopes and raw evidence IDs; no neural inference."""
from decimal import Decimal
from datetime import date
from .domain import fmt, calculate

def enrich_state(state):
    enabled=state["consents"]["analysis"]
    period=state["period"]
    pending=len(state["drafts"])
    reversed_ids={e["reverses"] for e in state["transactions"] if e["reverses"]}
    effective=[e for e in state["transactions"] if not e["reverses"] and e["id"] not in reversed_ids and e["kind"]!="opening" and e["date"].startswith(period)]
    facts={}
    for tab in ("overview","ledger","planning","portfolio","reports","assistant","privacy"):
        facts[tab]={"scope":tab,"period":period,"as_of":state["as_of"],"severity":"INFO","completeness":"LIMITED","evidence_refs":[],"params":{}}
    facts["overview"].update(text_key="还有 {count} 条草稿待确认。",params={"count":pending},drilldown={"tab":"ledger","status":"draft"})
    facts["ledger"].update(text_key="本月有 {count} 笔有效记录；草稿单独列出。",params={"count":len(effective)},evidence_refs=[e["id"] for e in effective],drilldown={"tab":"ledger"})
    facts["planning"].update(text_key="预算与目标由你批准；未知资料不会按零计算。",drilldown={"tab":"planning"})
    budgets=(state.get("risk") or {}).get("budgets",[])
    overs=[b for b in budgets if Decimal(b["delta"])>0]
    if enabled and overs:
        b=max(overs,key=lambda b:Decimal(b["delta"]))
        facts["overview"].update(text_key="{category} 超出预算 {amount} {currency}，还有 {count} 条草稿。",params={"category":b["category"],"amount":b["delta"],"currency":state["planning"].get("currency","AUD"),"count":pending},severity="WATCH",drilldown={"tab":"ledger","category":b["category"],"currency":state["planning"].get("currency","AUD")})
        facts["planning"].update(text_key="{category} 超出预算 {amount} {currency}。",params={"category":b["category"],"amount":b["delta"],"currency":state["planning"].get("currency","AUD")},severity="WATCH",drilldown=facts["overview"]["drilldown"])
    missing=sum(1 for x in state.get("investments",[]) if not x.get("latest") or x["latest"].get("cost_basis") is None)
    facts["portfolio"].update(text_key="{count} 项本地投资，{missing} 项成本未知。",params={"count":len(state.get("investments",[])),"missing":missing},drilldown={"tab":"portfolio"})
    saved=[x for x in state["statements"] if x["period"]==period]
    facts["reports"].update(text_key="{period} 有 {count} 个固定版本；当前 {pending} 条草稿不计入账单。",params={"period":period,"count":len(saved),"pending":pending},drilldown={"tab":"reports"})
    facts["assistant"].update(text_key="可以记录、查询和修正本地条目；所有正式变更需确认。",drilldown={"tab":"assistant"})
    facts["privacy"].update(text_key="数据留在本机。分析：{analysis}；凭证识别：{ocr}。",params={"analysis":"已开启" if enabled else "未开启","ocr":"已开启" if state["consents"]["ocr"] else "未开启"},drilldown={"tab":"privacy"})
    if not enabled:
        for tab in ("overview","ledger","planning","portfolio","reports"):
            facts[tab].update(text_key="已保存记录；开启本地分析后查看摘要与关系图。",params={},severity="DATA_GAP",drilldown={"tab":"privacy"})
    state["investment_summary"]=[{"currency":p["currency"],"current_value":p["total"],"known_count":sum(1 for x in p["positions"] if x.get("cost_basis") is not None),"unknown_count":sum(1 for x in p["positions"] if x.get("cost_basis") is None)} for p in state.get("portfolio",[])] if enabled else []
    state["page_insights"]=facts
    state["command_capabilities"]={"parser":"local-rule-1","max_operations":20,"supported":["create_transactions","query","update_record","delete_record","budget","goal","account_metadata"],"cloud":False}
    state["data_counts"]={"accounts":len(state["accounts"]),"drafts":pending,"events":len(state["transactions"]),"investments":len(state.get("investments",[])),"statements":len(state["statements"])}
    state["cash_bridge"]=[]
    state["month_comparison"]=[]
    if enabled:
        cash_ids={a["id"] for a in state["accounts"] if a["type"]=="cash"}
        grouped={}
        for e in state["transactions"]:
            if not e["date"].startswith(period) or e["kind"]=="opening":continue
            key=(e["currency"],e["kind"])
            grouped[key]=grouped.get(key,Decimal(0))+sum((Decimal(v) for account,v in e["postings"] if account in cash_ids),Decimal(0))
        state["cash_bridge"]=[{"currency":c,"kind":k,"amount":fmt(value,c)} for (c,k),value in grouped.items()]
        year,month=map(int,period.split("-"));cursor=year*12+month-1
        for offset in (2,1,0):
            current=cursor-offset;p=f"{current//12:04d}-{current%12+1:02d}"
            if any(e["date"].startswith(p) and e["kind"]!="opening" for e in state["transactions"]):
                state["month_comparison"].extend({**x,"period":p,"coverage":"UNKNOWN"} for x in calculate(state["transactions"],state["accounts"],p))
    return state
