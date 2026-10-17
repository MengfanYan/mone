import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assetAllocation,
  allocationWorksheet,
  csvWorksheet,
  historicalRisk,
  currentAllocationWorksheet,
} from "../../lib/terminal/analytics.mjs";
import {
  readWorkspaceLocation,
  workspaceSearch,
} from "../../lib/workspace-location.mjs";
import { duplicateReviewComplete } from "../../lib/duplicates.mjs";
import { simulatePlanning } from "../../lib/terminal/simulation.mjs";
import {
  encryptBackup,
  inspectEncryptedBackup,
} from "../../lib/terminal/vault.mjs";
import { searchKnowledge } from "../../lib/terminal/knowledge.mjs";
import { createDemoClient } from "../../lib/demo/client.mjs";
import { minor } from "../../lib/demo/calculations.mjs";

test("asset worksheets conserve exact minor units and never pool currencies or debt", () => {
  const allocation = assetAllocation(
    {
      accounts: [
        { currency: "AUD", type: "cash", balance: "999999999.99" },
        { currency: "USD", type: "cash", balance: "100.00" },
        { currency: "AUD", type: "liability", balance: "10.00" },
      ],
      investments: [
        {
          id: "i",
          name: "=Untrusted",
          currency: "AUD",
          latest: { market_value: "0.02" },
        },
      ],
    },
    "AUD",
  );
  assert.equal(allocation.total, "1000000000.01");
  const unchanged = currentAllocationWorksheet(allocation);
  assert.ok(
    unchanged.rows.every(
      (r) => r.current === r.target_value && r.change === "0.00",
    ),
  );
  const sheet = allocationWorksheet(allocation, { cash: "33.33", i: "66.67" });
  assert.equal(
    sheet.rows.reduce((s, r) => s + minor(r.target_value, "AUD"), 0n),
    100000000001n,
  );
  assert.equal(
    sheet.rows.reduce((s, r) => s + minor(r.change, "AUD"), 0n),
    0n,
  );
  assert.equal(sheet.execution, false);
  assert.match(csvWorksheet(sheet), /'=Untrusted/);
  assert.throws(() =>
    allocationWorksheet(allocation, { cash: "33.33", i: "66.66" }),
  );
});
test("URL state accepts only public navigation scope, never private query contents", () => {
  assert.deepEqual(
    readWorkspaceLocation(
      "?tab=assistant&period=2026-09&currency=USD&question=private&draft_id=secret",
    ),
    { tab: "assistant", period: "2026-09", currency: "USD" },
  );
  assert.deepEqual(
    readWorkspaceLocation("?tab=unknown&period=2026-13&currency=XYZ"),
    {},
  );
  assert.equal(
    workspaceSearch({
      tab: "ledger",
      period: "2026-09",
      currency: "AUD",
      question: "private",
    }),
    "?tab=ledger&period=2026-09&currency=AUD",
  );
});
test("duplicate review requires exact candidates and meaningful explicit reasons", () => {
  const reviews = [{ candidate_id: "one" }, { candidate_id: "two" }];
  assert.equal(duplicateReviewComplete(reviews, []), false);
  assert.equal(
    duplicateReviewComplete(reviews, [
      { candidate_id: "one", reason: "valid reason" },
      { candidate_id: "one", reason: "valid reason" },
    ]),
    false,
  );
  assert.equal(
    duplicateReviewComplete(reviews, [
      { candidate_id: "one", reason: "     " },
      { candidate_id: "two", reason: "valid reason" },
    ]),
    false,
  );
  assert.equal(duplicateReviewComplete(reviews, [null, null]), false);
  assert.equal(
    duplicateReviewComplete(
      reviews,
      reviews.map((r) => ({ ...r, reason: "Two separate verified receipts" })),
    ),
    true,
  );
});
test("historical risk never substitutes market value for unit prices", () => {
  const observations = Array.from({ length: 30 }, (_, i) => ({
    observed_at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
    market_value: String(100 + i),
  }));
  assert.equal(historicalRisk(observations, "AUD").available, false);
  const prices = observations.map((p, i) => ({
    ...p,
    unit_price: String(100 + i),
  }));
  assert.equal(historicalRisk(prices, "AUD").loss_percent_95, 0);
  prices[15].observed_at = "2026-04-01";
  assert.equal(historicalRisk(prices, "AUD").available, false);
});
test("zero-return zero-volatility planning matches an independent exact contribution case", () => {
  const result = simulatePlanning(
    {
      age: 30,
      retirementAge: 40,
      initial: 1000,
      monthly: 250,
      annualReturn: 0,
      inflation: 0,
      volatility: 0,
      goal: 31000,
    },
    100,
  );
  assert.equal(result.median, 31000);
  assert.equal(result.probability, 1);
  assert.equal(result.monthlyFor90, 250);
  assert.equal(result.points.at(-1).p95, 31000);
});
test("seeded paths are reproducible and the common-path contribution reaches 90 percent", () => {
  const result = simulatePlanning({}, 600);
  assert.deepEqual(result, simulatePlanning({}, 600));
  const adjusted = simulatePlanning(
    { ...result.parameters, monthly: result.monthlyFor90 },
    600,
  );
  assert.ok(adjusted.probability >= 0.9);
  assert.ok(result.downside <= result.median);
  assert.throws(() => simulatePlanning({ age: 65, retirementAge: 35 }));
});
test("encrypted backup authenticates password, salt and ciphertext and reveals no plaintext", async () => {
  const payload = {
      schema_version: "test",
      private_name: "SYNTHETIC SECRET",
      amount: "123.45",
    },
    password = "test-only-passphrase";
  const a = await encryptBackup(payload, password),
    b = await encryptBackup(payload, password);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.salt, b.salt);
  assert.ok(!JSON.stringify(a).includes(payload.private_name));
  assert.deepEqual(await inspectEncryptedBackup(a, password), payload);
  await assert.rejects(() => inspectEncryptedBackup(a, "wrong-password-long"));
  await assert.rejects(() =>
    inspectEncryptedBackup(
      { ...a, ciphertext: a.ciphertext.slice(0, -8) + "AAAAAAAA" },
      password,
    ),
  );
  await assert.rejects(() =>
    inspectEncryptedBackup({ ...a, iterations: 1 }, password),
  );
});
test("lexical retrieval returns bilingual attributed excerpts and keeps absent evidence empty", () => {
  const docs = [
    { id: "a", name: "储备", text: "应急储备保持六个月。" },
    {
      id: "b",
      name: "Plan",
      text: "Emergency reserve policy uses confirmed cash records.",
    },
  ];
  assert.equal(searchKnowledge(docs, "应急储备")[0].id, "a");
  assert.equal(searchKnowledge(docs, "emergency reserve")[0].id, "b");
  assert.deepEqual(searchKnowledge(docs, "unrelated zebra", 3, 0.99), []);
});
test("new demo settings, documents and preset model flow persist with networking disabled", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("NETWORK_FORBIDDEN");
  };
  const map = new Map(),
    storage = { getItem: (k) => map.get(k), setItem: (k, v) => map.set(k, v) };
  try {
    let api = createDemoClient({ storage });
    const settings = await api("terminal/settings");
    assert.equal(settings.key_configured, false);
    const next = await api("terminal/documents", "POST", {
      name: "Synthetic test",
      text: "Distinctive emergency reserve documentation.",
    });
    const doc = next.documents.at(-1);
    assert.equal(
      (await api("terminal/search", "POST", { query: "distinctive emergency" }))
        .results[0].id,
      doc.id,
    );
    const preview = await api("terminal/model-preview", "POST", {
      query: "emergency reserve",
    });
    assert.match(preview.destination, /OFFLINE/);
    assert.equal(
      (
        await api("terminal/model-explanation", "POST", {
          nonce: preview.nonce,
          confirmed: true,
        })
      ).source,
      "HAND_WRITTEN_DEMO_PRESET",
    );
    await assert.rejects(() =>
      api("terminal/model-explanation", "POST", {
        nonce: preview.nonce,
        confirmed: true,
      }),
    );
    api = createDemoClient({ storage });
    assert.ok(
      (await api("terminal/settings")).documents.some((x) => x.id === doc.id),
    );
    await api("terminal/documents", "DELETE", { id: doc.id });
    assert.ok(
      !(await api("terminal/settings")).documents.some((x) => x.id === doc.id),
    );
    await api("session", "DELETE");
    await assert.rejects(() => api("terminal/audit"));
  } finally {
    globalThis.fetch = original;
  }
});

test("review: weekday sessions honor declared holidays and never fill missing observations", () => {
  const make = (skip = []) =>
    Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 8, i + 1)))
      .filter(
        (d) =>
          ![0, 6].includes(d.getUTCDay()) &&
          !skip.includes(d.toISOString().slice(0, 10)),
      )
      .map((d, i) => ({
        observed_at: d.toISOString(),
        unit_price: String(100 + i),
      }));
  const weekdays = make();
  assert.equal(
    historicalRisk(weekdays, "AUD", { frequency: "weekdays" }).available,
    true,
  );
  const holiday = make(["2026-09-07"]);
  assert.equal(
    historicalRisk(holiday, "AUD", {
      frequency: "weekdays",
      closedDates: ["2026-09-07"],
    }).available,
    true,
  );
  assert.equal(
    historicalRisk(holiday, "AUD", { frequency: "weekdays" }).reason,
    "MISSING_SESSION",
  );
  assert.equal(
    historicalRisk([...weekdays, weekdays[0]], "AUD", { frequency: "weekdays" })
      .reason,
    "DUPLICATE_DATES",
  );
});
