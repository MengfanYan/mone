import os
import time
import unittest
import tempfile
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

from services.cloud.auth import Actor
from services.cloud.app import session_check
from services.cloud.store import CloudStore, create_pool
from services.cloud.controls import dispatch, reserve, settle, uncertain
from services.api.domain import Problem
from services.cloud.journal import FileJournal, Signer


class ControlsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.pool=create_pool(os.environ["CLOUD_TEST_DSN"],test=True)
    @classmethod
    def tearDownClass(cls): cls.pool.close()
    def setUp(self):
        self.actor=Actor(str(uuid4()),"synthetic-first-session","synthetic@example.test",{"exp":time.time()+3600})
        self.a=CloudStore(self.pool,self.actor.user_id);self.b=CloudStore(self.pool,str(uuid4()))
        session_check(self.a,self.actor)
        control=tempfile.TemporaryDirectory();self.addCleanup(control.cleanup)
        self.a.deletion_journal=FileJournal(control.name,Signer({"v1":b"synthetic-deletion-key-32-characters"},"v1"))
    def test_one_hundred_concurrent_reservations_cannot_overspend(self):
        def task(i):
            try: return reserve(self.a,"synthetic-task-"+str(i),"2026-09",1,10)
            except Problem as e: return e.code
        with ThreadPoolExecutor(max_workers=16) as workers: results=list(workers.map(task,range(100)))
        self.assertEqual(sum(isinstance(r,dict) for r in results),10)
        self.assertEqual(results.count("QUOTA_EXCEEDED"),90)
    def test_unknown_provider_outcome_stays_reserved_and_settlement_is_idempotent(self):
        r=reserve(self.a,"one-task","2026-09",10,10);uncertain(self.a,r["id"])
        with self.assertRaises(Problem): reserve(self.a,"two-task","2026-09",1,10)
        first=settle(self.a,r["id"],4,provider="synthetic",request_id="synthetic-provider-id")
        self.assertEqual(first,settle(self.a,r["id"],4,provider="synthetic",request_id="synthetic-provider-id"))
        with self.a.connect() as db: self.assertEqual(db.db.execute("SELECT count(*) FROM usage_events").fetchone()["count"],1)
        self.assertEqual(reserve(self.a,"two-task","2026-09",6,10)["status"],"reserved")
    def test_rule_applies_only_to_future_uncategorized_drafts_and_can_be_revoked(self):
        account=self.a.create_account({"name":"Synthetic","type":"cash","currency":"AUD","opening_balance":"100","opened_on":"2026-09-01"})["id"]
        rule=dispatch(self.a,self.actor,"POST","personal-rules",{"merchant":"Synthetic Coffee","category":"Work meals","currency":"AUD","confirmed":True})
        def create(): return self.a.create_draft({"merchant":"Synthetic Coffee","category":"Other","amount":"7","currency":"AUD","date":"2026-09-10","kind":"expense","account_id":account})["id"]
        identity=create()
        candidate=next(d for d in self.a.state("2026-09")["drafts"] if d["id"]==identity)
        self.assertEqual(candidate["content"]["category"],"Work meals")
        self.assertEqual(candidate["evidence"]["personal_rule"]["id"],rule["id"])
        dispatch(self.a,self.actor,"DELETE","personal-rules/"+rule["id"],{"version":1})
        identity=create()
        self.assertEqual(next(d for d in self.a.state("2026-09")["drafts"] if d["id"]==identity)["content"]["category"],"Other")
        self.assertEqual(self.b.state("2026-09")["drafts"],[])
    def test_feedback_stays_private_and_never_opts_into_training(self):
        dispatch(self.a,self.actor,"POST","feedback",{"kind":"classification","comment":"Synthetic mistake; user correction"})
        with self.a.connect() as db: self.assertFalse(db.db.execute("SELECT training_consent FROM feedback").fetchone()["training_consent"])
        with self.b.connect() as db: self.assertEqual(db.db.execute("SELECT * FROM feedback").fetchall(),[])
        with self.assertRaises(Problem): dispatch(self.a,self.actor,"POST","feedback",{"kind":"classification","comment":"Synthetic","training_consent":True})
    def test_deleted_or_revoked_sessions_cannot_resume_queued_financial_writes(self):
        second=Actor(self.actor.user_id,"synthetic-second-session",self.actor.email,self.actor.claims)
        waiting=CloudStore(self.pool,self.actor.user_id);session_check(waiting,second)
        dispatch(self.a,self.actor,"POST","account/sessions/revoke",{"session_id":second.session_ref})
        with self.assertRaises(Problem): waiting.create_account({"name":"Late write","type":"cash","currency":"AUD","opening_balance":"100","opened_on":"2026-09-01"})
        c=self.a.challenge({"purpose":"privacy_delete","resource_id":"all"},self.actor.session_ref)
        self.a.privacy("delete",{"nonce":c["nonce"],"content_hash":c["content_hash"]},self.actor.session_ref)
        with self.assertRaises(Problem): self.a.state("2026-09")
        self.assertEqual(CloudStore(self.pool,self.actor.user_id).state("2026-09")["accounts"],[])
