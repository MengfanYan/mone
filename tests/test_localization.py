import copy
import hashlib
import re
import tempfile
import unittest
from pathlib import Path

from services.api.localization import CATALOG, language, result_for, text
from services.api.store import Store


class LocalizationTests(unittest.TestCase):
    def test_translation_templates_preserve_all_placeholders(self):
        for source, english in CATALOG.items():
            with self.subTest(source=source):
                self.assertEqual(set(re.findall(r"\{\w+\}", source)), set(re.findall(r"\{\w+\}", english)))
                self.assertIsNone(re.search(r"[\u3400-\u9fff]", english))

    def test_default_language_and_interpolated_notes(self):
        self.assertEqual(language(None), "en")
        self.assertEqual(language("en-AU,en;q=0.9"), "en")
        self.assertEqual(language("zh-CN,zh;q=0.9"), "zh")
        self.assertEqual(text("访问码无效。", "en"), "Invalid local access code.")
        self.assertIn("Home groceries", text("Home groceries已超过用户批准预算。", "en"))
        self.assertNotIn("已超过", text("Home groceries已超过用户批准预算。", "en"))

    def test_localization_preserves_user_data_and_confirmation_hashes(self):
        state = {"accounts": [{"name": "原始账户"}], "transactions": [{"merchant": "原始商户", "category": "个人分类", "amount": "1234567890.12"}],
                 "drafts": [{"content": {"merchant": "原始商户"}, "evidence": {"limitations": ["缺少FX时按原币种展示。"]}}]}
        original = copy.deepcopy(state)
        localized = result_for("/v1/state", state, "en")
        self.assertEqual(state, original)
        self.assertEqual(localized["transactions"], original["transactions"])
        self.assertEqual(localized["accounts"], original["accounts"])
        self.assertNotEqual(localized["drafts"][0]["evidence"]["limitations"], original["drafts"][0]["evidence"]["limitations"])
        challenge = {"content_hash": "fixed", "preview": state}
        self.assertEqual(result_for("/v1/confirmation-challenges", challenge, "en"), challenge)
        self.assertEqual(result_for("/v1/privacy/export", state, "en"), state)

    def test_bilingual_statement_uses_same_frozen_snapshot(self):
        with tempfile.TemporaryDirectory() as directory:
            store = Store(Path(directory) / "wallet.sqlite3")
            payload = {"analysis": True, "ocr": False}
            challenge = store.challenge({"purpose": "consents", "resource_id": "consents", "payload": payload}, "test")
            store.save_settings("consents", {"nonce": challenge["nonce"], "content_hash": challenge["content_hash"], "payload": payload}, "test")
            account = store.create_account({"name": "原始名称", "type": "cash", "currency": "AUD", "opening_balance": "1234.56", "opened_on": "2026-09-01"})
            statement = store.statement("2026-09")
            original = store.statement_get(statement["id"])
            self.assertEqual(original["sha256"], hashlib.sha256(original["markdown"].encode()).hexdigest())
            english = result_for(f"/v1/statements/{statement['id']}", original, "en")
            self.assertEqual(english["snapshot"], original["snapshot"])
            self.assertEqual(english["id"], original["id"])
            self.assertIn("Personal Financial Statement", english["markdown"])
            self.assertIn("1234.56", english["markdown"])
            self.assertEqual(english["sha256"], hashlib.sha256(english["markdown"].encode()).hexdigest())
            self.assertEqual(store.statement_get(statement["id"]), original)
            self.assertEqual(result_for(f"/v1/statements/{statement['id']}", original, "zh"), original)
            self.assertTrue(account["id"])
