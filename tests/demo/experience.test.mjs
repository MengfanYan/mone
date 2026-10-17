import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoClient } from "../../lib/demo/client.mjs";
import { DEMO_EVIDENCE } from "../../lib/demo/experience.mjs";
import { parseCommand } from "../../lib/commands/parser.mjs";

function sandbox() {
  const data = new Map();
  const storage = {
    getItem: (key) => data.get(key),
    setItem: (key, value) => data.set(key, value),
  };
  return { storage, api: createDemoClient({ storage }) };
}
async function apply(api, p, key = crypto.randomUUID()) {
  const c = await api("confirmation-challenges", "POST", {
    purpose: "command_apply",
    resource_id: p.command_id,
  });
  return api(
    `commands/${p.command_id}/apply`,
    "POST",
    { nonce: c.nonce, content_hash: c.content_hash, plan_version: p.version },
    key,
  );
}

test("local grammar keeps multi-currency ambiguity and user timezone dates", () => {
  const p = parseCommand("我今天买咖啡花了7dollars，兼职赚了200元。", {
    day: "2026-10-14",
  });
  assert.equal(p.operations.length, 2);
  assert.equal(p.operations[0].fields.currency, null);
  assert.equal(p.operations[1].fields.currency, null);
  assert.equal(p.operations[1].fields.kind, "income");
  assert.equal(p.operations[0].fields.date, "2026-10-14");
  assert.equal(
    parseCommand("yesterday coffee 6.50 AUD", { day: "2026-10-14" })
      .operations[0].fields.date,
    "2026-10-13",
  );
  assert.throws(() => parseCommand("delete all data"));
});

test("offline commands create, correct and remove records with persistent idempotency", async () => {
  const { api, storage } = sandbox(),
    state = await api("state"),
    account = state.accounts.find(
      (a) => a.type === "cash" && a.currency === "AUD",
    );
  let p = await api("commands/plan", "POST", {
    text: "Coffee 7 AUD",
    account_id: account.id,
  });
  const initial = structuredClone(state.summary);
  const c = await api("confirmation-challenges", "POST", {
      purpose: "command_apply",
      resource_id: p.command_id,
    }),
    body = {
      nonce: c.nonce,
      content_hash: c.content_hash,
      plan_version: p.version,
    };
  const result = await api(
    `commands/${p.command_id}/apply`,
    "POST",
    body,
    "offline-command-001",
  );
  const reloaded = createDemoClient({ storage });
  assert.deepEqual(
    await reloaded(
      `commands/${p.command_id}/apply`,
      "POST",
      body,
      "offline-command-001",
    ),
    result,
  );
  const saved = result.results[0].resource_id;
  p = await api("commands/plan", "POST", {
    text: `change ${saved} to 6.50`,
    recent_resource_ids: [saved],
  });
  assert.equal(p.operations[0].resource_id, saved);
  await apply(api, p);
  p = await api("commands/plan", "POST", { text: "find Coffee" });
  const corrected = p.results.find((r) => r.fields.amount === "6.50");
  assert.ok(corrected);
  p = await api("commands/plan", "POST", {
    text: `delete ${corrected.resource_id}`,
  });
  await apply(api, p);
  assert.deepEqual((await api("state")).summary, initial);
});

test("one ambiguous sentence clarifies to distinct AUD and CNY events", async () => {
  const { api } = sandbox(),
    initial = await api("state");
  const cny = await api("accounts", "POST", {
    name: "CNY local",
    currency: "CNY",
    type: "cash",
    opened_on: "2026-09-01",
    opening_balance: "0",
  });
  let p = await api("commands/plan", "POST", {
    text: "我今天买咖啡花了7dollars，兼职赚了200元。",
  });
  assert.equal(p.status, "NEEDS_CLARIFICATION");
  p = await api(`commands/${p.command_id}`, "PATCH", {
    version: p.version,
    operations: [
      {
        op_id: "o1",
        fields: { currency: "AUD", account_id: initial.accounts[0].id },
      },
      { op_id: "o2", fields: { currency: "CNY", account_id: cny.id } },
    ],
  });
  assert.equal(p.status, "READY");
  const result = await apply(api, p);
  assert.equal(result.results.length, 2);
  const summary = (await api("state")).summary;
  assert.equal(summary.find((s) => s.currency === "CNY").income, "200.00");
});

test("bank candidates retain transfer gaps; fund gain creates history and no cash income", async () => {
  const { api } = sandbox(),
    state = await api("state");
  const bank = await api("evidence-imports", "POST", {
    doc_type: "bank",
    text: DEMO_EVIDENCE.bank,
    account_id: state.accounts[0].id,
  });
  assert.equal(bank.operations.length, 3);
  assert.equal(bank.operations[2].selected, false);
  const fund = await api("evidence-imports", "POST", {
    doc_type: "investment",
    text: DEMO_EVIDENCE.investment,
  });
  assert.equal(fund.operations[0].fields.reported_gain, "500.00");
  assert.equal(fund.operations[0].fields.daily_gain, "60.00");
  const p = await api(`commands/${fund.command_id}`, "PATCH", {
    version: fund.version,
    operations: [{ op_id: "o1", selected: true, resource_id: "new" }],
  });
  const result = await apply(api, p);
  assert.deepEqual((await api("state")).summary, state.summary);
  const h = await api(
    `investments/${result.results[0].resource_id}/performance`,
  );
  assert.equal(h.points.length, 1);
  assert.equal(h.reported_points[0].amount, "500.00");
  await assert.rejects(
    api("evidence-imports", "POST", {
      doc_type: "bank",
      image_base64: "anything",
    }),
    { code: "DEMO_OCR_PRESET_ONLY" },
  );
});

test("capital, dividend and sale history matches the independent Python profit case", async () => {
  const { api } = sandbox(),
    state = await api("state"),
    entry = state.investments.find(
      (e) => e.id === "demo-investment-capital-history",
    );
  const output = await api(`investments/${entry.id}/performance`);
  assert.deepEqual(
    output.points.map((p) => p.net_gain),
    ["0.00", "100.00", "120.00", "220.00", "215.00"],
  );
  assert.ok(output.points.every((p) => p.net_quality === "VERIFIED_HISTORY"));
});

test("batch failure rolls back first posting; revocation protects OCR but leaves basic CRUD", async () => {
  const { api } = sandbox(),
    state = await api("state"),
    account = state.accounts[0];
  const a = await api("drafts", "POST", {
    date: "2026-09-20",
    amount: "7",
    currency: "AUD",
    account_id: account.id,
    merchant: "Batch A",
    category: "Dining",
  });
  const b = await api("drafts", "POST", {
    date: "2099-01-01",
    amount: "8",
    currency: "AUD",
    account_id: account.id,
    merchant: "Batch B",
    category: "Dining",
  });
  const payload = {
      drafts: [
        { id: a.id, version: 1 },
        { id: b.id, version: 1 },
      ],
    },
    c = await api("confirmation-challenges", "POST", {
      purpose: "confirm_draft_batch",
      resource_id: "batch",
      payload,
    });
  await assert.rejects(
    api(
      "draft-batches/confirm",
      "POST",
      { nonce: c.nonce, content_hash: c.content_hash, payload },
      "batch-future-001",
    ),
    { code: "FUTURE_DATE" },
  );
  assert.deepEqual((await api("state")).summary, state.summary);
  const consents = { analysis: false, ocr: false },
    grant = await api("confirmation-challenges", "POST", {
      purpose: "consents",
      resource_id: "consents",
      payload: consents,
    });
  await api("consents", "PUT", {
    nonce: grant.nonce,
    content_hash: grant.content_hash,
    payload: consents,
  });
  assert.ok(
    (await api("commands/plan", "POST", { text: "find Batch A" })).results
      .length,
  );
  const p = await api("commands/plan", "POST", {
    text: "Coffee 2 AUD",
    account_id: account.id,
  });
  await apply(api, p);
  assert.equal((await api("state")).summary, null);
  await assert.rejects(
    api(`investments/${state.investments[0].id}/performance`),
    { code: "CONSENT_REVOKED" },
  );
});

test("recent/exact target IDs, stable planning patches, account archive and cancellation", async () => {
  const { api } = sandbox(),
    state = await api("state");
  let p = await api("commands/plan", "POST", {
    text: "Coffee 7 AUD",
    account_id: state.accounts[0].id,
  });
  const saved = (await apply(api, p)).results[0].resource_id;
  p = await api("commands/plan", "POST", {
    text: "change just Coffee to 6.50",
    recent_resource_ids: [saved],
  });
  assert.equal(p.operations[0].resource_id, saved);
  await apply(api, p);
  const initial = (await api("state")).planning;
  p = await api("commands/plan", "POST", {
    text: "change Dining budget to 120",
  });
  await apply(api, p);
  const after = (await api("state")).planning;
  assert.deepEqual(after.goals, initial.goals);
  assert.equal(after.monthly_income, initial.monthly_income);
  assert.equal(
    after.budgets.find((x) => x.category === "Dining").id,
    initial.budgets.find((x) => x.category === "Dining").id,
  );
  p = await api("commands/plan", "POST", {
    text: "rename " + state.accounts[0].name + " account to Everyday cash",
  });
  await apply(api, p);
  p = await api("commands/plan", "POST", {
    text: "archive Everyday cash account",
  });
  await apply(api, p);
  assert.equal(
    (await api("state")).accounts.find((x) => x.id === state.accounts[0].id)
      .archived,
    true,
  );
  p = await api("commands/plan", "POST", { text: "Coffee 8 AUD" });
  const cancelled = await api(`commands/${p.command_id}/cancel`, "POST", {
    version: p.version,
  });
  assert.equal(cancelled.status, "CANCELLED");
  await assert.rejects(apply(api, cancelled));
});

test("typed evidence deduplicates confirmations and schema edits cannot invent authority", async () => {
  const { api } = sandbox(),
    state = await api("state"),
    body = {
      doc_type: "receipt",
      text: DEMO_EVIDENCE.receipt,
      account_id: state.accounts[0].id,
    };
  const p = await api("evidence-imports", "POST", body);
  await apply(api, p);
  const again = await api("evidence-imports", "POST", body);
  assert.ok(again.operations[0].errors.includes("DUPLICATE_SOURCE"));
  let proposal = await api("commands/plan", "POST", {
    text: "Coffee 8 AUD",
    account_id: state.accounts[0].id,
  });
  await assert.rejects(
    api(`commands/${proposal.command_id}`, "PATCH", {
      version: proposal.version,
      operations: [{ op_id: "o1", fields: { tenant_id: "other" } }],
    }),
    { code: "INVALID_FIELDS" },
  );
  proposal = await api("commands/plan", "POST", {
    text: "Salary 1,200.50 AUD",
    account_id: state.accounts[0].id,
  });
  assert.equal(proposal.operations[0].fields.amount, "1200.50");
  const h = await api(
    "investments/demo-investment-capital-history/performance",
  );
  assert.equal(h.points[1].unrealized_percent, "10.0000");
});

test("new command/history interactions have no fetch dependency", async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("Network is disabled for this synthetic test");
  };
  try {
    const { api } = sandbox(),
      state = await api("state");
    const p = await api("commands/plan", "POST", {
      text: "Coffee 7 AUD",
      account_id: state.accounts[0].id,
    });
    await apply(api, p);
    const query = await api("commands/plan", "POST", {
      text: "find this month Dining",
      period: "2026-09",
    });
    assert.ok(query.query_summary.length);
    const h = await api(
      "investments/demo-investment-capital-history/performance",
    );
    assert.equal(h.points.at(-1).net_gain, "215.00");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
