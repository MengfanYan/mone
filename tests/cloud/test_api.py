import os
import time
import unittest
import psycopg
from uuid import uuid4

from fastapi.testclient import TestClient

from services.api.domain import Problem
from services.cloud.app import create_app
from services.cloud.auth import Actor
from services.cloud.config import Config
from services.cloud.store import create_pool


class SyntheticIdentity:
    def __init__(self):
        self.actors={t:Actor(str(uuid4()),"synthetic-"+t,"synthetic@example.test",{"exp":time.time()+3600,"aal":"aal1"}) for t in ("a","b","mfa")}
        self.actors["mfa"]=Actor(self.actors["mfa"].user_id,"synthetic-mfa","synthetic@example.test",self.actors["mfa"].claims,({"status":"verified"},))
    def verify(self,token):
        if token not in self.actors:raise Problem("UNAUTHENTICATED","Invalid synthetic token",401)
        return self.actors[token]
    def reauthenticate(self,actor,password):
        if password!="synthetic-reverification-password":raise Problem("REAUTH_REQUIRED","Reauthentication failed",401)


class CloudAPITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls): cls.pool=create_pool(os.environ["CLOUD_TEST_DSN"],test=True)
    @classmethod
    def tearDownClass(cls):cls.pool.close()
    def setUp(self):
        self.identity=SyntheticIdentity()
        with psycopg.connect(os.environ["CLOUD_TEST_ADMIN_DSN"]) as db:
            for actor in self.identity.actors.values():
                db.execute("INSERT INTO wallet_admission.invites(user_id,expires_at,approved_by) VALUES(%s,now()+interval '1 day','synthetic-operator')",(actor.user_id,))
        self.config=Config(os.environ["CLOUD_TEST_DSN"],"https://synthetic.supabase.co","synthetic-publishable-key","http://127.0.0.1:3107",test=True)
        self.client=TestClient(create_app(self.config,pool=self.pool,identity=self.identity))
    def headers(self,token="a",origin=None):return {"Authorization":"Bearer "+token,"Origin":origin or self.config.public_origin}
    def test_two_users_cannot_read_or_attach_each_others_resources(self):
        r=self.client.post("/v1/accounts",headers=self.headers(),json={"name":"Synthetic","type":"cash","currency":"AUD","opening_balance":"1000","opened_on":"2026-09-01"})
        self.assertEqual(r.status_code,200,r.text);account=r.json()["data"]["id"]
        r=self.client.get("/v1/state?period=2026-09",headers=self.headers("b"))
        self.assertEqual(r.status_code,200,r.text);self.assertEqual(r.json()["data"]["accounts"],[])
        r=self.client.post("/v1/drafts",headers=self.headers("b"),json={"account_id":account,"amount":"7","currency":"AUD","date":"2026-09-10","merchant":"Cross tenant"})
        self.assertNotEqual(r.status_code,200)
        r=self.client.get("/v1/state?tenant_id="+self.identity.actors["a"].user_id,headers=self.headers("b"))
        self.assertEqual(r.status_code,400)
    def test_origin_identity_fields_mfa_and_payment_gates_fail_closed(self):
        self.assertEqual(self.client.get("/v1/state").status_code,401)
        self.assertEqual(self.client.post("/v1/accounts",headers=self.headers(origin="https://evil.example"),json={}).status_code,403)
        self.assertEqual(self.client.post("/v1/accounts",headers=self.headers(),json={"tenant_id":"forged"}).status_code,400)
        self.assertEqual(self.client.get("/v1/state",headers=self.headers("mfa")).status_code,403)
        self.assertTrue(self.client.get("/v1/session",headers=self.headers("mfa")).json()["data"]["needs_mfa"])
        self.assertEqual(self.client.post("/v1/billing/checkout",headers=self.headers(),json={}).status_code,503)
        self.assertFalse(self.client.get("/v1/billing",headers=self.headers()).json()["data"]["enabled"])
        self.assertEqual(self.client.post("/v1/terminal/model-preview",headers=self.headers(),json={}).status_code,503)
    def test_lock_revokes_the_exact_session_and_prevents_late_write(self):
        r=self.client.get("/v1/session",headers=self.headers());self.assertEqual(r.status_code,200)
        r=self.client.delete("/v1/session",headers=self.headers());self.assertEqual(r.status_code,200,r.text)
        self.assertEqual(self.client.get("/v1/state",headers=self.headers()).status_code,401)
        self.assertEqual(self.client.post("/v1/accounts",headers=self.headers(),json={"name":"Late"}).status_code,401)
        self.assertEqual(self.client.get("/v1/state",headers=self.headers("b")).status_code,200)
    def test_provider_signup_cannot_bypass_closed_preview_admission(self):
        actor=Actor(str(uuid4()),"not-invited","synthetic@example.test",{"exp":time.time()+3600})
        self.identity.actors["outsider"]=actor
        r=self.client.get("/v1/state",headers=self.headers("outsider"))
        self.assertEqual(r.status_code,403)
        self.assertEqual(r.json()["error"]["code"],"REGISTRATION_CLOSED")
    def test_telemetry_contains_only_route_metadata_and_trace_ids(self):
        with self.assertLogs("finagent.cloud",level="INFO") as logs:
            r=self.client.post("/v1/accounts",headers=self.headers(),json={"name":"DO_NOT_LOG_SYNTHETIC_NAME","type":"cash","currency":"AUD","opening_balance":"123.45","opened_on":"2026-09-01"})
        self.assertEqual(r.status_code,200,r.text)
        self.assertTrue(r.headers.get("X-Request-ID"))
        text=" ".join(logs.output)
        self.assertNotIn("DO_NOT_LOG",text);self.assertNotIn("123.45",text);self.assertNotIn(self.identity.actors["a"].user_id,text)

    def test_notification_api_and_read_receipts_are_tenant_scoped(self):
        def call(method,path,data=None,token="a"):
            response=getattr(self.client,method)("/v1/"+path,headers=self.headers(token),**({"json":data} if data is not None else {}))
            self.assertEqual(response.status_code,200,response.text)
            return response.json()["data"]
        account=call("post","accounts",{"name":"Synthetic salary account","currency":"AUD","type":"cash","opening_balance":"0","opened_on":"2026-09-01"})["id"]
        payload={"analysis":True,"ocr":False}
        preview=call("post","confirmation-challenges",{"purpose":"consents","resource_id":"consents","payload":payload})
        call("put","consents",{"nonce":preview["nonce"],"content_hash":preview["content_hash"],"payload":payload})
        draft=call("post","drafts",{"kind":"income","category":"Salary","amount":"8200.01","currency":"AUD","date":"2026-09-25","merchant":"Synthetic employer","account_id":account})["id"]
        preview=call("post","confirmation-challenges",{"purpose":"confirm_draft","resource_id":draft})
        call("post",f"drafts/{draft}/confirm",{"nonce":preview["nonce"],"content_hash":preview["content_hash"]})
        feed=call("get","notifications?period=2026-09")
        self.assertEqual(feed["items"][0]["amount"],"8200.01")
        self.assertEqual(call("get","notifications?period=2026-09",token="b")["items"],[])
        body={"period":"2026-09","ids":[feed["items"][0]["id"]]}
        self.assertEqual(self.client.post("/v1/notifications/read",headers=self.headers("b"),json=body).status_code,404)
        call("post","notifications/read",body)
        self.assertEqual(call("get","notifications?period=2026-09")["unread_count"],0)
        self.assertEqual(self.client.get("/v1/notifications?period=2026-09").status_code,401)
