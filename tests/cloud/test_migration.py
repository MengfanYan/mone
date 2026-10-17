import copy
import hashlib
import os
import tempfile
import unittest
from pathlib import Path
from uuid import uuid4

from services.api.store import Store
from services.api.domain import Problem
from services.cloud.store import CloudStore, create_pool
from services.cloud.migration import import_archive, inspect_archive


class MigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.pool=create_pool(os.environ["CLOUD_TEST_DSN"],test=True)
    @classmethod
    def tearDownClass(cls): cls.pool.close()
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.local=Store(Path(self.temp.name)/"synthetic.sqlite3")
        self.cloud=CloudStore(self.pool,str(uuid4()))
        self.account=self.local.create_account({"name":"Synthetic archive","type":"cash","currency":"AUD","opening_balance":"1000","opened_on":"2026-09-01"})["id"]
        d=self.local.create_draft({"amount":"7","currency":"AUD","date":"2026-09-10","merchant":"Synthetic Coffee","category":"Dining","kind":"expense","account_id":self.account})["id"]
        self.apply("confirm_draft",d,lambda c:self.local.confirm_draft(d,c,"synthetic"))
        payload={"analysis":True,"ocr":False}
        self.apply("consents","consents",lambda c:self.local.save_settings("consents",{**c,"payload":payload},"synthetic"),payload)
        self.local.statement("2026-09")
        self.archive=self.apply("privacy_export","all",lambda c:self.local.privacy("export",c,"synthetic"))
    def tearDown(self):self.temp.cleanup()
    def apply(self,purpose,resource,fn,payload=None):
        c=self.local.challenge({"purpose":purpose,"resource_id":resource,**({"payload":payload} if payload is not None else {})},"synthetic")
        return fn({"nonce":c["nonce"],"content_hash":c["content_hash"]})
    def test_archive_reconciles_exactly_and_reimport_has_no_second_effect(self):
        first=import_archive(self.cloud,self.archive)
        self.assertEqual(first["amount_difference"],"0")
        self.assertTrue(import_archive(self.cloud,self.archive)["replayed"])
        state=self.cloud.state("2026-09")
        self.assertEqual(state["accounts"][0]["balance"],"993.00")
        self.assertFalse(state["consents"]["analysis"])
        self.assertEqual([e["id"] for e in state["transactions"]],[e["id"] for e in self.local.state("2026-09")["transactions"]])
        with self.cloud.connect() as db:
            for table in ("challenges","command_plans","idempotency"):self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0],0)
            saved=db.execute("SELECT artifact FROM statements").fetchone()[0]
            self.assertEqual(saved,self.archive["data"]["statements"][0]["artifact"])
    def test_foreign_key_failure_rolls_back_every_imported_row_and_receipt(self):
        archive=copy.deepcopy(self.archive)
        import json
        e=archive["data"]["events"][0];content=json.loads(e["content"]);content["account_id"]=str(uuid4());e["content"]=json.dumps(content)
        with self.assertRaises(Exception):import_archive(self.cloud,archive)
        with self.cloud.connect() as db:
            for table in ("accounts","events","postings","statements","migration_receipts"):self.assertEqual(db.execute(f"SELECT count(*) FROM {table}").fetchone()[0],0)
    def test_unbalanced_or_future_archive_is_rejected_before_writing(self):
        archive=copy.deepcopy(self.archive);archive["data"]["postings"][0]["signed_amount"]="999"
        with self.assertRaises(Problem): inspect_archive(archive)
        archive["schema_version"]="999"
        with self.assertRaises(Problem): inspect_archive(archive)
    def test_balanced_postings_cannot_hide_changed_event_amount(self):
        import json
        archive=copy.deepcopy(self.archive)
        row=archive["data"]["events"][0]
        content=json.loads(row["content"]);content["amount"]="999.00";row["content"]=json.dumps(content)
        with self.assertRaises(Problem) as error: import_archive(self.cloud,archive)
        self.assertEqual(error.exception.code,"MIGRATION_EVENT")
        with self.cloud.connect() as db:self.assertEqual(db.execute("SELECT count(*) FROM accounts").fetchone()[0],0)

    def test_multi_currency_refund_reversal_and_frozen_report_survive_import(self):
        original=next(e for e in self.local.state("2026-09")["transactions"] if e["kind"]=="expense")
        self.apply("reverse_event",original["id"],lambda c:self.local.reverse(original["id"],c,"synthetic"))
        account=self.local.create_account({"name":"Synthetic USD","type":"cash","currency":"USD","opening_balance":"123.45","opened_on":"2026-09-01"})["id"]
        for kind,amount in (("expense","20.01"),("refund","5.01")):
            payload={"amount":amount,"currency":"USD","date":"2026-09-11","merchant":"Synthetic refund fixture","category":"Dining","kind":kind,"account_id":account}
            if kind=="refund":payload["refund_of"]=expense
            draft=self.local.create_draft(payload)["id"]
            result=self.apply("confirm_draft",draft,lambda c:self.local.confirm_draft(draft,c,"synthetic"))
            if kind=="expense":expense=result["event_id"]
        archive=self.apply("privacy_export","all",lambda c:self.local.privacy("export",c,"synthetic"))
        import_archive(self.cloud,archive)
        state=self.cloud.state("2026-09")
        self.assertEqual({a["currency"]:a["balance"] for a in state["accounts"]},{"AUD":"1000.00","USD":"108.45"})
        restored=next(e for e in state["transactions"] if e["reverses"])
        self.assertEqual(restored["reverses"],original["id"])
        self.assertEqual(restored["evidence"]["source"],"user_reversal")
        with self.cloud.connect() as db:
            self.assertEqual(db.execute("SELECT artifact FROM statements").fetchone()[0],archive["data"]["statements"][0]["artifact"])
