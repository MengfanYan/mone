import { test } from "node:test";
import assert from "node:assert/strict";
import { pageInsight } from "../../lib/page-insights.mjs";
import { createDemoClient } from "../../lib/demo/client.mjs";
test("page conclusions scope record/investment counts and budget context to the selected currency", async () => {
  const api = createDemoClient({ storage: null }),
    state = await api("state");
  const cny = pageInsight(state, "portfolio", "CNY");
  assert.equal(cny.params.count, 1);
  assert.equal(cny.params.missing, 0);
  const aud = pageInsight(state, "ledger", "AUD");
  assert.ok(aud.evidence_refs.length);
  assert.ok(
    aud.evidence_refs.every(
      (id) => state.transactions.find((e) => e.id === id).currency === "AUD",
    ),
  );
  assert.equal(
    pageInsight(state, "overview", "CNY").text_key,
    "还有 {count} 条草稿待确认。",
  );
});
import { monthWindow } from "../../lib/time-scopes.mjs";
test("investment month scope follows user timezone through the daylight saving change", () => {
  const september = monthWindow("2026-09", "Australia/Sydney"),
    october = monthWindow("2026-10", "Australia/Sydney");
  assert.equal(
    new Date(september.start).toISOString(),
    "2026-08-31T14:00:00.000Z",
  );
  assert.equal(september.end + 1, october.start);
  assert.equal(
    new Date(october.end + 1).toISOString(),
    "2026-10-31T13:00:00.000Z",
  );
});
