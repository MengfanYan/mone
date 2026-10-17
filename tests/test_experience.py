import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from services.api.store import Store
from services.api.domain import Problem
from services.api.investments import performance

class ExperienceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.store=Store(Path(self.temp.name)/"test.sqlite3");self.session="experience-session"
        payload={"analysis":True,"ocr":True};c=self.challenge("consents","consents",payload)
        self.store.save_settings("consents",{**self.credentials(c),"payload":payload},self.session)
        self.accounts={code:self.store.create_account({"name":code+" cash","currency":code,"type":"cash","opening_balance":"1000","opened_on":"2026-01-01"})["id"] for code in ("AUD","CNY")}
    def tearDown(self):self.temp.cleanup()
    def challenge(self,purpose,resource,payload=None):return self.store.challenge({"purpose":purpose,"resource_id":resource,**({"payload":payload} if payload is not None else {})},self.session)
    def credentials(self,c):return {"nonce":c["nonce"],"content_hash":c["content_hash"]}
    def apply(self,plan,key="apply-key-0001",duplicate_reason=None):
        c=self.challenge("command_apply",plan["command_id"])
        return self.store.command_apply(plan["command_id"],{**self.credentials(c),"plan_version":plan["version"],**({"duplicate_resolutions":[{"candidate_id":r["candidate_id"],"reason":duplicate_reason} for r in c["preview"].get("duplicate_review",[])]} if duplicate_reason else {})},self.session,key)
    def test_multi_currency_create_correct_delete_and_queries(self):
        p=self.store.command_plan({"text":"我今天买咖啡花了7dollars，兼职赚了200元。","period":"2026-09"},self.session)
        self.assertEqual(len(p["operations"]),2);self.assertEqual(p["status"],"NEEDS_CLARIFICATION")
        p=self.store.command_patch(p["command_id"],{"version":p["version"],"operations":[{"op_id":o["op_id"],"fields":{"currency":code,"account_id":self.accounts[code],"date":"2026-09-10"}} for o,code in zip(p["operations"],("AUD","CNY"))]},self.session)
        self.assertEqual(p["status"],"READY")
        saved=self.store.command_drafts(p["command_id"],{"version":p["version"]},self.session,"draft-key-0001")
        self.assertEqual(len(saved["results"]),2)
        p=self.store.command_get(p["command_id"],self.session);result=self.apply(p)
        self.assertEqual(len(result["results"]),2)
        state=self.store.state("2026-09");by={s["currency"]:s for s in state["summary"]}
        self.assertEqual(by["AUD"]["expenses"],"7.00");self.assertEqual(by["CNY"]["income"],"200.00")
        correction=self.store.command_plan({"text":"咖啡不是7，是6.50"},self.session)
        self.assertEqual(correction["status"],"READY");self.apply(correction,"correct-key-001")
        self.assertEqual(next(s for s in self.store.state("2026-09")["summary"] if s["currency"]=="AUD")["expenses"],"6.50")
        query=self.store.command_plan({"text":"查咖啡","period":"2026-09"},self.session)
        self.assertEqual(len(query["results"]),1)
        removal=self.store.command_plan({"text":"删除咖啡"},self.session);self.apply(removal,"delete-key-0001")
        self.assertEqual(next(s for s in self.store.state("2026-09")["summary"] if s["currency"]=="AUD")["expenses"],"0.00")
    def test_batch_failure_rolls_back_nonce_and_every_event(self):
        drafts=[]
        for day in ("2026-09-10","2099-01-01"):
            d=self.store.create_draft({"amount":"7","currency":"AUD","account_id":self.accounts["AUD"],"date":day,"merchant":"Coffee","kind":"expense","category":"Dining"});drafts.append({"id":d["id"],"version":1})
        payload={"drafts":drafts};c=self.challenge("confirm_draft_batch","batch",payload)
        before=self.store.state("2026-09")
        with self.assertRaises(Problem):self.store.batch_confirm({**self.credentials(c),"payload":payload},self.session,"batch-failed-001")
        after=self.store.state("2026-09");self.assertEqual(after["transactions"],before["transactions"]);self.assertEqual(len(after["drafts"]),2)
        with self.store.connect() as db:self.assertEqual(db.execute("SELECT consumed FROM challenges WHERE nonce=?",(c["nonce"],)).fetchone()[0],0)
    def test_atomic_correction_fault_and_replay_guard(self):
        p=self.store.command_plan({"text":"Coffee 7 AUD","account_id":self.accounts["AUD"]},self.session);r=self.apply(p)
        event=r["results"][0]["resource_id"];before=self.store.state(p["operations"][0]["fields"]["date"][:7])
        fields=p["operations"][0]["fields"];payload={"content":{**fields,"amount":"6.50"}}
        c=self.challenge("correct_event",event,payload);data={**self.credentials(c),"payload":payload}
        real=self.store.write_event;calls=[]
        def failure(*args,**kwargs):
            calls.append(1)
            if len(calls)==2:raise RuntimeError("injected second event failure")
            return real(*args,**kwargs)
        with patch.object(self.store,"write_event",side_effect=failure):
            with self.assertRaises(RuntimeError):self.store.correct_event(event,data,self.session,"correction-key-1")
        self.assertEqual(self.store.state(before["period"])["transactions"],before["transactions"])
        result=self.store.correct_event(event,data,self.session,"correction-key-1")
        self.assertEqual(self.store.correct_event(event,data,self.session,"correction-key-1"),result)
        with self.assertRaises(Problem):self.store.correct_event(event,{**data,"payload":{"content":{**fields,"amount":"5"}}},self.session,"correction-key-1")
    def test_session_ownership_and_analysis_off_basic_commands(self):
        p=self.store.command_plan({"text":"Coffee 7 AUD","account_id":self.accounts["AUD"]},self.session)
        with self.assertRaises(Problem):self.store.command_get(p["command_id"],"different-session")
        with self.assertRaises(Problem):self.store.challenge({"purpose":"command_apply","resource_id":p["command_id"]},"different-session")
        payload={"analysis":False,"ocr":False};c=self.challenge("consents","consents",payload);self.store.save_settings("consents",{**self.credentials(c),"payload":payload},self.session)
        self.apply(p);state=self.store.state("2026-10");self.assertIsNone(state["summary"])
        self.assertTrue(self.store.command_plan({"text":"查咖啡"},self.session)["results"])
        with self.assertRaises(Problem):self.store.evidence_import({"text":"Coffee Total 7 AUD","doc_type":"receipt"},self.session)
    def test_evidence_rows_and_fund_semantics(self):
        bank=self.store.evidence_import({"doc_type":"bank","account_id":self.accounts["AUD"],"text":"2026-09-10 工资 收入 200.00 AUD 余额 1200.00\n2026-09-11 咖啡 支出 7.00 AUD 余额 1193.00\n2026-09-12 转账 50.00 AUD 余额 1143.00"},self.session)
        self.assertEqual(len(bank["operations"]),3);self.assertEqual([o["fields"]["amount"] for o in bank["operations"]],["200.00","7.00","50.00"])
        self.assertIn("counterparty_id",bank["operations"][2].get("errors",[])) if bank["operations"][2].get("errors") else None
        fund=self.store.evidence_import({"doc_type":"investment","text":"基金名称: 中文基金\n观察日: 2026-09-30\n币种 CNY\n市值 20500.00\n成本 20000.00\n今日收益 60.00\n累计收益 500.00"},self.session)
        op=fund["operations"][0];self.assertEqual(op["fields"]["reported_gain"],"500.00");self.assertEqual(op["fields"]["daily_gain"],"60.00")
        p=self.store.command_patch(fund["command_id"],{"version":fund["version"],"operations":[{"op_id":"o1","resource_id":"new","selected":True}]},self.session)
        self.apply(p,"fund-apply-001");state=self.store.state("2026-09")
        self.assertEqual(len(state["investments"]),1);self.assertEqual(len(state["transactions"]),2) # only opening entries
        hist=self.store.investment_performance(state["investments"][0]["id"])
        self.assertEqual(hist["points"][0]["unrealized"],"500.00")
        self.assertEqual(hist["reported_points"][0]["amount"],"500.00")
    def test_investment_profit_capital_distribution_sale_and_cost_unknown(self):
        entry={"id":"case","currency":"CNY","history_complete":True}
        vs=[{"id":str(i),"observed_at":f"2026-09-{i+1:02d}T00:00:00+00:00","version":1,"content":{"market_value":v,"cost_basis":b,"fees_taxes_known":True,"evidence":{"source":"synthetic"}}} for i,(v,b) in enumerate([("1000","1000"),("1100","1000"),("1600","1500"),("1700","1500"),("1150","1000")])]
        es=[{"id":"buy","observed_at":vs[2]["observed_at"],"content":{"type":"buy","amount":"500","cost_added":"500","fee":"0","tax":"0"}}, {"id":"dividend","observed_at":vs[2]["observed_at"],"content":{"type":"distribution","amount":"20","fee":"0","tax":"0"}}, {"id":"sale","observed_at":vs[4]["observed_at"],"content":{"type":"sell","amount":"550","cost_allocated":"500","fee":"5","tax":"0"}}]
        output=performance(entry,vs,es,[])
        self.assertEqual([p["net_gain"] for p in output["points"]],["0.00","100.00","120.00","220.00","215.00"])
        self.assertTrue(all(p["net_quality"]=="VERIFIED_HISTORY" for p in output["points"]))
        vs[0]["content"]["cost_basis"]=None
        self.assertIsNone(performance(entry,vs[:1],[],[])["points"][0]["net_gain"])
    def test_stable_planning_patches_preserve_other_fields_and_invalidate_versions(self):
        plan={"currency":"AUD","monthly_income":"5000","essential_spend":"2000","earmarked":"50","budgets":[{"category":"Dining","amount":"100"}],"goals":[{"name":"Trip","target":"1000","saved":"10","deadline":"2027-09-01"}]}
        c=self.challenge("planning","planning",plan);self.store.save_settings("planning",{**self.credentials(c),"payload":plan},self.session)
        before=self.store.state("2026-09")["planning"];budget=before["budgets"][0]
        p=self.store.command_plan({"text":"change Dining budget to 120"},self.session);self.apply(p,"budget-change-001")
        after=self.store.state("2026-09")["planning"]
        self.assertEqual(after["monthly_income"],before["monthly_income"]);self.assertEqual(after["goals"],before["goals"])
        self.assertEqual(after["budgets"][0]["id"],budget["id"]);self.assertEqual(after["budgets"][0]["amount"],"120.00");self.assertEqual(after["budgets"][0]["version"],budget["version"]+1)
        g=self.store.command_plan({"text":"change Trip goal to 1200"},self.session);self.apply(g,"goal-change-001")
        updated=self.store.state("2026-09")["planning"];self.assertEqual(updated["goals"][0]["saved"],"10.00");self.assertEqual(updated["budgets"],after["budgets"])
        new=self.store.command_plan({"text":"add Housing budget 500 AUD","currency":"AUD"},self.session);result=self.apply(new,"create-budget-001")
        self.assertIn(result["results"][0]["resource_id"],[x["id"] for x in self.store.state("2026-09")["planning"]["budgets"]])

    def test_account_rename_archive_preserves_opening_and_text_create(self):
        before=self.store.state("2026-09")["transactions"]
        p=self.store.command_plan({"text":"AUD cash账户改名为生活钱包"},self.session);self.apply(p,"account-rename-001")
        self.assertEqual(self.store.state("2026-09")["accounts"][0]["name"],"生活钱包")
        p=self.store.command_plan({"text":"归档生活钱包账户"},self.session);self.apply(p,"account-archive-001")
        self.assertTrue(self.store.state("2026-09")["accounts"][0]["archived"]);self.assertEqual(self.store.state("2026-09")["transactions"],before)
        with self.assertRaises(Problem):self.store.create_draft({"amount":"7","currency":"AUD","account_id":self.accounts["AUD"],"date":"2026-09-10","merchant":"Coffee"})
        p=self.store.command_plan({"text":"add Savings account 100 USD","currency":"USD"},self.session);self.apply(p,"account-create-001")
        self.assertEqual(len(self.store.state("2026-09")["accounts"]),3)

    def test_exact_ids_ambiguity_recent_context_and_grouped_amounts(self):
        ids=[]
        for n in range(2):
            p=self.store.command_plan({"text":"Coffee 7 AUD","account_id":self.accounts["AUD"]},self.session);ids.append(self.apply(p,f"coffee-create-00{n}",duplicate_reason="Two distinct coffee purchases in the synthetic fixture")["results"][0]["resource_id"])
        p=self.store.command_plan({"text":"change Coffee to 6.50"},self.session);self.assertEqual(p["status"],"NEEDS_CLARIFICATION");self.assertEqual(len(p["operations"][0]["targets"]),2)
        p=self.store.command_plan({"text":"change just Coffee to 6.50","recent_resource_ids":[ids[-1]]},self.session);self.assertEqual(p["operations"][0]["resource_id"],ids[-1])
        p=self.store.command_plan({"text":"delete Coffee "+ids[0]},self.session);self.assertEqual(p["operations"][0]["resource_id"],ids[0])
        p=self.store.command_plan({"text":"Salary 1,200.50 AUD","account_id":self.accounts["AUD"]},self.session);self.assertEqual(len(p["operations"]),1);self.assertEqual(p["operations"][0]["fields"]["amount"],"1200.50")
        p=self.store.command_plan({"text":"Coffee 7 AUD"},self.session);cancelled=self.store.command_cancel(p["command_id"],{"version":p["version"]},self.session);self.assertEqual(cancelled["status"],"CANCELLED")
        with self.assertRaises(Problem):self.challenge("command_apply",p["command_id"])

    def test_refund_dependency_prevents_correction_and_delete(self):
        p=self.store.command_plan({"text":"Coffee 7 AUD","account_id":self.accounts["AUD"]},self.session);event=self.apply(p)["results"][0]["resource_id"]
        content={**p["operations"][0]["fields"],"amount":"2","kind":"refund","refund_of":event}
        d=self.store.create_draft(content);c=self.challenge("confirm_draft",d["id"]);self.store.confirm_draft(d["id"],self.credentials(c),self.session)
        for text in ("delete "+event,"change "+event+" to 6"):
            command=self.store.command_plan({"text":text},self.session)
            with self.assertRaises(Problem) as error:self.challenge("command_apply",command["command_id"])
            self.assertEqual(error.exception.code,"REFUND_DEPENDENCY")

    def test_investment_revisions_and_reported_only_history_are_not_duplicate_holdings(self):
        def change(resource,payload,key):
            c=self.challenge("investment_change",resource,payload)
            return self.store.investment_change(resource,{**self.credentials(c),"payload":payload},self.session,key)
        result=change("new",{"action":"create","entry":{"name":"History fund","currency":"CNY"},"valuation":{"observed_at":"2026-09-01T00:00:00Z","market_value":"100","cost_basis":"80"}},"invest-create-001")
        id=result["resource_id"];entry=self.store.state("2026-09")["investments"][0]
        same={"action":"valuation","version":entry["version"],"valuation":{"observed_at":"2026-09-01T00:00:00Z","market_value":"110","cost_basis":"80"}}
        with self.assertRaises(Problem):self.challenge("investment_change",id,same)
        same["valuation"]["supersedes"]=entry["latest"]["id"];change(id,same,"invest-revise-001")
        change(id,{"action":"valuation","version":2,"valuation":{"observed_at":"2026-09-02T00:00:00Z","reported_gain":"31","reported_semantics":"CUMULATIVE"}},"reported-only-001")
        state=self.store.state("2026-09");self.assertEqual(len(state["holdings"]),1);self.assertEqual(state["holdings"][0]["market_value"],"110.00")
        history=self.store.investment_performance(id);self.assertEqual(len(history["points"]),1);self.assertEqual(history["points"][0]["unrealized"],"30.00");self.assertEqual(history["points"][0]["unrealized_percent"],"37.5000");self.assertEqual(history["reported_points"][0]["amount"],"31.00")
        with self.store.connect() as db:self.assertEqual(len(self.store.investment_history(db,id)[1]["valuations"]),2)
        p=self.store.command_plan({"text":"update History fund investment to 120"},self.session);self.apply(p,"invest-command-001")
        self.assertEqual(len(self.store.state("2026-09")["investments"]),1)

    def test_duplicate_evidence_and_revocation_after_preview(self):
        data={"doc_type":"receipt","account_id":self.accounts["AUD"],"text":"Coffee\n2026-09-10\nTotal 7 AUD"}
        p=self.store.evidence_import(data,self.session);self.apply(p,"receipt-apply-001")
        duplicate=self.store.evidence_import(data,self.session);self.assertIn("DUPLICATE_SOURCE",duplicate["operations"][0]["errors"])
        p=self.store.evidence_import({**data,"text":data["text"].replace("7","8")},self.session);c=self.challenge("command_apply",p["command_id"])
        consent={"analysis":True,"ocr":False};cc=self.challenge("consents","consents",consent);self.store.save_settings("consents",{**self.credentials(cc),"payload":consent},self.session)
        with self.assertRaises(Problem):self.store.command_apply(p["command_id"],{**self.credentials(c),"plan_version":p["version"]},self.session,"revoked-apply-001")

    def test_new_dispatch_patch_origin_session_contract_and_terminal_cancel(self):
        from services.api.server import Application
        app=Application(self.store,"synthetic-experience-code");origin="http://localhost:3000"
        _,cookie=app.dispatch("POST","/v1/session",{},{"access_code":"synthetic-experience-code"},None,origin)
        token=cookie.split(";",1)[0]
        p,_=app.dispatch("POST","/v1/commands/plan",{},{"text":"Coffee 7 AUD","account_id":self.accounts["AUD"]},token,origin)
        changed,_=app.dispatch("PATCH","/v1/commands/"+p["command_id"],{},{"version":p["version"],"operations":[{"op_id":"o1","fields":{"amount":"6.50"}}]},token,origin)
        self.assertEqual(changed["operations"][0]["fields"]["amount"],"6.50")
        for cookie_value,source in (("",origin),(token,"https://evil.example")):
            with self.assertRaises(Problem):app.dispatch("PATCH","/v1/commands/"+p["command_id"],{},{},cookie_value,source)
        session=app.authenticate(token);cancelled=self.store.command_cancel(p["command_id"],{"version":changed["version"]},session)
        with self.assertRaises(Problem):self.store.command_patch(p["command_id"],{"version":cancelled["version"],"operations":[]},session)

    def test_cost_adjusted_distribution_and_capitalized_fee_never_double_count(self):
        entry={"id":"cost-chain","currency":"AUD","history_complete":True}
        points=[{"id":"first","version":1,"observed_at":"2026-09-01T00:00:00+00:00","content":{"market_value":"1000","cost_basis":"1000","fees_taxes_known":True,"evidence":{}}},{"id":"second","version":1,"observed_at":"2026-09-02T00:00:00+00:00","content":{"market_value":"1090","cost_basis":"1085","fees_taxes_known":True,"evidence":{}}}]
        events=[{"id":"distribution","observed_at":points[1]["observed_at"],"content":{"type":"distribution","amount":"20","fee":"0","tax":"0","distribution_in_cost":True}},{"id":"buy","observed_at":points[1]["observed_at"],"content":{"type":"buy","amount":"100","fee":"5","tax":"0","capitalized":True}}]
        p=performance(entry,points,events,[])["points"][-1]
        self.assertEqual(p["net_gain"],"5.00");self.assertEqual(p["components"]["distribution"],"0.00");self.assertEqual(p["components"]["fees"],"0.00");self.assertTrue(p["basis_matches"])

    def test_legacy_migration_keeps_same_name_entries_separate_and_unknown_evidence_gaps(self):
        for _ in range(2):self.store.holding({"name":"Same name","issuer":"Synthetic","currency":"AUD","asset_type":"etf","quantity":"1","price":"100","observed_at":"2026-09-01T00:00:00Z"})
        snapshot=self.store.statement_get(self.store.statement("2026-09")["id"])["snapshot"]
        self.store=Store(self.store.path);state=self.store.state("2026-09")
        self.assertEqual(len(state["investments"]),2);self.assertEqual(len({p["id"] for p in state["investments"]}),2)
        self.assertEqual(self.store.statement_get(state["statements"][0]["id"])["snapshot"],snapshot)
        p=self.store.evidence_import({"doc_type":"investment","text":"基金名称: 未知基金\n累计收益 500"},self.session)
        op=p["operations"][0];self.assertIsNone(op["fields"]["currency"]);self.assertIsNone(op["fields"]["observed_at"]);self.assertEqual(p["status"],"NEEDS_CLARIFICATION")
        with self.assertRaises(Problem):self.challenge("command_apply",p["command_id"])

    def test_delete_during_slow_ocr_cannot_repopulate_private_tables(self):
        import threading
        from services.api.server import Application
        app=Application(self.store,"synthetic-experience-code");origin="http://localhost:3000"
        _,cookie=app.dispatch("POST","/v1/session",{},{"access_code":"synthetic-experience-code"},None,origin);token=cookie.split(";",1)[0]
        started=threading.Event();release=threading.Event();errors=[]
        def slow_extract(data):
            started.set();release.wait(3)
            return {"source":"synthetic_ocr","requires_ocr":True,"raw_text":"Coffee\n2026-09-10\nTotal 7 AUD","word_boxes":[],"quality":"USER_REVIEW","sha256":"synthetic-sha"}
        def import_request():
            try:app.dispatch("POST","/v1/evidence-imports",{},{"doc_type":"receipt","text":"Synthetic slow recognition","account_id":self.accounts["AUD"]},token,origin)
            except Problem as error:errors.append(error.code)
        with patch("services.api.evidence.extract",side_effect=slow_extract):
            thread=threading.Thread(target=import_request);thread.start()
            try:
                self.assertTrue(started.wait(2))
                c,_=app.dispatch("POST","/v1/confirmation-challenges",{},{"purpose":"privacy_delete","resource_id":"all","access_code":"synthetic-experience-code"},token,origin)
                app.dispatch("POST","/v1/privacy/delete",{},self.credentials(c),token,origin)
            finally:release.set();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(errors,["UNAUTHENTICATED"])
        with self.store.connect() as db:
            for table in ("accounts","command_plans","import_batches","drafts","investment_valuations"):
                self.assertEqual(db.execute("SELECT count(*) FROM "+table).fetchone()[0],0)

    def test_privacy_cleans_new_tables_and_migration_preserves_reports(self):
        self.store.command_plan({"text":"Coffee 7 AUD","account_id":self.accounts["AUD"]},self.session)
        before=self.store.statement("2026-09");self.store=Store(self.store.path)
        self.assertEqual(self.store.statement_get(before["id"])["snapshot"]["period"],"2026-09")
        c=self.challenge("privacy_export","all");export=self.store.privacy("export",self.credentials(c),self.session)
        self.assertIn("command_plans",export["data"])
        c=self.challenge("privacy_delete","all");self.store.privacy("delete",self.credentials(c),self.session)
        with self.store.connect() as db:
            for table in ("command_plans","import_batches","investments","investment_valuations","reported_performance_observations","investment_performance_events"):
                self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0],0)

if __name__=="__main__":unittest.main()
