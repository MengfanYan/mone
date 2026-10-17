import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoClient } from "../../lib/demo/client.mjs";
import { minor } from "../../lib/demo/calculations.mjs";
import {
  advisoryFacts,
  rebalanceBudget,
  payoffDraft,
  subscriptionCandidates,
  refundCandidates,
  unifiedWorth,
  cashProjection,
  cashToAsset,
  narrativeBrief,
  splitRecordFollowup,
  effectiveRecords,
  savingTarget,
} from "../../lib/terminal/advisory.mjs";
const snapshot = () =>
  createDemoClient({ storage: null })("state?period=2026-09");
test("advisory facts respect analysis consent, period, currency and reversals", async () => {
  const s = await snapshot();
  const f = advisoryFacts(s, "AUD");
  assert.equal(f.cashTotal, "46007.65");
  assert.equal(f.interestTotal, "24.50");
  assert.equal(advisoryFacts(s, "AUD", "2026-08"), null);
  s.consents.analysis = false;
  assert.equal(advisoryFacts(s, "AUD"), null);
  const records = {
    transactions: [
      { id: "a", currency: "AUD", date: "2026-09-01", kind: "expense" },
      {
        id: "r",
        currency: "AUD",
        date: "2026-10-01",
        kind: "reversal",
        reverses: "a",
      },
      { id: "b", currency: "USD", date: "2026-09-01", kind: "expense" },
    ],
  };
  assert.deepEqual(effectiveRecords(records, "AUD", "2026-09"), []);
});
test("budget redistribution conserves exact approved total and cannot consume committed allowance", async () => {
  const s = await snapshot(),
    before = structuredClone(s);
  const p = rebalanceBudget(s, "AUD", "Dining", "Groceries", "21.00");
  assert.equal(p.budgets.find((b) => b.category === "Dining").amount, "181.00");
  assert.equal(
    p.budgets.find((b) => b.category === "Groceries").amount,
    "679.00",
  );
  const total = (x) =>
    x.budgets.reduce((n, b) => n + minor(b.amount, "AUD"), 0n);
  assert.equal(total(p), total(s.planning));
  assert.deepEqual(s, before);
  for (const value of ["0", "-1", "128.46", "21.001"])
    assert.throws(() =>
      rebalanceBudget(s, "AUD", "Dining", "Groceries", value),
    );
  assert.throws(() => rebalanceBudget(s, "USD", "Dining", "Groceries", "1"));
  assert.throws(() => rebalanceBudget(s, "AUD", "Dining", "Dining", "1"));
});
test("repayment proposals validate debt, cash, currency and calendar without executing", async () => {
  const s = await snapshot(),
    f = advisoryFacts(s, "AUD"),
    before = structuredClone(s);
  const p = payoffDraft(
    s,
    "AUD",
    f.cash[0].id,
    f.debt[0].id,
    "100",
    "2026-09-30",
  );
  assert.equal(p.kind, "debt_principal");
  assert.equal(p.amount, "100.00");
  assert.equal(p.counterparty_id, f.debt[0].id);
  assert.deepEqual(s, before);
  for (const [amount, date] of [
    ["999999", "2026-09-30"],
    ["100", "2026-02-30"],
    ["-1", "2026-09-30"],
  ])
    assert.throws(() =>
      payoffDraft(s, "AUD", f.cash[0].id, f.debt[0].id, amount, date),
    );
});
test("manual FX handles mixed precision, liabilities, missing quotes and half-up rounding", () => {
  const s = {
    accounts: [
      { currency: "JPY", type: "cash", balance: "100" },
      { currency: "KWD", type: "cash", balance: "1.005" },
      { currency: "AUD", type: "liability", balance: "1.00" },
    ],
    investments: [],
  };
  const q = {
    JPY: {
      rate: "0.01",
      date: "2026-09-30",
      source: "manual",
      previousRate: "0.009",
    },
    KWD: { rate: "1", date: "2026-09-30", source: "manual", previousRate: "1" },
  };
  const r = unifiedWorth(s, "AUD", q);
  assert.equal(r.total, "1.01");
  assert.equal(r.fxEffect, "0.10");
  delete q.JPY.source;
  assert.equal(unifiedWorth(s, "AUD", q).total, null);
  q.JPY.source = "manual";
  q.JPY.date = "2026-02-30";
  assert.equal(unifiedWorth(s, "AUD", q).total, null);
  q.JPY.date = "2026-09-30";
  q.JPY.rate = "0";
  assert.throws(() => unifiedWorth(s, "AUD", q));
});
test("three month cash sandbox clamps recurring month ends and counts only unpaid entered commitments", () => {
  const input = {
    cash: "1000",
    reserve: "100",
    purchase: "300",
    currency: "AUD",
    asOf: "2026-01-30",
    commitments: [
      {
        name: "Rent",
        date: "2026-01-31",
        amount: "100",
        kind: "outflow",
        monthly: true,
      },
      {
        name: "Salary",
        date: "2026-02-15",
        amount: "200",
        kind: "income",
        monthly: false,
      },
      {
        name: "already paid",
        date: "2026-01-29",
        amount: "900",
        kind: "outflow",
        monthly: false,
      },
    ],
  };
  assert.deepEqual(
    cashProjection(input).rows.map((r) => r.closing),
    ["500.00", "600.00", "500.00"],
  );
  assert.throws(() => cashProjection({ ...input, purchase: "-1" }));
  assert.throws(() => cashProjection({ ...input, asOf: "2026-02-30" }));
});
test("subscription estimates need three dates; candidate refunds retain explicit original matching", () => {
  const event = (id, date) => ({
    id,
    date,
    amount: "49.00",
    merchant: "Design tools",
    kind: "expense",
    account_id: "a",
    currency: "AUD",
  });
  const s = {
    period: "2026-03",
    transactions: [event("1", "2026-01-31"), event("2", "2026-02-28")],
  };
  assert.deepEqual(subscriptionCandidates(s, "AUD"), []);
  s.transactions.push(event("3", "2026-03-31"));
  assert.equal(subscriptionCandidates(s, "AUD")[0].nextDate, "2026-04-30");
  assert.equal(
    refundCandidates(s, {
      ...event("refund", "2026-04-01"),
      merchant: "Design tools refund",
      kind: "refund",
    }).length,
    3,
  );
  s.transactions.push({
    ...event("r", "2026-03-31"),
    kind: "refund",
    refund_of: "1",
  });
  assert.equal(
    refundCandidates(s, { ...event("refund", "2026-04-01"), kind: "refund" })
      .length,
    2,
  );
});
test("allocation scenarios and brief use saved records, preserve provenance and never mutate state", async () => {
  const s = await snapshot(),
    before = structuredClone(s),
    i = s.investments.find((i) => i.currency === "AUD" && !i.archived);
  const b = cashToAsset(s, "AUD", i.id, "2000");
  assert.equal(b.cashAfter, "44007.65");
  assert.throws(() => cashToAsset(s, "AUD", i.id, "999999"));
  assert.match(narrativeBrief(s, "AUD"), /Source events/);
  assert.match(narrativeBrief(s, "AUD"), /5311.15/);
  assert.deepEqual(s, before);
  assert.ok(savingTarget(s, "AUD", 65));
});
test("compound record and budget request stays explicit and read-only follow-up is separated", () => {
  assert.deepEqual(
    splitRecordFollowup(
      "Harbor Coffee 18.50 AUD today, and check my dining budget",
    ),
    {
      record: "Harbor Coffee 18.50 AUD today",
      budgetQuestion: "my dining budget",
    },
  );
  assert.equal(
    splitRecordFollowup("今天咖啡18.5 AUD，顺便看看餐饮预算").record,
    "今天咖啡18.5 AUD",
  );
  assert.equal(
    splitRecordFollowup("change budget to 200").budgetQuestion,
    null,
  );
});
