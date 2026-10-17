import json
import os
import unittest
import tempfile
from uuid import uuid4
from concurrent.futures import ThreadPoolExecutor

import psycopg

from services.cloud.store import CloudStore, create_pool, set_runtime_context
from services.api.domain import Problem
from services.cloud.journal import FileJournal, Signer


class CloudStoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.pool = create_pool(os.environ["CLOUD_TEST_DSN"],test=True)
    @classmethod
    def tearDownClass(cls): cls.pool.close()
    def setUp(self):
        self.a=CloudStore(self.pool,str(uuid4())); self.b=CloudStore(self.pool,str(uuid4()))
        control=tempfile.TemporaryDirectory();self.addCleanup(control.cleanup)
        self.a.deletion_journal=FileJournal(control.name,Signer({"v1":b"synthetic-deletion-key-32-characters"},"v1"))
    def account(self,store):
        return store.create_account({"name":"Synthetic cloud account","type":"cash","currency":"AUD","opening_balance":"1000","opened_on":"2026-09-01"})["id"]
    def draft(self,store,account):
        return store.create_draft({"account_id":account,"amount":"7.00","currency":"AUD","date":"2026-09-10","merchant":"Synthetic cloud coffee","kind":"expense","category":"Dining"})["id"]
    def confirm(self,store,draft,key=None):
        c=store.challenge({"purpose":"confirm_draft","resource_id":draft},"synthetic-session")
        return store.confirm_draft(draft,{"nonce":c["nonce"],"content_hash":c["content_hash"]},"synthetic-session",key)
    def test_exact_ledger_and_transactional_outbox(self):
        account=self.account(self.a);draft=self.draft(self.a,account);receipt=self.confirm(self.a,draft,"synthetic-retry-01")
        state=self.a.state("2026-09")
        self.assertEqual(state["accounts"][0]["balance"],"993.00")
        with self.a.connect() as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM outbox").fetchone()[0],2)
            self.assertTrue(db.execute("SELECT 1 FROM idempotency WHERE key=?",("synthetic-retry-01",)).fetchone())
        self.assertTrue(receipt["event_id"])
    def test_cross_tenant_ids_and_foreign_keys_fail_closed(self):
        account=self.account(self.a);draft=self.draft(self.a,account)
        self.assertEqual(self.b.state("2026-09")["accounts"],[])
        with self.assertRaises(Problem): self.draft(self.b,account)
        with self.assertRaises(Problem): self.b.challenge({"purpose":"confirm_draft","resource_id":draft},"synthetic-session")
        with self.b.connect() as db:
            self.assertEqual(db.execute("SELECT * FROM accounts WHERE id=?",(account,)).fetchall(),[])
        with self.assertRaises(Exception):
            with self.b.connect() as db: db.execute("INSERT INTO account_overrides VALUES (?,?,?,?)",(account,"Cross tenant",0,1))
    def test_missing_context_and_pool_reuse_do_not_leak(self):
        self.account(self.a)
        for _ in range(8):
            self.assertEqual(len(self.a.state("2026-09")["accounts"]),1)
            self.assertEqual(self.b.state("2026-09")["accounts"],[])
        with self.pool.connection() as db:
            set_runtime_context(db)
            self.assertEqual(db.execute("SELECT * FROM accounts").fetchall(),[])
            with self.assertRaises(psycopg.Error):
                with db.transaction(): db.execute("INSERT INTO accounts(id,name,type,currency,opened_on) VALUES('missing','x','cash','AUD','2026-09-01')")
    def test_concurrent_confirmations_post_once(self):
        account=self.account(self.a);draft=self.draft(self.a,account)
        c=self.a.challenge({"purpose":"confirm_draft","resource_id":draft},"synthetic-session")
        body={"nonce":c["nonce"],"content_hash":c["content_hash"]}
        def submit(_): return self.a.confirm_draft(draft,body,"synthetic-session","cloud-concurrent-retry")
        with ThreadPoolExecutor(max_workers=8) as workers: results=list(workers.map(submit,range(16)))
        self.assertTrue(all(r==results[0] for r in results))
        self.assertEqual(len(self.a.state("2026-09")["transactions"]),2)
    def test_database_rejects_unbalanced_events_and_wrong_currency_precision(self):
        import json
        account=self.account(self.a)
        with self.assertRaises(psycopg.errors.CheckViolation):
            with self.a.transaction() as db:
                db.execute("INSERT INTO events VALUES (?,?,?,?,?)",(str(uuid4()),json.dumps({"account_id":account,"currency":"AUD"}),None,None,"2026-09-01T00:00:00Z"))
        with self.assertRaises(Exception):
            with self.a.transaction() as db:
                event=db.execute("SELECT id FROM events LIMIT 1").fetchone()[0]
                db.execute("INSERT INTO postings(event_id,account_ref,currency,signed_amount) VALUES(?,?,?,?)",(event,account,"AUD","0.001"))
    def test_export_delete_and_other_tenant_survives(self):
        self.account(self.a);self.account(self.b)
        c=self.a.challenge({"purpose":"privacy_export","resource_id":"all"},"synthetic-session")
        export=self.a.privacy("export",{"nonce":c["nonce"],"content_hash":c["content_hash"]},"synthetic-session")
        self.assertEqual(len(export["data"]["accounts"]),1)
        c=self.a.challenge({"purpose":"privacy_delete","resource_id":"all"},"synthetic-session")
        self.a.privacy("delete",{"nonce":c["nonce"],"content_hash":c["content_hash"]},"synthetic-session")
        self.assertEqual(self.a.state("2026-09")["accounts"],[])
        self.assertEqual(len(self.b.state("2026-09")["accounts"]),1)
