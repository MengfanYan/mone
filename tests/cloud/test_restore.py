import hashlib
import json
import os
import tempfile
import time
import unittest
from pathlib import Path
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

from services.api.domain import Problem
from services.cloud.auth import Actor
from services.cloud.app import session_check
from services.cloud.store import CloudStore,create_pool
from services.cloud.journal import FileJournal,Signer
from services.cloud.restore import apply_fences


class RecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pool=create_pool(os.environ["CLOUD_TEST_DSN"],test=True)
    @classmethod
    def tearDownClass(cls):cls.pool.close()
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.signer=Signer({"old":b"old-synthetic-key-at-least-32-bytes"},"old")
        self.journal=FileJournal(Path(self.tmp.name)/"independent-control",self.signer)
        self.user=str(uuid4());self.store=CloudStore(self.pool,self.user);self.store.deletion_journal=self.journal
    def test_delete_then_restore_an_old_database_cannot_revive_data_or_grants(self):
        account=self.store.create_account({"name":"Synthetic restore account","type":"cash","currency":"AUD","opening_balance":"1000","opened_on":"2026-09-01"})["id"]
        with self.store.connect() as db:
            before={t:db.db.execute(f"SELECT * FROM {t}").fetchall() for t in ("accounts","events","postings")}
        challenge=self.store.challenge({"purpose":"privacy_delete","resource_id":"all"},"synthetic")
        self.store.privacy("delete",{"nonce":challenge["nonce"],"content_hash":challenge["content_hash"]},"synthetic")
        self.assertEqual(self.journal.generation(self.store.tenant_id),1)
        # Controlled operator restore simulation: reinsert the pre-erasure rows
        # with their original tenant IDs, then apply the independent fences.
        with psycopg.connect(os.environ["CLOUD_TEST_ADMIN_DSN"],row_factory=dict_row) as admin:
            admin.execute("SET CONSTRAINTS ALL DEFERRED")
            for table,rows in before.items():
                for row in rows:
                    columns=[c for c in row if c not in {"rowid"} and not(c=="account_id" and table=="events")]
                    sql=f"INSERT INTO wallet.{table}({','.join(columns)}) "+("OVERRIDING SYSTEM VALUE " if table=="postings" else "")+f"VALUES({','.join(['%s']*len(columns))})"
                    admin.execute(sql,tuple(row[c] for c in columns))
            admin.execute("UPDATE wallet.workspaces SET consent_epoch=0 WHERE id=%s",(self.store.tenant_id,))
            admin.execute("UPDATE wallet.settings SET content='{"+'"analysis":true,"ocr":true'+"}' WHERE tenant_id=%s AND key='consents'",(self.store.tenant_id,))
            result=apply_fences(admin,self.journal)
            self.assertGreaterEqual(result["erasure_fences_applied"],1)
        self.assertEqual(self.store.state("2026-09")["accounts"],[])
        self.assertFalse(self.store.state("2026-09")["consents"]["analysis"])
        old=Actor(self.user,"restored-old-session","synthetic@example.test",{"exp":time.time()+300,"amr":[{"method":"password","timestamp":int(time.time())-30}]})
        with self.assertRaises(Problem):session_check(self.store,old)
        fresh=Actor(self.user,"fresh-after-restore","synthetic@example.test",{"exp":time.time()+300,"amr":[{"method":"password","timestamp":int(time.time())+2}]})
        session_check(self.store,fresh)
        self.assertEqual(self.store.state("2026-09")["accounts"],[])
    def test_key_rotation_verifies_old_receipts_and_missing_old_key_blocks_restore(self):
        request=hashlib.sha256(b"synthetic-request").hexdigest()
        self.journal.record(self.store.tenant_id,request,1)
        rotated=Signer({**self.signer.keys,"new":b"new-synthetic-key-at-least-32-bytes"},"new")
        other=FileJournal(self.journal.root,rotated)
        other.record(self.store.tenant_id,hashlib.sha256(b"new-request").hexdigest(),2)
        self.assertEqual(other.generation(self.store.tenant_id),2)
        incomplete=FileJournal(self.journal.root,Signer({"new":rotated.keys["new"]},"new"))
        with self.assertRaises(Problem):incomplete.generation(self.store.tenant_id)
    def test_tampered_receipt_or_unavailable_control_blocks_restore(self):
        request=hashlib.sha256(b"tamper-target").hexdigest();self.journal.record(self.store.tenant_id,request,1)
        path=next((self.journal.root/self.signer.tenant_hash(self.store.tenant_id)).glob("*.json"))
        value=json.loads(path.read_text());value["generation"]=999;path.write_text(json.dumps(value))
        with self.assertRaises(Problem):self.journal.generation(self.store.tenant_id)
        with psycopg.connect(os.environ["CLOUD_TEST_ADMIN_DSN"],row_factory=dict_row) as admin:
            with self.assertRaises(Problem):apply_fences(admin,None)
    def test_cloud_erasure_fails_without_independent_control(self):
        self.store.deletion_journal=None
        c=self.store.challenge({"purpose":"privacy_delete","resource_id":"all"},"synthetic")
        with self.assertRaises(Problem) as e:self.store.privacy("delete",{"nonce":c["nonce"],"content_hash":c["content_hash"]},"synthetic")
        self.assertEqual(e.exception.code,"JOURNAL_REQUIRED")
