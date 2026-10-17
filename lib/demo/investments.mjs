import { minor, format, product } from "./calculations.mjs";

export function investmentPerformance(
  entry,
  valuations,
  events,
  observations = [],
) {
  const c = entry.currency,
    sorted = [...valuations].sort(
      (a, b) =>
        a.observed_at.localeCompare(b.observed_at) || a.version - b.version,
    ),
    latest = new Map();
  for (const point of sorted) latest.set(point.observed_at, point);
  let initial;
  const points = [];
  for (const p of latest.values()) {
    const v = p.content;
    if (!initial && v.cost_basis !== null && v.cost_basis !== undefined)
      initial = p;
    const applicable = events.filter((e) => e.observed_at <= p.observed_at);
    const gain =
      v.market_value != null && v.cost_basis != null
        ? minor(v.market_value, c) - minor(v.cost_basis, c)
        : null;
    let realized = 0n,
      distribution = 0n,
      fees = 0n,
      taxes = 0n,
      basis = initial ? minor(initial.content.cost_basis, c) : null;
    let complete = Boolean(
      entry.history_complete && initial && v.fees_taxes_known,
    );
    for (const e of applicable) {
      const x = e.content;
      if (x.type === "sell") {
        if (x.cost_allocated == null) complete = false;
        else {
          realized += minor(x.amount, c) - minor(x.cost_allocated, c);
          if (basis !== null && e.observed_at > initial.observed_at)
            basis -= minor(x.cost_allocated, c);
        }
      } else if (x.type === "distribution") {
        if (!x.distribution_in_cost) distribution += minor(x.amount, c);
        else if (basis !== null && e.observed_at > initial.observed_at)
          basis -= minor(x.amount, c);
      } else if (
        ["buy", "reinvestment"].includes(x.type) &&
        basis !== null &&
        e.observed_at > initial.observed_at
      )
        basis +=
          minor(x.cost_added || x.amount, c) +
          (x.capitalized && !x.cost_added ? minor(x.fee || "0", c) : 0n);
      else if (x.type === "fee" && !x.capitalized && !x.included_in_net)
        fees += minor(x.amount, c);
      else if (x.type === "tax" && !x.included_in_net)
        taxes += minor(x.amount, c);
      if (["sell", "buy", "distribution", "reinvestment"].includes(x.type)) {
        if (x.fee == null || x.tax == null) complete = false;
        else {
          if (!x.capitalized && !x.included_in_net) fees += minor(x.fee, c);
          if (!x.included_in_net) taxes += minor(x.tax, c);
        }
      }
    }
    const basisMatches =
      basis !== null &&
      v.cost_basis != null &&
      basis === minor(v.cost_basis, c);
    if (!basisMatches) complete = false;
    const total =
      gain === null ? null : gain + realized + distribution - fees - taxes;
    points.push({
      id: p.id,
      observed_at: p.observed_at,
      currency: c,
      market_value: v.market_value,
      unrealized: gain === null ? null : format(gain, c),
      unrealized_percent:
        gain === null || minor(v.cost_basis, c) <= 0n
          ? null
          : (() => {
              const base = minor(v.cost_basis, c),
                n = gain * 1000000n,
                absolute = n < 0n ? -n : n,
                rounded = (absolute + base / 2n) / base;
              return `${n < 0n ? "-" : ""}${rounded / 10000n}.${String(rounded % 10000n).padStart(4, "0")}`;
            })(),
      net_gain: total === null ? null : format(total, c),
      net_quality:
        complete && total !== null ? "VERIFIED_HISTORY" : "KNOWN_COMPONENTS",
      reported_gain:
        v.reported_semantics === "CUMULATIVE" ? v.reported_gain : null,
      reported_semantics: v.reported_semantics,
      evidence: v.evidence,
      version: p.version,
      event_refs: applicable.map((e) => e.id),
      basis_matches: basisMatches,
      components: {
        realized: format(realized, c),
        distribution: format(distribution, c),
        fees: format(fees, c),
        taxes: format(taxes, c),
      },
    });
  }
  const reported = new Map();
  for (const p of points)
    if (p.reported_gain != null)
      reported.set(p.observed_at, {
        ...p,
        amount: p.reported_gain,
        mode: "REPORTED_GAIN",
      });
  for (const p of [...observations].sort(
    (a, b) =>
      a.observed_at.localeCompare(b.observed_at) || a.version - b.version,
  ))
    if (p.content.reported_semantics === "CUMULATIVE")
      reported.set(p.observed_at, {
        ...p,
        currency: c,
        amount: p.content.reported_gain,
        mode: "REPORTED_GAIN",
        evidence: p.content.evidence,
      });
  return {
    investment_id: entry.id,
    currency: c,
    points,
    reported_points: [...reported.values()].sort(
      (a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at),
    ),
    events,
    mock: true,
    limits: [
      "观察点连线，不代表期间每日实测。",
      "收益口径不同的点不连接；未知资料不填零。",
    ],
  };
}

export function upgradeInvestments(db, stamp) {
  if (db.experience_version === 2) return;
  const state = db.state;
  state.investments = (state.holdings || []).map((h) => ({
    id: h.id,
    name: h.name,
    issuer: h.issuer,
    currency: h.currency,
    asset_type: h.asset_type,
    mock: true,
    history_complete: false,
    version: 1,
    archived: false,
  }));
  db.valuations = (state.holdings || []).map((h) => ({
    id: `demo-valuation-${h.id}`,
    investment_id: h.id,
    observed_at: new Date(h.observed_at).toISOString(),
    version: 1,
    content: {
      ...h,
      market_value: format(
        product(h.quantity, h.price, h.currency),
        h.currency,
      ),
      cost_basis: h.cost_basis,
      reported_gain: null,
      reported_semantics: null,
      fees_taxes_known: false,
      evidence: { source: "DEMO_LEGACY_PRESET", mock: true },
    },
  }));
  db.performance_events = [];
  const stock = state.investments.find((entry) => entry.asset_type === "stock");
  const current =
    stock && db.valuations.find((point) => point.investment_id === stock.id);
  if (current && current.observed_at > "2026-09-23T06:00:00.000Z")
    db.valuations.push({
      id: "demo-stock-price-before",
      investment_id: stock.id,
      observed_at: "2026-09-23T06:00:00.000Z",
      version: 1,
      content: {
        ...current.content,
        price: "90.00",
        market_value: format(
          product(current.content.quantity, "90.00", stock.currency),
          stock.currency,
        ),
        evidence: { source: "DEMO_NOTIFICATION_PRESET", mock: true },
      },
    });
  db.performance_observations = [];
  db.commands = {};
  db.import_batches = {};
  db.operation_receipts = {};
  db.experience_version = 2;
  state.portfolio_version = 0;
  for (const key of ["budgets", "goals"])
    state.planning[key] = (state.planning[key] || []).map((x, i) => ({
      ...x,
      id: x.id || `demo-${key}-${i + 1}`,
      version: x.version || 1,
    }));
  if (db.locked) return;
  const id = "demo-investment-capital-history";
  state.investments.push({
    id,
    name: "Capital & distributions example",
    issuer: "Synthetic fund",
    currency: "CNY",
    asset_type: "fund",
    history_complete: true,
    mock: true,
    version: 1,
    archived: false,
  });
  const values = [
    ["1000.00", "1000.00"],
    ["1100.00", "1000.00"],
    ["1600.00", "1500.00"],
    ["1700.00", "1500.00"],
    ["1150.00", "1000.00"],
  ];
  values.forEach(([value, cost], i) =>
    db.valuations.push({
      id: `demo-history-point-${i}`,
      investment_id: id,
      version: 1,
      observed_at: `2026-09-${String(i + 1).padStart(2, "0")}T06:00:00.000Z`,
      content: {
        market_value: value,
        cost_basis: cost,
        fees_taxes_known: true,
        reported_gain: null,
        reported_semantics: null,
        evidence: {
          source: "DEMO_CAPITAL_DISTRIBUTION_CASE",
          mock: true,
          observed_at: stamp,
        },
      },
    }),
  );
  for (const [type, amount, day, extra] of [
    ["buy", "500.00", "03", { cost_added: "500.00" }],
    ["distribution", "20.00", "03", {}],
    ["sell", "550.00", "05", { cost_allocated: "500.00", fee: "5.00" }],
  ])
    db.performance_events.push({
      id: `demo-history-${type}`,
      investment_id: id,
      observed_at: `2026-09-${day}T06:00:00.000Z`,
      content: {
        type,
        amount,
        fee: "0.00",
        tax: "0.00",
        evidence: { source: "DEMO_PRESET", mock: true },
        ...extra,
      },
    });
}
