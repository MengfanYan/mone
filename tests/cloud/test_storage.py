import base64
import hashlib
import os
import time
import unittest
from uuid import uuid4

import httpx

from services.cloud.auth import Actor
from services.cloud.config import Config
from services.cloud.storage import PrivateStorage
from services.cloud.store import CloudStore,create_pool
from services.api.domain import Problem


class StorageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.pool=create_pool(os.environ["CLOUD_TEST_DSN"],test=True)
    @classmethod
    def tearDownClass(cls):cls.pool.close()
    def setUp(self):
        self.actor=Actor(str(uuid4()),"storage-session","synthetic@example.test",{"exp":time.time()+300})
        self.store=CloudStore(self.pool,self.actor.user_id);self.other=CloudStore(self.pool,str(uuid4()))
        self.config=Config("not-used","https://synthetic.supabase.co","synthetic-publishable","https://synthetic.example")
        self.requests=[];self.raw=b"Synthetic private receipt text only"
        def provider(request):
            self.requests.append(request)
            return httpx.Response(200,content=self.raw if request.method=="GET" else b"{}")
        self.storage=PrivateStorage(self.config,self.actor,"synthetic-user-token",client=httpx.Client(transport=httpx.MockTransport(provider)))
        self.addCleanup(self.storage.close)
    def test_private_quarantine_blocks_download_and_cross_tenant_access(self):
        item=self.storage.intake(self.store,{"base64":base64.b64encode(self.raw).decode(),"mime_type":"text/plain","purpose":"receipt"})
        self.assertEqual(item["status"],"quarantined")
        self.assertEqual(self.requests[0].headers["Authorization"],"Bearer synthetic-user-token")
        self.assertNotIn("service",self.requests[0].headers["apikey"])
        with self.assertRaises(Problem):self.storage.download(self.store,item["id"])
        with self.assertRaises(Problem):self.storage.download(self.other,item["id"])
        self.assertEqual(len(self.requests),1)
        with self.store.transaction() as db:db.db.execute("UPDATE documents SET status='clean' WHERE id=%s",(item["id"],))
        self.assertEqual(self.storage.download(self.store,item["id"]),self.raw)
        self.assertIn("/object/authenticated/",str(self.requests[-1].url))
        self.assertEqual(self.storage.remove(self.store,item["id"])["status"],"deleted")
    def test_mismatched_type_and_bad_encoding_make_no_upload_request(self):
        for payload in [{"base64":"!!","mime_type":"image/png","purpose":"receipt"},{"base64":base64.b64encode(b"<svg>bad</svg>").decode(),"mime_type":"image/png","purpose":"receipt"}]:
            with self.assertRaises(Problem):self.storage.intake(self.store,payload)
        self.assertEqual(self.requests,[])
