import { minor } from "./demo/calculations.mjs";

const salary = new Set(["salary", "wages", "工资", "薪资", "薪酬"]);
const scaledPrice = (value) => {
  if (typeof value !== "string" || !/^\d+(\.\d{1,8})?$/.test(value))
    return null;
  const [whole, part = ""] = value.split(".");
  return BigInt(whole) * 100000000n + BigInt(part.padEnd(8, "0"));
};

// Mirrors the API's record-derived notification contract. Demo remains offline.
export function buildNotifications(state, valuations = {}, readIds = []) {
  const period = state.period,
    items = [];
  if (state.consents.analysis) {
    const currency = state.planning.currency || "AUD";
    for (const b of state.risk?.budgets || []) {
      if (minor(b.delta, currency) <= 0n) continue;
      items.push({
        id: ["budget", period, currency, b.category, b.actual].join("|"),
        kind: "budget",
        severity: "warning",
        currency,
        period,
        date: period + "-01",
        name: b.category,
        amount: b.delta,
        actual: b.actual,
        limit: b.amount,
        source: "confirmed_ledger",
        target: { tab: "ledger", period, currency, category: b.category },
      });
    }
    const reversed = new Set(
      state.transactions.map((e) => e.reverses).filter(Boolean),
    );
    for (const e of state.transactions) {
      if (
        e.kind !== "income" ||
        e.reverses ||
        reversed.has(e.id) ||
        !e.date.startsWith(period) ||
        !salary.has(e.category.trim().toLowerCase())
      )
        continue;
      items.push({
        id: "income|" + e.id,
        kind: "income",
        severity: "positive",
        currency: e.currency,
        period,
        date: e.date,
        name: e.merchant,
        amount: e.amount,
        source: "confirmed_ledger",
        source_ids: [e.id],
        target: {
          tab: "ledger",
          period,
          currency: e.currency,
          resource_id: e.id,
        },
      });
    }
    for (const entry of state.investments || []) {
      if (
        entry.archived ||
        !["stock", "etf", "fund"].includes(entry.asset_type)
      )
        continue;
      const effective = new Map();
      for (const point of [...(valuations[entry.id] || [])].sort(
        (a, b) =>
          a.observed_at.localeCompare(b.observed_at) || a.version - b.version,
      ))
        if (point.observed_at.slice(0, 7) <= period)
          effective.set(point.observed_at, point);
      const points = [...effective.values()].slice(-2);
      if (points.length !== 2 || points[1].observed_at.slice(0, 7) !== period)
        continue;
      const [before, after] = points,
        old = scaledPrice(before.content.price),
        current = scaledPrice(after.content.price);
      if (old === null || current === null || old <= 0n || current >= old)
        continue;
      const hundredths = ((old - current) * 10000n + old / 2n) / old;
      items.push({
        id: ["price", entry.id, after.id, before.id].join("|"),
        kind: "price",
        severity: "watch",
        currency: entry.currency,
        period,
        date: after.observed_at.slice(0, 10),
        name: entry.name,
        percent: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, "0")}`,
        previous_price: before.content.price,
        price: after.content.price,
        previous_observed_at: before.observed_at,
        observed_at: after.observed_at,
        source: "saved_valuations",
        source_ids: [before.id, after.id],
        target: {
          tab: "portfolio",
          period,
          currency: entry.currency,
          resource_id: entry.id,
        },
      });
    }
  }
  const order = { budget: 0, price: 1, income: 2 },
    read = new Set(readIds);
  const visible = items
    .sort(
      (a, b) =>
        order[a.kind] - order[b.kind] ||
        b.date.localeCompare(a.date) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, 50)
    .map((item) => ({ ...item, read: read.has(item.id) }));
  return {
    items: visible,
    unread_count: visible.filter((n) => !n.read).length,
    period,
    as_of: state.as_of,
    analysis_authorized: state.consents.analysis,
    ledger_version: state.ledger_version,
    settings_version: state.settings_version,
    limit: 50,
    delivery: "in_app",
    live_bank_or_market: false,
  };
}
