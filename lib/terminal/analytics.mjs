import { minor, format } from "../demo/calculations.mjs";

export const SERIES_COLORS = [
  "#388bff",
  "#10dca0",
  "#f5c451",
  "#9e70ff",
  "#ff8b67",
  "#79b9f5",
];

// Ledger/worksheet amounts remain integers in the currency's smallest unit.
export function assetAllocation(state, currency) {
  const slices = [];
  const cash = state.accounts
    .filter((a) => a.currency === currency && a.type === "cash")
    .reduce((sum, a) => sum + minor(a.balance || "0", currency), 0n);
  if (cash > 0n)
    slices.push({
      id: "cash",
      name: "Cash",
      value: format(cash, currency),
      source: "confirmed-ledger",
    });
  for (const investment of state.investments || []) {
    if (investment.currency !== currency || investment.archived) continue;
    const value =
      investment.latest?.market_value ??
      investment.latest?.content?.market_value;
    // API and Demo expose the same current holdings contract.
    const holding = state.holdings?.find(
      (h) => h.id === investment.id || h.investment_id === investment.id,
    );
    const amount = value ?? holding?.market_value;
    if (amount != null && minor(amount, currency) > 0n)
      slices.push({
        id: investment.id,
        name: investment.name,
        value: amount,
        source: "manual-observation",
      });
  }
  const total = slices.reduce((sum, x) => sum + minor(x.value, currency), 0n);
  return {
    currency,
    total: format(total, currency),
    slices: slices.map((x, i) => ({
      ...x,
      color: SERIES_COLORS[i % SERIES_COLORS.length],
      percent: total
        ? Number((minor(x.value, currency) * 10000n) / total) / 100
        : 0,
    })),
  };
}

export function currentAllocationWorksheet(allocation) {
  return {
    currency: allocation.currency,
    total: allocation.total,
    status: "UNCHANGED_CURRENT_ALLOCATION",
    execution: false,
    fees: null,
    taxes: null,
    rows: allocation.slices.map((s) => ({
      id: s.id,
      name: s.name,
      current: s.value,
      target_percent: String(s.percent),
      target_value: s.value,
      change: format(0n, allocation.currency),
    })),
  };
}
export function allocationWorksheet(allocation, targets) {
  const total = minor(allocation.total, allocation.currency);
  const weights = allocation.slices.map((s) => {
    const input = String(targets[s.id] ?? s.percent);
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(input))
      throw new Error(
        "Target weights must be between 0 and 100 with at most two decimals.",
      );
    const [a, b = ""] = input.split(".");
    const weight = BigInt(a) * 100n + BigInt(b.padEnd(2, "0"));
    if (weight > 10000n) throw new Error("Target weight exceeds 100%.");
    return weight;
  });
  if (weights.reduce((a, b) => a + b, 0n) !== 10000n)
    throw new Error("Target weights must total exactly 100%.");
  let assigned = 0n;
  const rows = allocation.slices.map((s, i) => {
    const target =
      i === allocation.slices.length - 1
        ? total - assigned
        : (total * weights[i]) / 10000n;
    assigned += target;
    const current = minor(s.value, allocation.currency);
    return {
      id: s.id,
      name: s.name,
      current: s.value,
      target_percent: String(Number(weights[i]) / 100),
      target_value: format(target, allocation.currency),
      change: format(target - current, allocation.currency),
    };
  });
  return {
    currency: allocation.currency,
    total: allocation.total,
    rows,
    status: "USER_DEFINED_WORKSHEET",
    execution: false,
    fees: null,
    taxes: null,
  };
}

// Historical VaR is only available for sufficiently long, regular unit-price
// histories. Market-value changes can be deposits, so they are never prices.
export function historicalRisk(
  observations,
  currency,
  {
    frequency = "regular",
    closedDates = [],
    market = "Unspecified",
    adjustment = "unknown",
  } = {},
) {
  const points = observations
    .map((o) => ({
      at: Date.parse(o.observed_at),
      price: Number(o.unit_price ?? o.content?.unit_price),
    }))
    .sort((a, b) => a.at - b.at);
  if (
    points.some(
      (p) =>
        !Number.isFinite(p.at) || !Number.isFinite(p.price) || p.price <= 0,
    )
  )
    return { available: false, reason: "INVALID_PRICE_OR_DATE", currency };
  if (points.some((p, i) => i && p.at === points[i - 1].at))
    return { available: false, reason: "DUPLICATE_DATES", currency };
  const unique = points;
  if (unique.length < 21)
    return {
      available: false,
      reason: "NEEDS_21_UNIT_PRICE_OBSERVATIONS",
      currency,
    };
  if (unique.length > 500)
    return { available: false, reason: "TOO_MANY_OBSERVATIONS", currency };
  const intervals = unique.slice(1).map((p, i) => p.at - unique[i].at);
  const median = [...intervals].sort((a, b) => a - b)[
    Math.floor(intervals.length / 2)
  ];
  const closures = new Set(closedDates);
  if (
    !["regular", "calendar_days", "weekdays"].includes(frequency) ||
    closedDates.some(
      (d) =>
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !Number.isFinite(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d,
    )
  )
    return { available: false, reason: "INVALID_CALENDAR", currency };
  const isSession = (at) =>
    frequency !== "weekdays" ||
    (![0, 6].includes(new Date(at).getUTCDay()) &&
      !closures.has(new Date(at).toISOString().slice(0, 10)));
  if (unique.some((p) => !isSession(p.at)))
    return {
      available: false,
      reason: "OBSERVATION_OUTSIDE_CALENDAR",
      currency,
    };
  if (frequency === "regular") {
    if (intervals.some((d) => Math.abs(d - median) > median * 0.25))
      return { available: false, reason: "IRREGULAR_OBSERVATIONS", currency };
  } else
    for (let i = 1; i < unique.length; i++) {
      let expected = unique[i - 1].at + 86400000;
      while (!isSession(expected)) expected += 86400000;
      if (unique[i].at !== expected)
        return {
          available: false,
          reason: "MISSING_SESSION",
          missing_date: new Date(expected).toISOString().slice(0, 10),
          currency,
        };
    }
  const returns = unique
    .slice(1)
    .map((p, i) => p.price / unique[i].price - 1)
    .sort((a, b) => a - b);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  if (
    !Number.isFinite(mean) ||
    returns.some((r) => !Number.isFinite((r - mean) ** 2))
  )
    return { available: false, reason: "PRICE_RANGE_UNSUPPORTED", currency };
  return {
    available: true,
    method: "historical-observation-interval",
    frequency,
    market,
    adjustment,
    closed_dates: [...closures].sort(),
    calendar:
      frequency === "weekdays"
        ? "WEEKDAYS_WITH_USER_DECLARED_CLOSURES"
        : "REGULAR_CALENDAR_INTERVAL",
    window_start: new Date(unique[0].at).toISOString().slice(0, 10),
    window_end: new Date(unique.at(-1).at).toISOString().slice(0, 10),
    observations: unique.length,
    interval_days: median / 86400000,
    loss_percent_95:
      Math.max(0, -returns[Math.floor((returns.length - 1) * 0.05)]) * 100,
    volatility_percent:
      Math.sqrt(
        returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1),
      ) * 100,
    currency,
  };
}

export function csvWorksheet(worksheet) {
  const quote = (s) =>
    `"${String(s)
      .replaceAll('"', '""')
      .replace(/^[\s\uFEFF]*[=+@-]/, "'$&")}"`;
  const rows = [
    [
      "type",
      "currency",
      "name",
      "current",
      "target_percent",
      "target_value",
      "change",
    ],
    ...worksheet.rows.map((r) => [
      "ILLUSTRATION_NOT_ORDER",
      worksheet.currency,
      r.name,
      r.current,
      r.target_percent,
      r.target_value,
      r.change,
    ]),
  ];
  return rows.map((r) => r.map(quote).join(",")).join("\r\n");
}
