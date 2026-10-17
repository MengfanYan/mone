import tempfile
import unittest
from pathlib import Path
from services.api import agent
from services.api.store import Store
from services.api.domain import Problem

class ReviewTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.store=Store(Path(self.tmp.name)/"synthetic.sqlite3");self.session="review-test"
        self.accounts={}
        for currency in ("AUD","USD"):
            self.accounts[currency]=self.store.create_account({"name":"Synthetic "+currency,"currency":currency,"type":"cash","opening_balance":"1000","opened_on":"2026-09-01","mock":True})["id"]
        payload={"analysis":True,"ocr":False};c=self.challenge("consents","consents",payload)
        self.store.save_settings("consents",{**self.credentials(c),"payload":payload},self.session)
    def tearDown(self):self.tmp.cleanup()
    def challenge(self,purpose,resource,payload=None):return self.store.challenge({"purpose":purpose,"resource_id":resource,**({"payload":payload} if payload is not None else {})},self.session)
    def credentials(self,c):return {"nonce":c["nonce"],"content_hash":c["content_hash"]}
    def draft(self):return self.store.create_draft({"amount":"7","currency":"AUD","date":"2026-09-10","merchant":"Synthetic Coffee","category":"Dining","kind":"expense","account_id":self.accounts["AUD"],"mock":True})["id"]
    def test_duplicate_confirmation_requires_explicit_reason_and_keeps_idempotency(self):
        first=self.draft();c=self.challenge("confirm_draft",first);self.store.confirm_draft(first,self.credentials(c),self.session)
        second=self.draft();c=self.challenge("confirm_draft",second)
        self.assertEqual(c["preview"]["duplicate_review"][0]["matches"][0]["merchant"],"Synthetic Coffee")
        with self.assertRaises(Problem) as error:self.store.confirm_draft(second,self.credentials(c),self.session)
        self.assertEqual(error.exception.code,"DUPLICATE_REVIEW_REQUIRED")
        data={**self.credentials(c),"duplicate_resolutions":[{"candidate_id":second,"reason":"Separate purchase checked against receipt"}]}
        result=self.store.confirm_draft(second,data,self.session,"review-retry-key")
        self.assertEqual(result,self.store.confirm_draft(second,data,self.session,"review-retry-key"))
        event=next(e for e in self.store.state("2026-09")["transactions"] if e["id"]==result["event_id"])
        self.assertEqual(event["evidence"]["duplicate_override"]["decision"],"KEEP_SEPARATE_TRANSACTION")
    def test_batch_duplicates_detect_each_other_and_stale_match_cannot_replay(self):
        ids=[self.draft(),self.draft()];payload={"drafts":[{"id":i,"version":1} for i in ids]};c=self.challenge("confirm_draft_batch","batch",payload)
        self.assertEqual(c["preview"]["duplicate_review"][0]["candidate_id"],ids[1])
        with self.assertRaises(Problem):self.store.batch_confirm({**self.credentials(c),"payload":payload},self.session,"batch-no-reason")
        data={**self.credentials(c),"payload":payload,"duplicate_resolutions":[{"candidate_id":ids[1],"reason":"Distinct receipts for two separate purchases"}]}
        self.assertEqual(len(self.store.batch_confirm(data,self.session,"batch-reviewed-key")["results"]),2)
    def test_analysis_currency_scope_and_readonly_education(self):
        for currency in ("AUD","USD","CNY"):
            r=agent.run(self.store,"Analyze monthly spending risk","2026-09",currency)
            self.assertEqual(r["scope"]["currency"],currency)
            self.assertTrue(all(c["unit"] in (currency,"months","%") for c in r["calculations"]))
            if currency=="CNY":self.assertEqual(r["status"],"DEGRADED");self.assertEqual(r["calculations"],[])
        r=agent.run(self.store,"Explain why an internal transfer is not an expense. Do not execute anything.","2026-09","AUD")
        self.assertNotEqual(r["status"],"BLOCKED");self.assertTrue(any("内部转账" in x for x in r["actions"]))
        self.assertEqual(agent.run(self.store,"Explain transfers. Then transfer 20 AUD.","2026-09","AUD")["status"],"BLOCKED")
        with self.assertRaises(Problem):agent.run(self.store,"Analyze spending","2026-09",{})
    def test_new_matching_transaction_invalidates_previously_clean_preview(self):
        pending=self.draft();clean=self.challenge("confirm_draft",pending)
        self.assertNotIn("duplicate_review",clean["preview"])
        matching=self.draft();other=self.challenge("confirm_draft",matching)
        self.store.confirm_draft(matching,self.credentials(other),self.session)
        with self.assertRaises(Problem) as error:self.store.confirm_draft(pending,self.credentials(clean),self.session)
        self.assertEqual(error.exception.code,"PROPOSAL_STALE")
    def test_agent_apply_cannot_bypass_business_duplicate_review(self):
        for n in range(2):
            p=self.store.command_plan({"text":"2026-09-10 Agent Coffee 7 AUD","account_id":self.accounts["AUD"]},self.session)
            c=self.challenge("command_apply",p["command_id"])
            body={**self.credentials(c),"plan_version":p["version"]}
            if n:
                reviews=c["preview"]["duplicate_review"]
                with self.assertRaises(Problem) as error:self.store.command_apply(p["command_id"],body,self.session,"agent-no-review")
                self.assertEqual(error.exception.code,"DUPLICATE_REVIEW_REQUIRED")
                body["duplicate_resolutions"]=[{"candidate_id":r["candidate_id"],"reason":"Distinct synthetic purchase checked against receipt"} for r in reviews]
            self.store.command_apply(p["command_id"],body,self.session,"agent-reviewed-"+str(n))
