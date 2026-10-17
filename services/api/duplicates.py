"""Business duplicate review, separate from transport idempotency."""
from decimal import Decimal
from .domain import require


def signature(value):
    return tuple(value.get(k) for k in ("date","currency","merchant","account_id","kind"))+(Decimal(value["amount"]),)


def decorate(preview, purpose, resource, events, ledger_version):
    if purpose == "confirm_draft": candidates=[(resource,preview)]
    elif purpose == "confirm_draft_batch": candidates=[(d["id"],d["content"]) for d in preview["drafts"]]
    elif purpose == "command_apply": candidates=[(o["op_id"],o["fields"]) for o in preview["operations"] if o["kind"]=="create_draft"]
    else: return preview
    reversed_ids={e["reverses"] for e in events if e.get("reverses")}
    prior=[e for e in events if not e.get("reverses") and e["id"] not in reversed_ids and e["kind"]!="opening"]
    reviews=[]
    for candidate_id,value in candidates:
        matches=[{"id":e["id"],**{k:e.get(k) for k in ("date","amount","currency","merchant","account_id","kind")},"source":e.get("evidence",{}).get("source") or ("selected_batch" if e["id"].startswith("candidate:") else "confirmed_ledger")} for e in prior if signature(e)==signature(value)]
        if matches: reviews.append({"candidate_id":candidate_id,"candidate":value,"matches":matches,"reason_code":"SAME_DATE_AMOUNT_CURRENCY_MERCHANT_ACCOUNT_KIND"})
        prior.append({**value,"id":"candidate:"+candidate_id})
    return {**preview,"duplicate_review":reviews,"duplicate_ledger_version":ledger_version} if reviews else preview


def validate(preview, resolutions):
    reviews=preview.get("duplicate_review",[])
    if not reviews and resolutions is None: return
    require(isinstance(resolutions,list) and len(resolutions)==len(reviews),"DUPLICATE_REVIEW_REQUIRED","Review duplicate matches and explain why each is a separate transaction.",409)
    require(all(isinstance(r,dict) and set(r)=={"candidate_id","reason"} and isinstance(r["candidate_id"],str) and isinstance(r["reason"],str) and 5<=len(r["reason"].strip())<=500 for r in resolutions),"DUPLICATE_REVIEW_REQUIRED","Provide a separate-transaction reason of 5–500 characters.",409)
    require({r["candidate_id"] for r in resolutions}=={r["candidate_id"] for r in reviews} and len({r["candidate_id"] for r in resolutions})==len(resolutions),"DUPLICATE_REVIEW_REQUIRED","Duplicate review must match the current candidates.",409)


def resolution(data, candidate_id):
    return next(({"reason":r["reason"].strip(),"decision":"KEEP_SEPARATE_TRANSACTION"} for r in data.get("duplicate_resolutions",[]) if r["candidate_id"]==candidate_id),None)
