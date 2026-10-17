import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoClient } from "../../lib/demo/client.mjs";
import { buildNotifications } from "../../lib/notifications.mjs";

test("offline notifications cover budget, salary and saved stock price with persistent read receipts", async () => {
  const data = new Map(),
    storage = {
      getItem: (key) => data.get(key),
      setItem: (key, value) => data.set(key, value),
    };
  let api = createDemoClient({ storage });
  const before = await api("state?period=2026-09"),
    feed = before.notifications;
  assert.deepEqual(
    [...new Set(feed.items.map((n) => n.kind))],
    ["budget", "price", "income"],
  );
  assert.equal(feed.items.find((n) => n.kind === "price").percent, "6.44");
  assert.equal(feed.live_bank_or_market, false);
  await api("notifications/read", "POST", {
    period: "2026-09",
    ids: [feed.items[0].id],
  });
  api = createDemoClient({ storage });
  const after = await api("state?period=2026-09");
  assert.equal(after.notifications.items[0].read, true);
  assert.equal(after.ledger_version, before.ledger_version);
  assert.equal(after.settings_version, before.settings_version);
  await assert.rejects(
    api("notifications/read", "POST", {
      period: "2026-09",
      ids: ["foreign-id"],
    }),
    { code: "RESOURCE_NOT_FOUND" },
  );
});

test("notification acknowledgement leaves a reviewed financial confirmation valid", async () => {
  const api = createDemoClient({ storage: null });
  const state = await api("state"),
    draft = state.drafts.find((d) => !d.duplicate_candidates.length);
  const preview = await api("confirmation-challenges", "POST", {
    purpose: "confirm_draft",
    resource_id: draft.id,
  });
  await api("notifications/read", "POST", {
    period: "2026-09",
    ids: [state.notifications.items[0].id],
  });
  assert.ok(
    (
      await api(`drafts/${draft.id}/confirm`, "POST", {
        nonce: preview.nonce,
        content_hash: preview.content_hash,
      })
    ).event_id,
  );
});

test("missing prices and revoked consent cannot produce synthetic decline alerts", async () => {
  const api = createDemoClient({ storage: null }),
    state = await api("state");
  const entry = state.investments.find((x) => x.asset_type === "stock");
  const points = [
    {
      id: "before",
      observed_at: "2026-09-01T00:00:00Z",
      version: 1,
      content: { price: "100", market_value: "1000" },
    },
    {
      id: "after",
      observed_at: "2026-09-30T00:00:00Z",
      version: 1,
      content: { market_value: "1" },
    },
  ];
  assert.equal(
    buildNotifications(state, { [entry.id]: points }).items.some(
      (n) => n.kind === "price",
    ),
    false,
  );
  assert.equal(
    buildNotifications({ ...state, consents: { analysis: false } }, {}).items
      .length,
    0,
  );
  assert.equal(
    (await api("notifications?period=2026-08")).items.some(
      (n) => n.kind === "income" && n.period !== "2026-08",
    ),
    false,
  );
});
