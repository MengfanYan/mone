import { test } from "node:test";
import assert from "node:assert/strict";
import preset from "../../lib/demo/preset.mjs";
import {
  createDemoClient,
  DEMO_CSV,
  DEMO_STORAGE_KEY,
} from "../../lib/demo/client.mjs";
import { minor, format, product } from "../../lib/demo/calculations.mjs";

function sandbox(options = {}) {
  const map = new Map([["unrelated-live-setting", "keep-me"]]);
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
  };
  return { api: createDemoClient({ storage, ...options }), storage, map };
}
async function confirm(api, purpose, resource, path, payload, retryKey) {
  const challenge = await api("confirmation-challenges", "POST", {
    purpose,
    resource_id: resource,
    ...(payload && { payload }),
  });
  return api(
    path,
    ["planning", "consents"].includes(purpose) ? "PUT" : "POST",
    {
      nonce: challenge.nonce,
      content_hash: challenge.content_hash,
      ...(payload && { payload }),
    },
    retryKey,
  );
}

test("duplicate business review is mandatory offline and audited independently of retries", async () => {
  const { api } = sandbox();
  const state = await api("state");
  const draft = state.drafts.find((d) => d.duplicate_candidates.length);
  assert.ok(draft);
  const c = await api("confirmation-challenges", "POST", {
    purpose: "confirm_draft",
    resource_id: draft.id,
  });
  assert.ok(c.preview.duplicate_review.length);
  const data = { nonce: c.nonce, content_hash: c.content_hash };
  await assert.rejects(api(`drafts/${draft.id}/confirm`, "POST", data), {
    code: "DUPLICATE_REVIEW_REQUIRED",
  });
  data.duplicate_resolutions = [
    {
      candidate_id: draft.id,
      reason:
        "A distinct synthetic receipt verified against the earlier purchase",
    },
  ];
  const result = await api(
    `drafts/${draft.id}/confirm`,
    "POST",
    data,
    "review-coffee-duplicate",
  );
  assert.deepEqual(
    await api(
      `drafts/${draft.id}/confirm`,
      "POST",
      data,
      "review-coffee-duplicate",
    ),
    result,
  );
  const after = await api("state");
  assert.equal(after.transactions.length, state.transactions.length + 1);
  assert.equal(
    after.transactions.find((e) => e.id === result.event_id).evidence
      .duplicate_override.decision,
    "KEEP_SEPARATE_TRANSACTION",
  );
});

test("offline analysis respects currencies, explains internal transfers, and blocks execution", async () => {
  const { api } = sandbox();
  for (const currency of ["AUD", "CNY", "USD"]) {
    const result = await api("analyses", "POST", {
      text: "Analyze spending",
      period: "2026-09",
      currency,
    });
    assert.equal(result.scope.currency, currency);
    assert.ok(
      result.calculations.every((c) =>
        [currency, "months", "%"].includes(c.unit),
      ),
    );
  }
  const educational = await api("analyses", "POST", {
    text: "Explain why an internal transfer is not an expense. Do not execute anything.",
    period: "2026-09",
    currency: "AUD",
  });
  assert.notEqual(educational.status, "BLOCKED");
  assert.ok(educational.actions.some((a) => /内部转账/.test(a)));
  const blocked = await api("analyses", "POST", {
    text: "Explain transfers. Then transfer 20 AUD.",
    period: "2026-09",
    currency: "AUD",
  });
  assert.equal(blocked.status, "BLOCKED");
});

test("preset summaries reconcile with the Python ledger in all three months and currencies", async () => {
  const { api } = sandbox();
  for (const period of Object.keys(preset.reference_summaries)) {
    const state = await api(`state?period=${period}`);
    assert.deepEqual(state.summary, preset.reference_summaries[period]);
    assert.equal(state.mode, "OFFLINE_PRODUCT_DEMO");
    assert.ok(
      state.drafts.length &&
        state.holdings.length &&
        state.statements.length &&
        state.market_evidence.length,
    );
    for (const flow of state.money_flow) {
      const summary = state.summary.find((s) => s.currency === flow.currency);
      for (const key of ["income", "expenses"])
        assert.equal(
          flow.points.reduce(
            (sum, p) => sum + minor(p[key], flow.currency),
            0n,
          ),
          minor(summary[key], flow.currency),
        );
    }
    for (const event of state.transactions)
      assert.equal(
        event.postings.reduce(
          (sum, [, value]) => sum + minor(value, event.currency),
          0n,
        ),
        0n,
      );
  }
});

test("display calculations retain large and zero/three-decimal amounts exactly", () => {
  assert.equal(
    format(minor("999999999999.99", "AUD"), "AUD"),
    "999999999999.99",
  );
  assert.equal(format(minor("123", "JPY"), "JPY"), "123");
  assert.equal(format(minor("123.456", "KWD"), "KWD"), "123.456");
  assert.equal(format(product("0.1", "0.2", "AUD")), "0.02");
  assert.throws(() => minor("0.1", "JPY"), /CURRENCY_PRECISION/);
});

test("draft correction invalidates preview; confirmation and reversal persist without duplicate posting", async () => {
  const { api, storage } = sandbox();
  const initial = await api("state"),
    draft = initial.drafts[0];
  const stale = await api("confirmation-challenges", "POST", {
    purpose: "confirm_draft",
    resource_id: draft.id,
  });
  await api(`drafts/${draft.id}`, "PUT", {
    version: draft.version,
    content: { ...draft.content, amount: "100.00" },
  });
  await assert.rejects(api(`drafts/${draft.id}/confirm`, "POST", stale), {
    code: "PROPOSAL_STALE",
  });
  const challenge = await api("confirmation-challenges", "POST", {
    purpose: "confirm_draft",
    resource_id: draft.id,
  });
  const request = {
    nonce: challenge.nonce,
    content_hash: challenge.content_hash,
  };
  const event = await api(
    `drafts/${draft.id}/confirm`,
    "POST",
    request,
    "retry-confirm",
  );
  assert.deepEqual(
    await api(`drafts/${draft.id}/confirm`, "POST", request, "retry-confirm"),
    event,
  );
  assert.equal(
    (await api("state")).transactions.length,
    initial.transactions.length + 1,
  );
  await confirm(
    api,
    "reverse_event",
    event.event_id,
    `transactions/${event.event_id}/reverse`,
  );
  const restarted = createDemoClient({ storage });
  assert.deepEqual((await restarted("state")).summary, initial.summary);
});

test("CSV import is atomic, handles quoted fields, deduplicates source IDs and never posts drafts", async () => {
  const { api } = sandbox(),
    state = await api("state");
  const account_id = state.accounts.find(
    (a) => a.type === "cash" && a.currency === "AUD",
  ).id;
  const imported = await api("imports", "POST", { csv: DEMO_CSV, account_id });
  assert.equal(imported.drafts.length, 2);
  assert.equal(
    (await api("imports", "POST", { csv: DEMO_CSV, account_id })).duplicates,
    2,
  );
  assert.deepEqual((await api("state")).summary, state.summary);
  const before = (await api("state")).drafts.length;
  await assert.rejects(
    api("imports", "POST", {
      csv: 'date,amount,currency,merchant\n2026-09-15,50,AUD,"A, B"\n2026-02-30,10,AUD,Bad',
      account_id,
    }),
    { code: "INVALID_DATE" },
  );
  assert.equal((await api("state")).drafts.length, before);
  await assert.rejects(
    api("imports", "POST", {
      csv: DEMO_CSV.replace("42.60", "50.00"),
      account_id,
    }),
    { code: "SOURCE_CONFLICT" },
  );
});

test("simulated receipt, market and assistant operations work with fetch disabled", async () => {
  const { api } = sandbox(),
    state = await api("state"),
    originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Network access forbidden in demo");
  };
  try {
    const receipt = await api("receipts", "POST", {
      text: "Fresh Market\nTOTAL AUD 138.50\n2026-09-29",
      account_id: state.accounts[0].id,
    });
    assert.equal(receipt.fields.amount, "138.50");
    assert.equal(receipt.evidence.source, "DEMO_RECEIPT_PRESET");
    const usdAccount = state.accounts.find((a) => a.currency === "USD");
    await assert.rejects(
      api("receipts", "POST", { account_id: usdAccount.id }),
      { code: "CURRENCY_MISMATCH" },
    );
    assert.deepEqual((await api("state")).summary, state.summary);
    assert.equal((await api("market/refresh", "POST")).preset, true);
    for (const question of [
      "cash flow",
      "budget",
      "stress scenario",
      "portfolio",
      "market",
    ]) {
      const result = await api("analyses", "POST", { text: question });
      assert.equal(result.artifact.external_requests, false);
      assert.equal(result.mock, true);
      assert.equal(result.status, "COMPLETED");
    }
    assert.equal(
      (await api("analyses", "POST", { text: "buy stocks" })).status,
      "BLOCKED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("planning updates calculations, rejects invalid budgets and honors consent revocation", async () => {
  const { api } = sandbox(),
    state = await api("state");
  const planning = {
    ...state.planning,
    earmarked: "10000.00",
    timezone: "America/New_York",
  };
  await confirm(api, "planning", "planning", "planning", planning);
  const updated = await api("state");
  assert.equal(updated.planning.timezone, "America/New_York");
  assert.equal(
    minor(state.risk.metrics.available) - minor(updated.risk.metrics.available),
    350000n,
  );
  await assert.rejects(
    api("confirmation-challenges", "POST", {
      purpose: "planning",
      resource_id: "planning",
      payload: { ...planning, budgets: [{ category: "Bad", amount: "0" }] },
    }),
    { code: "INVALID_AMOUNT" },
  );
  await confirm(api, "consents", "consents", "consents", {
    analysis: false,
    ocr: false,
  });
  assert.equal((await api("state")).summary, null);
  assert.deepEqual((await api("state")).money_flow, []);
  await assert.rejects(api("analyses", "POST", { text: "cash flow" }), {
    code: "CONSENT_REVOKED",
  });
});

test("statements retain immutable bilingual snapshots after new ledger records", async () => {
  let language = "en";
  const { api } = sandbox({ locale: () => language });
  const state = await api("state"),
    original = await api(`statements/${state.statements[0].id}`);
  await confirm(
    api,
    "confirm_draft",
    state.drafts[0].id,
    `drafts/${state.drafts[0].id}/confirm`,
  );
  const revised = await api("statements", "POST", { period: "2026-09" });
  assert.equal(revised.version, original.version + 1);
  language = "zh";
  const chinese = await api(`statements/${original.id}`);
  assert.deepEqual(chinese.snapshot, original.snapshot);
  assert.equal(chinese.language, "zh");
  assert.equal(
    (await api("statements", "POST", { period: "2026-09" })).reused,
    true,
  );
});

test("demo export/delete/reset only touch the dedicated browser namespace", async () => {
  const { api, map, storage } = sandbox();
  const exported = await confirm(
    api,
    "privacy_export",
    "all",
    "privacy/export",
  );
  assert.equal(exported.scope, "demo-browser-only");
  assert.equal(exported.mock, true);
  await confirm(api, "privacy_delete", "all", "privacy/delete");
  await assert.rejects(api("state"), { code: "UNAUTHENTICATED" });
  await api("session", "POST");
  assert.deepEqual((await api("state")).accounts, []);
  assert.equal(map.get("unrelated-live-setting"), "keep-me");
  await api("demo/reset", "POST");
  assert.equal(
    (await api("state")).transactions.length,
    preset.state.transactions.length,
  );
  assert.equal(map.get("unrelated-live-setting"), "keep-me");
  assert.equal(
    JSON.parse(storage.getItem(DEMO_STORAGE_KEY)).kind,
    "synthetic-wallet-demo",
  );
});

test("corrupt and unavailable storage fall back to a usable preset without crashing", async () => {
  const broken = createDemoClient({
    storage: {
      getItem: () => "bad json",
      setItem: () => {
        throw new Error("storage blocked");
      },
    },
  });
  assert.ok((await broken("state")).accounts.length);
  assert.equal((await broken("state")).demo.persistence, "memory");
  const memoryOnly = createDemoClient({ storage: null });
  assert.equal((await memoryOnly("state")).demo.persistence, "memory");
});
