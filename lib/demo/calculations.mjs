// Exact decimal arithmetic for the synthetic sandbox. The live Python engine is unchanged.
export const precision = {
  AUD: 2,
  CNY: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  NZD: 2,
  CAD: 2,
  HKD: 2,
  SGD: 2,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
};

export function minor(value, currency = "AUD") {
  const digits = precision[currency];
  if (digits === undefined || !/^-?\d+(?:\.\d+)?$/.test(String(value)))
    throw new Error("INVALID_AMOUNT");
  const [whole, fraction = ""] = String(value).replace(/^-/, "").split(".");
  if (fraction.length > digits) throw new Error("CURRENCY_PRECISION");
  const amount =
    BigInt(whole) * 10n ** BigInt(digits) +
    BigInt(fraction.padEnd(digits, "0") || "0");
  return String(value).startsWith("-") ? -amount : amount;
}

export function format(amount, currency = "AUD") {
  const digits = precision[currency],
    scale = 10n ** BigInt(digits);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? "-" : ""}${absolute / scale}${digits ? "." + String(absolute % scale).padStart(digits, "0") : ""}`;
}

export function ratio(numerator, denominator, multiplier = 1n) {
  if (denominator <= 0n) return null;
  const value = numerator * multiplier * 100n;
  const absolute = value < 0n ? -value : value;
  const rounded = (absolute + denominator / 2n) / denominator;
  return format(value < 0n ? -rounded : rounded);
}

export function product(quantity, price, currency) {
  const parse = (value) => {
    if (!/^\d+(?:\.\d{1,8})?$/.test(String(value)))
      throw new Error("INVALID_DECIMAL");
    const [whole, fraction = ""] = String(value).split(".");
    return BigInt(whole + fraction.padEnd(8, "0"));
  };
  const divisor = 10n ** BigInt(16 - precision[currency]);
  return (parse(quantity) * parse(price) + divisor / 2n) / divisor;
}

export function summaries(events, accounts, period) {
  const currencies = [
    ...new Set([...accounts, ...events].map((item) => item.currency)),
  ].sort();
  return currencies.map((currency) => {
    const cash = new Set(
      accounts
        .filter((a) => a.currency === currency && a.type === "cash")
        .map((a) => a.id),
    );
    let income = 0n,
      expenses = 0n,
      opening = 0n,
      movement = 0n;
    const categories = {};
    for (const event of events.filter((e) => e.currency === currency)) {
      const delta = event.postings
        .filter(([id]) => cash.has(id))
        .reduce((sum, [, value]) => sum + minor(value, currency), 0n);
      if (event.date < `${period}-01`) opening += delta;
      if (!event.date.startsWith(period)) continue;
      movement += delta;
      const amount =
        minor(event.amount, currency) * BigInt(event.direction || "1");
      if (["income", "dividend"].includes(event.kind)) income += amount;
      if (["expense", "interest", "refund"].includes(event.kind)) {
        const cost = event.kind === "refund" ? -amount : amount;
        expenses += cost;
        categories[event.category] = (categories[event.category] || 0n) + cost;
      }
    }
    return {
      currency,
      income: format(income, currency),
      expenses: format(expenses, currency),
      surplus: format(income - expenses, currency),
      opening_cash: format(opening, currency),
      cash_change: format(movement, currency),
      closing_cash: format(opening + movement, currency),
      categories: Object.fromEntries(
        Object.entries(categories).map(([key, value]) => [
          key,
          format(value, currency),
        ]),
      ),
      savings_rate_percent: ratio(income - expenses, income, 100n),
      expense_income_percent: ratio(expenses, income, 100n),
    };
  });
}

export function moneyFlow(events, accounts, period) {
  const lastDay = new Date(
    Number(period.slice(0, 4)),
    Number(period.slice(5)),
    0,
  ).getDate();
  return summaries(events, accounts, period).map(({ currency }) => ({
    currency,
    calc_version: "demo-ledger-1",
    points: Array.from({ length: Math.ceil(lastDay / 7) }, (_, i) => {
      const start = i * 7 + 1,
        end = Math.min(start + 6, lastDay);
      const selected = events.filter(
        (e) =>
          e.date.startsWith(period) &&
          Number(e.date.slice(-2)) >= start &&
          Number(e.date.slice(-2)) <= end,
      );
      const result = summaries(selected, accounts, period).find(
        (s) => s.currency === currency,
      );
      return {
        label: `${String(start).padStart(2, "0")}–${String(end).padStart(2, "0")}`,
        income: result.income,
        expenses: result.expenses,
      };
    }),
  }));
}

export function riskFor(accounts, summary, planning, today) {
  const currency = planning.currency || "AUD";
  const cash = accounts
    .filter((a) => a.type === "cash" && a.currency === currency)
    .reduce((sum, a) => sum + minor(a.balance, currency), 0n);
  const complete = [
    "monthly_income",
    "essential_spend",
    "debt_payment",
    "earmarked",
  ].every(
    (key) =>
      planning[key] !== null &&
      planning[key] !== "" &&
      planning[key] !== undefined,
  );
  const metrics = {
    currency,
    cash: format(cash, currency),
    available: null,
    cash_30d: null,
    coverage_months: null,
    income_loss_months: null,
    debt_burden_percent: null,
  };
  const findings = [];
  if (complete) {
    const income = minor(planning.monthly_income, currency),
      burn =
        minor(planning.essential_spend, currency) +
        minor(planning.debt_payment, currency),
      available = cash - minor(planning.earmarked, currency);
    Object.assign(metrics, {
      available: format(available, currency),
      cash_30d: format(available + income - burn, currency),
      coverage_months: ratio(available, burn),
      income_loss_months: ratio(available > 0n ? available : 0n, burn),
      debt_burden_percent: ratio(
        minor(planning.debt_payment, currency),
        income,
        100n,
      ),
    });
    if (available < burn)
      findings.push({
        severity: "HIGH",
        message: "可用现金不足一个月必要支出和偿债。",
        metric_id: "risk.coverage_months",
      });
    if (available + income - burn < 0n)
      findings.push({
        severity: "HIGH",
        message: "在用户输入的稳定收入假设下，30天现金出现缺口。",
        metric_id: "risk.cash_30d",
      });
  } else
    findings.push({
      severity: "DATA_GAP",
      message: "请填写稳定收入、必要支出、月偿债与圈定资金；缺资料不表示安全。",
      metric_id: null,
    });
  const categories =
    summary.find((s) => s.currency === currency)?.categories || {};
  const budgets = (planning.budgets || []).map((budget) => {
    const amount = minor(budget.amount, currency),
      actual = minor(categories[budget.category] || "0", currency);
    if (actual > amount)
      findings.push({
        severity: "WATCH",
        message: `${budget.category}已超过用户批准预算。`,
        metric_id: `budget:${budget.category}`,
      });
    return {
      ...budget,
      actual: format(actual, currency),
      delta: format(actual - amount, currency),
      used_percent: ratio(actual, amount, 100n),
    };
  });
  const goals = (planning.goals || []).map((goal) => {
    const months = BigInt(
      Math.max(
        1,
        (Number(goal.deadline.slice(0, 4)) - Number(today.slice(0, 4))) * 12 +
          Number(goal.deadline.slice(5, 7)) -
          Number(today.slice(5, 7)),
      ),
    );
    const remaining =
        minor(goal.target, currency) - minor(goal.saved, currency),
      gap = remaining > 0n ? remaining : 0n;
    return {
      ...goal,
      gap: format(gap, currency),
      monthly_required: format((gap + months - 1n) / months, currency),
      overdue: goal.deadline < today,
    };
  });
  return {
    metrics,
    findings,
    budgets,
    goals,
    budget_remaining: budgets.length
      ? format(
          budgets.reduce(
            (sum, b) =>
              sum + minor(b.amount, currency) - minor(b.actual, currency),
            0n,
          ),
          currency,
        )
      : null,
    policy_version: "demo-risk-1",
    assumptions: [
      "稳定月收入与必要支出由用户声明。",
      "无收益目标情景；无预测保证。",
      "仅规划币种；圈定金额不重复加入可用现金。",
    ],
  };
}

export function portfolioFor(holdings) {
  return [...new Set(holdings.map((h) => h.currency))].map((currency) => {
    const items = holdings.filter((h) => h.currency === currency),
      values = items.map((h) =>
        h.market_value != null
          ? minor(h.market_value, currency)
          : product(h.quantity, h.price, currency),
      );
    const total = values.reduce((sum, value) => sum + value, 0n);
    const issuers = {};
    items.forEach((h, i) => {
      issuers[h.issuer] = (issuers[h.issuer] || 0n) + values[i];
    });
    const largest = Object.values(issuers).reduce(
      (max, value) => (value > max ? value : max),
      0n,
    );
    return {
      currency,
      total: format(total, currency),
      issuer_hhi: total
        ? (
            Object.values(issuers).reduce((sum, v) => sum + Number(v) ** 2, 0) /
            Number(total) ** 2
          ).toFixed(4)
        : null,
      largest_issuer_percent: ratio(largest, total, 100n),
      positions: items.map((h, i) => ({
        ...h,
        market_value: format(values[i], currency),
        weight_percent: ratio(values[i], total, 100n),
        unrealized_gain:
          h.cost_basis === null
            ? null
            : format(values[i] - minor(h.cost_basis, currency), currency),
        quality: "DEMO_PRESET",
        coverage: ["stock", "etf", "bond", "cash"].includes(h.asset_type)
          ? "SIMPLE_ASSET"
          : "LIMITED",
      })),
      limitations: [
        "手工估值，不是实时行情；不计算TWR/XIRR或交易建议。",
        "缺少FX时按币种分别汇总；未知成本不记为零。",
      ],
    };
  });
}
