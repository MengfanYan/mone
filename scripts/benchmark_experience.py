"""Timing of bounded local synthetic commands, not HTTP/browser latency."""
import json
import math
import sys
import tempfile
import time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from services.api.store import Store
from services.api.domain import validate_event, postings
ROOT=Path(__file__).resolve().parents[1]
def timed(action,n=40):
    values=[]
    for _ in range(n):
        start=time.perf_counter();action();values.append((time.perf_counter()-start)*1000)
    values.sort();return {"runs":n,"p95_ms":round(values[math.ceil(n*.95)-1],3),"max_ms":round(values[-1],3)}
def run():
    report={"date":"2026-10-15","scope":"Local Store calls on synthetic databases; excludes HTTP, browser refresh and human confirmation. Cold setup excluded.","sizes":[]}
    for size in (100,500):
        with tempfile.TemporaryDirectory(prefix="wallet-ux-benchmark-") as directory:
            store=Store(Path(directory)/"synthetic.sqlite3");session="benchmark"
            a=store.create_account({"name":"Synthetic AUD","currency":"AUD","opened_on":"2026-09-01"})["id"]
            with store.transaction() as db:
                for i in range(size):
                    content=validate_event({"amount":"7.50","currency":"AUD","date":"2026-09-10","merchant":f"Coffee {i}","category":"Dining","account_id":a},store.account_map(db))
                    store.write_event(db,content,postings(content))
            consent={"analysis":True,"ocr":True};c=store.challenge({"purpose":"consents","resource_id":"consents","payload":consent},session);store.save_settings("consents",{"nonce":c["nonce"],"content_hash":c["content_hash"],"payload":consent},session)
            parse=timed(lambda:store.command_plan({"text":"Coffee 7 AUD","account_id":a},session))
            query=timed(lambda:store.command_plan({"text":"find this month Dining","period":"2026-09"},session))
            def confirm():
                # Each command confirms a distinct immutable event with a fresh nonce/key.
                p=store.command_plan({"text":"Coffee 8 AUD","account_id":a},"confirmation-benchmark");c=store.challenge({"purpose":"command_apply","resource_id":p["command_id"]},"confirmation-benchmark")
                store.command_apply(p["command_id"],{"nonce":c["nonce"],"content_hash":c["content_hash"],"plan_version":p["version"]},"confirmation-benchmark",c["nonce"])
                store.state(p["operations"][0]["fields"]["date"][:7])
            confirm_results=timed(confirm,20)
            report["sizes"].append({"events":size,"plan":parse,"query":query,"plan_preview_commit_state":confirm_results})
    p=ROOT/"reports/ux-performance.json";p.write_text(json.dumps(report,indent=2)+"\n");print(json.dumps(report));return 0
if __name__=="__main__":sys.exit(run())
