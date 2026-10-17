import tempfile
import unittest
from pathlib import Path

from services.api.domain import Problem
from services.api.notifications import build_notifications
from services.api.store import Store


def synthetic_state():
    return {"period":"2026-09","as_of":"2026-10-01T00:00:00Z","ledger_version":1,"settings_version":1,"consents":{"analysis":True},"planning":{"currency":"AUD"},"risk":{"budgets":[{"category":"Dining","amount":"10.00","actual":"21.01","delta":"11.01"}]},"transactions":[{"id":"salary","kind":"income","amount":"1000.01","currency":"USD","category":"Salary","merchant":"Synthetic employer","date":"2026-09-25","reverses":None}],"investments":[{"id":"stock","asset_type":"stock","name":"Synthetic stock","currency":"AUD","archived":False}]}


class NotificationTests(unittest.TestCase):
    def test_exact_budget_salary_and_observation_sources_keep_original_currency(self):
        points={"stock":[{"id":"old","observed_at":"2026-09-01T00:00:00Z","version":1,"content":{"price":"90"}},{"id":"new","observed_at":"2026-09-30T00:00:00Z","version":1,"content":{"price":"84.20"}}]}
        feed=build_notifications(synthetic_state(),points)
        self.assertEqual([n["kind"] for n in feed["items"]],["budget","price","income"])
        self.assertEqual(feed["items"][0]["amount"],"11.01")
        self.assertEqual(feed["items"][1]["percent"],"6.44")
        self.assertEqual(feed["items"][2]["currency"],"USD")
        self.assertFalse(feed["live_bank_or_market"])

    def test_reversals_other_periods_and_missing_analysis_do_not_generate_income(self):
        state=synthetic_state();state["transactions"].append({**state["transactions"][0],"id":"reversal","reverses":"salary"})
        self.assertFalse(any(n["kind"]=="income" for n in build_notifications(state,{})["items"]))
        state["period"]="2026-08";state["risk"]=None
        self.assertEqual(build_notifications(state,{})["items"],[])
        state["consents"]["analysis"]=False
        self.assertEqual(build_notifications(state,{})["unread_count"],0)

    def test_revision_missing_price_market_value_and_future_points_cannot_fake_a_drop(self):
        state=synthetic_state();state["risk"]=None;state["transactions"]=[]
        old={"id":"old","observed_at":"2026-09-01T00:00:00Z","version":1,"content":{"price":"100","market_value":"1000"}}
        point={"id":"new","observed_at":"2026-09-30T00:00:00Z","version":1,"content":{"price":"90","market_value":"100"}}
        revision={**point,"id":"revision","version":2,"content":{"price":"110"}}
        self.assertEqual(build_notifications(state,{"stock":[old,point,revision]})["items"],[])
        missing={**point,"content":{"market_value":"1"}}
        self.assertEqual(build_notifications(state,{"stock":[old,missing]})["items"],[])
        future={**point,"observed_at":"2026-10-01T00:00:00Z"}
        self.assertEqual(build_notifications(state,{"stock":[old,future]})["items"],[])

    def test_receipts_persist_without_changing_financial_versions_and_delete_with_private_data(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/"synthetic.sqlite3";store=Store(path);session="synthetic-notifications"
            def confirm(purpose,resource,fn,payload=None):
                c=store.challenge({"purpose":purpose,"resource_id":resource,**({"payload":payload} if payload else {})},session)
                return fn({"nonce":c["nonce"],"content_hash":c["content_hash"],**({"payload":payload} if payload else {})})
            consents={"analysis":True,"ocr":False};confirm("consents","consents",lambda body:store.save_settings("consents",body,session),consents)
            account=store.create_account({"name":"Synthetic","currency":"AUD","type":"cash","opened_on":"2026-09-01","opening_balance":"0"})["id"]
            draft=store.create_draft({"kind":"income","amount":"1000.01","currency":"AUD","date":"2026-09-25","category":"Salary","merchant":"Synthetic employer","account_id":account})["id"]
            self.assertEqual(store.notifications("2026-09")["items"],[])
            confirm("confirm_draft",draft,lambda body:store.confirm_draft(draft,body,session))
            before=store.state("2026-09");id=before["notifications"]["items"][0]["id"]
            store.read_notifications({"period":"2026-09","ids":[id]})
            after=Store(path).state("2026-09")
            self.assertTrue(after["notifications"]["items"][0]["read"])
            self.assertEqual((before["ledger_version"],before["settings_version"]),(after["ledger_version"],after["settings_version"]))
            with self.assertRaises(Problem):store.read_notifications({"period":"2026-09","ids":["another-users-notification"]})
            export=confirm("privacy_export","all",lambda body:store.privacy("export",body,session))
            self.assertTrue(any(r["key"]=="notification_receipts" for r in export["data"]["settings"]))
            confirm("privacy_delete","all",lambda body:store.privacy("delete",body,session))
            with store.connect() as db:self.assertIsNone(db.execute("SELECT content FROM settings WHERE key='notification_receipts'").fetchone())

    def test_database_history_uses_distinct_instants_and_original_decimal_prices(self):
        import json
        from uuid import uuid4
        with tempfile.TemporaryDirectory() as temp:
            store=Store(Path(temp)/"synthetic.sqlite3")
            with store.transaction() as db:
                db.execute("UPDATE settings SET content=? WHERE key='consents'",(json.dumps({"analysis":True,"ocr":False}),))
                entry={"name":"Synthetic price","issuer":"Synthetic","currency":"AUD","asset_type":"stock","history_complete":False,"mock":True}
                db.execute("INSERT INTO investments VALUES (?,?,1,NULL,0)",("synthetic-stock",json.dumps(entry)))
                for date,version,price in [("2026-09-01",1,"100"),("2026-09-30",1,"95"),("2026-09-30",2,"90")]:
                    content={"observed_at":date+"T00:00:00Z","price":price,"quantity":"1","market_value":price,"cost_basis":None}
                    db.execute("INSERT INTO investment_valuations VALUES (?,?,?,?,?,NULL,?)",(str(uuid4()),"synthetic-stock",content["observed_at"],json.dumps(content),version,date))
            feed=store.notifications("2026-09")
            self.assertEqual(len(feed["items"]),1)
            self.assertEqual(feed["items"][0]["percent"],"10.00")
            self.assertEqual(store.notifications("2026-08")["items"],[])
