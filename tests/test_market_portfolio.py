import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from services.api.domain import Problem, portfolio_analysis
from services.api.market import SERIES, normalize_bls, refresh
from services.api.store import Store


class MarketPortfolioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / "wallet.sqlite3")
        payload = {"analysis": True, "ocr": False}
        c = self.store.challenge({"purpose": "consents", "resource_id": "consents", "payload": payload}, "test")
        self.store.save_settings("consents", {"nonce": c["nonce"], "content_hash": c["content_hash"], "payload": payload}, "test")

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, value="123.456"):
        return {"status": "REQUEST_SUCCEEDED", "Results": {"series": [{"seriesID": SERIES, "data": [{"year": "2026", "period": "M08", "value": value, "footnotes": []}]}]}}

    def test_market_keeps_unknown_publication_null_and_revisions_immutable(self):
        with patch("services.api.market.fetch_bls", return_value=(self.fixture(), "synthetic-hash")):
            self.assertEqual(refresh(self.store)["added"], 1)
            with self.assertRaises(Problem) as error:
                refresh(self.store)
            self.assertEqual(error.exception.code, "MARKET_RATE_LIMIT")
        old = self.store.state("2026-09")["market_evidence"][0]
        self.assertIsNone(old["published_at"])
        self.assertFalse(old["mock"])
        with self.store.transaction() as db:
            db.execute("UPDATE meta SET value='0' WHERE key='market_last_refresh'")
        with patch("services.api.market.fetch_bls", return_value=(self.fixture("124.001"), "synthetic-revised-hash")):
            refresh(self.store)
        records = self.store.state("2026-09")["market_evidence"]
        self.assertEqual(records[0], old)
        self.assertEqual(records[1]["revised_from"], old["evidence_id"])

    def test_market_contract_failures_never_produce_fake_data(self):
        for payload in ({}, {"status": "REQUEST_FAILED"}, {"status": "REQUEST_SUCCEEDED", "Results": {"series": []}}, self.fixture("NaN")):
            with self.assertRaises(Problem):
                normalize_bls(payload, "hash", "2026-10-14T00:00:00+00:00")
        with patch("services.api.market.fetch_bls", side_effect=Problem("MARKET_UNAVAILABLE", "unavailable", 503)):
            with self.assertRaises(Problem):
                refresh(self.store)
        self.assertEqual(self.store.state("2026-09")["market_evidence"], [])

    def test_missing_official_observation_preserves_gap_as_null(self):
        record = normalize_bls(self.fixture("-"), "synthetic-gap-hash", "2026-10-14T00:00:00+00:00")[0]
        self.assertIsNone(record["value"])
        self.assertEqual(record["quality_status"], "MISSING_OBSERVATION")
        self.assertFalse(record["mock"])

    def test_portfolio_exact_values_unknown_cost_staleness_and_coverage(self):
        old = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        rows = [self.store.holding({"name": "合成甲", "issuer": "同发行人", "asset_type": "stock", "currency": "AUD", "quantity": "0.1", "price": "0.2", "observed_at": old}),
                self.store.holding({"name": "合成乙", "issuer": "同发行人", "asset_type": "complex", "currency": "AUD", "quantity": "10", "price": "2", "cost_basis": "15", "observed_at": old})]
        result = portfolio_analysis(rows)[0]
        self.assertEqual(result["total"], "20.02")
        self.assertEqual(result["issuer_hhi"], "1.0000")
        self.assertIsNone(result["positions"][0]["unrealized_gain"])
        self.assertEqual(result["positions"][1]["unrealized_gain"], "5.00")
        self.assertEqual(result["positions"][1]["coverage"], "LIMITED")
        self.assertEqual(result["positions"][0]["quality"], "STALE")

    def test_future_timestamps_and_negative_holdings_rejected(self):
        raw = {"name": "合成甲", "issuer": "甲", "currency": "AUD", "quantity": "1", "price": "2", "observed_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
        with self.assertRaises(Problem):
            self.store.holding(raw)
        with self.assertRaises(Problem):
            self.store.holding({**raw, "quantity": "-1", "observed_at": datetime.now(timezone.utc).isoformat()})
