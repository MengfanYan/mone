"""In-app notices from confirmed records; no bank or quote feed is implied."""
import json
from decimal import Decimal, ROUND_HALF_UP

from .domain import canonical, require, valid_month

SALARY_CATEGORIES = {"salary", "wages", "工资", "薪资", "薪酬"}


def build_notifications(state, valuations, read_ids=()):
    period = state["period"]
    notices = []
    if state["consents"]["analysis"]:
        currency = state["planning"].get("currency", "AUD")
        for budget in (state.get("risk") or {}).get("budgets", []):
            if Decimal(budget["delta"]) <= 0:
                continue
            notices.append({"id": "|".join(("budget", period, currency, budget["category"], budget["actual"])), "kind": "budget", "severity": "warning", "currency": currency, "period": period, "date": period + "-01", "name": budget["category"], "amount": budget["delta"], "actual": budget["actual"], "limit": budget["amount"], "source": "confirmed_ledger", "target": {"tab": "ledger", "period": period, "currency": currency, "category": budget["category"]}})
        reversed_ids = {e["reverses"] for e in state["transactions"] if e.get("reverses")}
        for event in state["transactions"]:
            if event["kind"] != "income" or event.get("reverses") or event["id"] in reversed_ids or not event["date"].startswith(period) or event["category"].strip().lower() not in SALARY_CATEGORIES:
                continue
            notices.append({"id": "income|" + event["id"], "kind": "income", "severity": "positive", "currency": event["currency"], "period": period, "date": event["date"], "name": event["merchant"], "amount": event["amount"], "source": "confirmed_ledger", "source_ids": [event["id"]], "target": {"tab": "ledger", "period": period, "currency": event["currency"], "resource_id": event["id"]}})
        for entry in state.get("investments", []):
            if entry["archived"] or entry["asset_type"] not in {"stock", "etf", "fund"}:
                continue
            effective = {}
            for point in sorted(valuations.get(entry["id"], []), key=lambda x: (x["observed_at"], x["version"])):
                if point["observed_at"][:7] <= period:
                    effective[point["observed_at"]] = point
            points = list(effective.values())[-2:]
            if len(points) != 2 or points[-1]["observed_at"][:7] != period:
                continue
            before, after = points
            old, new = before["content"].get("price"), after["content"].get("price")
            if old is None or new is None or Decimal(old) <= 0 or Decimal(new) >= Decimal(old):
                continue
            # An observation change is not investment return: no adjustment or
            # forecast is inferred from quantity, cost basis or market value.
            percent = str(((Decimal(old) - Decimal(new)) / Decimal(old) * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
            notices.append({"id": "|".join(("price", entry["id"], after["id"], before["id"])), "kind": "price", "severity": "watch", "currency": entry["currency"], "period": period, "date": after["observed_at"][:10], "name": entry["name"], "percent": percent, "previous_price": old, "price": new, "previous_observed_at": before["observed_at"], "observed_at": after["observed_at"], "source": "saved_valuations", "source_ids": [before["id"], after["id"]], "target": {"tab": "portfolio", "period": period, "currency": entry["currency"], "resource_id": entry["id"]}})
    priority = {"budget": 0, "price": 1, "income": 2}
    notices.sort(key=lambda n: (priority[n["kind"]], -int(n["date"].replace("-", "")), n["id"]))
    items = [{**item, "read": item["id"] in read_ids} for item in notices[:50]]
    return {"items": items, "unread_count": sum(not item["read"] for item in items), "period": period, "as_of": state["as_of"], "analysis_authorized": state["consents"]["analysis"], "ledger_version": state["ledger_version"], "settings_version": state["settings_version"], "limit": 50, "delivery": "in_app", "live_bank_or_market": False}


class NotificationStore:
    def notification_state(self, db, state):
        row = db.execute("SELECT content FROM settings WHERE key='notification_receipts'").fetchone()
        receipts = json.loads(row[0]) if row else []
        valuations = {}
        if state["consents"]["analysis"]:
            # Revisions at the same observation instant replace that instant;
            # use the latest two distinct instants up to the selected month.
            rows = db.execute("""WITH effective AS (
                SELECT investment_id,id,observed_at,content,version,
                row_number() OVER (PARTITION BY investment_id,observed_at ORDER BY version DESC) AS revision
                FROM investment_valuations WHERE substr(observed_at,1,7)<=?
            ), recent AS (
                SELECT *,row_number() OVER (PARTITION BY investment_id ORDER BY observed_at DESC) AS sequence
                FROM effective WHERE revision=1
            ) SELECT investment_id,id,observed_at,content,version FROM recent WHERE sequence<=2""", (state["period"],))
            for row in rows:
                valuations.setdefault(row["investment_id"], []).append({**dict(row), "content": json.loads(row["content"])})
        return build_notifications(state, valuations, receipts)

    def notifications(self, period):
        return self.state(valid_month(period))["notifications"]

    def read_notifications(self, data):
        require(isinstance(data, dict) and set(data) == {"period", "ids"}, "INVALID_FIELDS", "Notification fields are invalid")
        period = valid_month(data["period"])
        ids = data["ids"]
        require(isinstance(ids, list) and 0 < len(ids) <= 50 and all(isinstance(x, str) and len(x) <= 256 for x in ids), "INVALID_FIELDS", "Select up to 50 current notifications")
        available = {n["id"] for n in self.notifications(period)["items"]}
        require(set(ids) <= available, "RESOURCE_NOT_FOUND", "The notification changed; refresh this period", 404)
        with self.transaction() as db:
            row = db.execute("SELECT content FROM settings WHERE key='notification_receipts'").fetchone()
            old = json.loads(row[0]) if row else []
            receipts = list(dict.fromkeys([*ids, *old]))[:500]
            db.execute("INSERT OR REPLACE INTO settings(key,content) VALUES(?,?)", ("notification_receipts", canonical(receipts)))
        return {"updated": len(set(ids))}
