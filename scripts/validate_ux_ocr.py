"""Reproducible actual local OCR on three independently authored synthetic images.
No financial screenshots, customer data, or cloud service are used.
"""
import base64
import json
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.api.store import Store

ROOT=Path(__file__).resolve().parents[1]
EXPECTED={
    "receipt":[{"amount":"7.00","currency":"AUD","date":"2026-09-10","kind":"expense","merchant":"咖啡生活馆"}],
    "bank":[{"amount":"200.00","currency":"AUD","date":"2026-09-10","kind":"income"},{"amount":"7.00","currency":"AUD","date":"2026-09-11","kind":"expense"},{"amount":"50.00","currency":"AUD","date":"2026-09-12","kind":"transfer"}],
    "investment":[{"name":"中文基金","currency":"CNY","observed_at":"2026-09-30T00:00:00+00:00","market_value":"20500.00","cost_basis":"20000.00","daily_gain":"60.00","reported_gain":"500.00","reported_semantics":"CUMULATIVE"}],
}

def run():
    report={"date":"2026-10-15","source":"Authored synthetic PNGs; separate from E0/template fixtures", "engine":"Tesseract chi_sim+eng; psm 6; local only","scope":"Three clean layouts, not a representative bank/vendor accuracy study. All candidates need human review.","samples":[],"passed":True}
    with tempfile.TemporaryDirectory(prefix="wallet-ocr-validation-") as directory:
        store=Store(Path(directory)/"synthetic.sqlite3");session="ocr-validation"
        payload={"analysis":True,"ocr":True};c=store.challenge({"purpose":"consents","resource_id":"consents","payload":payload},session)
        store.save_settings("consents",{"nonce":c["nonce"],"content_hash":c["content_hash"],"payload":payload},session)
        account=store.create_account({"name":"Synthetic AUD","currency":"AUD","opened_on":"2026-09-01"})["id"]
        for name,expected in EXPECTED.items():
            start=time.perf_counter();image=ROOT/f"tests/fixtures/evidence/{name}.png"
            plan=store.evidence_import({"image_base64":base64.b64encode(image.read_bytes()).decode(),"doc_type":name,**({"account_id":account} if name!="investment" else {})},session)
            ops=plan["operations"];matches=[]
            for index,fields in enumerate(expected):
                actual=ops[index]["fields"] if index<len(ops) else {}
                matches.extend({"row":index+1,"field":key,"expected":value,"actual":actual.get(key),"correct":actual.get(key)==value} for key,value in fields.items())
            passed=len(ops)==len(expected) and all(x["correct"] for x in matches) and bool(plan["evidence"]["word_boxes"])
            report["samples"].append({"name":name,"image":str(image.relative_to(ROOT)),"seconds":round(time.perf_counter()-start,4),"candidate_rows":len(ops),"expected_rows":len(expected),"field_checks":matches,"unknown_or_review_fields":[o.get("errors",[]) for o in ops],"word_boxes":len(plan["evidence"]["word_boxes"]),"raw_text":plan["evidence"]["raw_text"],"passed":passed})
            report["passed"] &= passed
        # Saving an unknown observation must require user selection, never invent an investment/cash event.
        fund=plan
        chosen=store.command_patch(fund["command_id"],{"version":fund["version"],"operations":[{"op_id":"o1","selected":True,"resource_id":"new"}]},session)
        c=store.challenge({"purpose":"command_apply","resource_id":chosen["command_id"]},session)
        store.command_apply(chosen["command_id"],{"nonce":c["nonce"],"content_hash":c["content_hash"],"plan_version":chosen["version"]},session,"ocr-fund-apply-0001")
        state=store.state("2026-09");report["fund_cash_events_created"]=len(state["transactions"])
        report["passed"] &= report["fund_cash_events_created"]==0
    target=ROOT/"reports/ux-ocr-validation.json";target.write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps({"passed":report["passed"],"samples":len(report["samples"]),"report":str(target.relative_to(ROOT))}))
    return 0 if report["passed"] else 1
if __name__=="__main__":sys.exit(run())
