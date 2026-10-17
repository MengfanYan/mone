import { minor, format, precision } from "../demo/calculations.mjs";

export function effectiveRecords(state, currency, period = null) {
  const reversed = new Set(
    state.transactions.filter((e) => e.reverses).map((e) => e.reverses),
  );
  return state.transactions.filter(
    (e) =>
      e.currency === currency &&
      e.kind !== "opening" &&
      !e.reverses &&
      !reversed.has(e.id) &&
      (!period || e.date.startsWith(period)),
  );
}
const sum = (rows, currency, field = "amount") =>
  rows.reduce((n, e) => n + minor(e[field], currency), 0n);
const validDate = (value) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(value)) &&
  Number.isFinite(Date.parse(value)) &&
  new Date(value).toISOString().slice(0, 10) === value;
const min = (a, b) => (a < b ? a : b);
export function advisoryFacts(state, currency, period = state.period) {
  if (!state.consents.analysis || state.period !== period) return null;
  const events = effectiveRecords(state, currency, period);
  const cash = state.accounts.filter(
    (a) => a.type === "cash" && a.currency === currency,
  );
  const debt = state.accounts.filter(
    (a) =>
      a.type === "liability" &&
      a.currency === currency &&
      minor(a.balance, currency) > 0n,
  );
  const interest = events.filter((e) => e.kind === "interest");
  const budgets =
    state.planning.currency === currency ? state.risk?.budgets || [] : [];
  const prices = (state.notifications?.items || []).filter(
    (n) => n.kind === "price" && n.currency === currency && n.period === period,
  );
  return {
    period,
    currency,
    events,
    cash,
    debt,
    interest,
    interestTotal: format(sum(interest, currency), currency),
    cashTotal: format(sum(cash, currency, "balance"), currency),
    budgets,
    prices,
    summary: state.summary?.find((s) => s.currency === currency),
    subscriptions: subscriptionCandidates(state, currency, period),
    ledger_version: state.ledger_version,
    settings_version: state.settings_version,
  };
}
export function rebalanceBudget(state, currency, target, donor, value) {
  const facts = advisoryFacts(state, currency);
  if (!facts || target === donor) throw new Error("Invalid budget scope");
  const from = facts.budgets.find((b) => b.category === donor),
    to = facts.budgets.find((b) => b.category === target);
  const amount = minor(value, currency);
  if (
    !from ||
    !to ||
    amount <= 0n ||
    amount > minor(from.amount, currency) - minor(from.actual, currency)
  )
    throw new Error("Amount exceeds the available donor budget");
  const plan = structuredClone(state.planning);
  plan.budgets = plan.budgets.map((b) => ({
    ...b,
    amount: format(
      minor(b.amount, currency) +
        (b.category === target ? amount : b.category === donor ? -amount : 0n),
      currency,
    ),
  }));
  return plan;
}
export function payoffDraft(state, currency, sourceId, debtId, value, date) {
  const source = state.accounts.find(
    (a) =>
      a.id === sourceId &&
      a.type === "cash" &&
      !a.archived &&
      a.currency === currency,
  );
  const debt = state.accounts.find(
    (a) =>
      a.id === debtId &&
      a.type === "liability" &&
      !a.archived &&
      a.currency === currency,
  );
  const amount = minor(value, currency);
  if (
    !validDate(date) ||
    !state.consents.analysis ||
    !source ||
    !debt ||
    amount <= 0n ||
    amount > min(minor(source.balance, currency), minor(debt.balance, currency))
  )
    throw new Error("Choose available cash and a valid outstanding liability");
  return {
    kind: "debt_principal",
    amount: format(amount, currency),
    currency,
    date,
    merchant: `Principal repayment · ${debt.name}`,
    category: "Debt principal",
    account_id: source.id,
    counterparty_id: debt.id,
    refund_of: null,
    external_id: null,
    mock: Boolean(state.mock),
  };
}
const normalized = (name) =>
  String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
export function subscriptionCandidates(state, currency, period = state.period) {
  const rows = effectiveRecords(state, currency).filter(
    (e) => e.kind === "expense" && e.date.slice(0, 7) <= period,
  );
  const groups = new Map();
  for (const e of rows) {
    const key = JSON.stringify([
      normalized(e.merchant),
      e.account_id,
      e.amount,
    ]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return [...groups.values()].flatMap((events) => {
    events.sort((a, b) => a.date.localeCompare(b.date));
    const dates = [...new Set(events.map((e) => e.date))];
    const intervals = dates
      .slice(1)
      .map((d, i) => (Date.parse(d) - Date.parse(dates[i])) / 86400000);
    const recurring =
      dates.length >= 3 && intervals.slice(-2).every((n) => n >= 27 && n <= 32);
    const named = /subscription|monthly|订阅|月费/i.test(
      events.at(-1).merchant,
    );
    if (!recurring && !named) return [];
    const latest = events.at(-1),
      d = new Date(`${latest.date}T12:00:00Z`),
      day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + 1);
    d.setUTCDate(
      Math.min(
        day,
        new Date(
          Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
        ).getUTCDate(),
      ),
    );
    return [
      {
        merchant: latest.merchant,
        amount: latest.amount,
        currency,
        account_id: latest.account_id,
        recurring,
        evidence: events.map((e) => e.id),
        nextDate: recurring ? d.toISOString().slice(0, 10) : null,
      },
    ];
  });
}
export function refundCandidates(state, draft) {
  const f = draft.content || draft;
  if (
    !f.currency ||
    !f.amount ||
    !f.date ||
    f.refund_of ||
    !(f.kind === "refund" || /refund|退款/i.test(f.merchant || ""))
  )
    return [];
  const events = effectiveRecords(state, f.currency);
  const merchant = normalized(f.merchant)
    .replace(/\brefund\b|退款/g, "")
    .trim();
  return events.filter(
    (e) =>
      e.kind === "expense" &&
      e.date <= f.date &&
      e.account_id === f.account_id &&
      merchant &&
      normalized(e.merchant)
        .replace(/\brefund\b|退款/g, "")
        .trim() === merchant &&
      minor(e.amount, f.currency) -
        sum(
          events.filter((r) => r.kind === "refund" && r.refund_of === e.id),
          f.currency,
        ) >=
        minor(f.amount, f.currency),
  );
}
export function duplicateSubscriptions(state, currency, period = state.period) {
  const groups = new Map();
  for (const e of effectiveRecords(state, currency, period).filter(
    (e) => e.kind === "expense",
  )) {
    const k = JSON.stringify([
      normalized(e.merchant),
      e.amount,
      e.date,
      e.account_id,
    ]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  return [...groups.values()].filter((rows) => rows.length > 1);
}
export function monthDiningComparison(state, currency, period = state.period) {
  const d = new Date(`${period}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  const previous = d.toISOString().slice(0, 7);
  const value = (p) => {
    const e = effectiveRecords(state, currency, p).filter(
      (e) =>
        /^(Dining|餐饮)$/.test(e.category) &&
        ["expense", "interest", "refund"].includes(e.kind),
    );
    return {
      period: p,
      count: e.length,
      amount: format(
        e.reduce(
          (n, x) =>
            n + minor(x.amount, currency) * (x.kind === "refund" ? -1n : 1n),
          0n,
        ),
        currency,
      ),
      ids: e.map((x) => x.id),
    };
  };
  return { current: value(period), previous: value(previous) };
}
export function savingTarget(state, currency, percent) {
  if (!/^\d{1,3}$/.test(String(percent)) || Number(percent) > 100)
    throw new Error("Choose a target from 0 to 100");
  const summary = state.summary?.find((s) => s.currency === currency);
  if (!summary || minor(summary.income, currency) <= 0n) return null;
  const income = minor(summary.income, currency),
    expense = minor(summary.expenses, currency);
  const allowed = (income * (100n - BigInt(percent))) / 100n;
  return {
    allowed: format(allowed, currency),
    reduction: format(expense > allowed ? expense - allowed : 0n, currency),
    income: summary.income,
    expenses: summary.expenses,
  };
}
export function exposureGroups(state) {
  const values = new Map(),
    missing = [];
  for (const a of state.accounts) {
    const v =
      minor(a.balance, a.currency) * (a.type === "liability" ? -1n : 1n);
    values.set(a.currency, (values.get(a.currency) || 0n) + v);
  }
  for (const i of state.investments.filter((i) => !i.archived)) {
    const v = i.latest?.market_value;
    if (v == null) {
      missing.push(i.name);
      continue;
    }
    values.set(
      i.currency,
      (values.get(i.currency) || 0n) + minor(v, i.currency),
    );
  }
  return {
    rows: [...values].map(([currency, v]) => ({
      currency,
      amount: format(v, currency),
    })),
    missing,
  };
}
function decimalRate(s) {
  if (!/^\d{1,8}(?:\.\d{1,8})?$/.test(String(s)))
    throw new Error("Enter a positive rate with at most 8 decimals");
  const [w, f = ""] = String(s).split(".");
  const n = BigInt(w) * 100000000n + BigInt(f.padEnd(8, "0"));
  if (n <= 0n) throw new Error("Rate must be positive");
  return n;
}
function convert(value, from, to, rate) {
  const n =
      minor(value, from) * decimalRate(rate) * 10n ** BigInt(precision[to]),
    den = 100000000n * 10n ** BigInt(precision[from]);
  const abs = n < 0n ? -n : n;
  return ((abs + den / 2n) / den) * (n < 0n ? -1n : 1n);
}
export function unifiedWorth(state, base, quotes) {
  const exposure = exposureGroups(state),
    rows = [];
  let total = 0n,
    previous = 0n,
    completePrevious = true;
  const missing = [...exposure.missing];
  for (const r of exposure.rows) {
    const q = quotes[r.currency];
    if (
      r.currency !== base &&
      (!q?.rate || !validDate(q?.date) || !q?.source?.trim())
    ) {
      missing.push(r.currency);
      continue;
    }
    const current =
      r.currency === base
        ? minor(r.amount, base)
        : convert(r.amount, r.currency, base, q.rate);
    let old = null;
    if (r.currency === base) old = current;
    else if (q.previousRate)
      old = convert(r.amount, r.currency, base, q.previousRate);
    else completePrevious = false;
    total += current;
    if (old !== null) previous += old;
    rows.push({
      ...r,
      converted: format(current, base),
      rate: r.currency === base ? "1" : q.rate,
      date: q?.date,
      source: q?.source,
    });
  }
  return {
    base,
    rows,
    missing,
    total: missing.length ? null : format(total, base),
    fxEffect:
      missing.length || !completePrevious
        ? null
        : format(total - previous, base),
  };
}
export function cashProjection({
  cash,
  reserve,
  purchase,
  currency,
  asOf,
  commitments,
}) {
  let available =
    minor(cash, currency) -
    minor(reserve, currency) -
    minor(purchase, currency);
  const opening = available;
  if ([reserve, purchase].some((x) => minor(x, currency) < 0n))
    throw new Error("Reserve and purchase must be nonnegative");
  const start = new Date(`${asOf}T12:00:00Z`);
  if (!Number.isFinite(+start) || start.toISOString().slice(0, 10) !== asOf)
    throw new Error("Invalid as-of date");
  const rows = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1, 12),
    );
    const period = d.toISOString().slice(0, 7);
    let income = 0n,
      outflow = 0n;
    for (const c of commitments) {
      if (
        !c.date ||
        !c.name.trim() ||
        !["income", "outflow"].includes(c.kind) ||
        minor(c.amount, currency) <= 0n
      )
        throw new Error("Complete every scheduled item");
      const original = new Date(`${c.date}T12:00:00Z`);
      if (
        !Number.isFinite(+original) ||
        original.toISOString().slice(0, 10) !== c.date
      )
        throw new Error("Invalid schedule date");
      let due = c.date;
      if (c.monthly && c.date.slice(0, 7) <= period) {
        const day = Math.min(
          original.getUTCDate(),
          new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        );
        due = `${period}-${String(day).padStart(2, "0")}`;
      }
      if (due < asOf || !due.startsWith(period)) continue;
      if (c.kind === "income") income += minor(c.amount, currency);
      else outflow += minor(c.amount, currency);
    }
    available += income - outflow;
    rows.push({
      period,
      income: format(income, currency),
      outflow: format(outflow, currency),
      closing: format(available, currency),
    });
  }
  return { opening: format(opening, currency), rows };
}
export function cashToAsset(state, currency, investmentId, value) {
  const facts = advisoryFacts(state, currency),
    investment = state.investments.find(
      (i) =>
        i.id === investmentId &&
        !i.archived &&
        i.currency === currency &&
        i.latest?.market_value != null,
    );
  const amount = minor(value, currency),
    reserve =
      state.planning.currency === currency
        ? minor(state.planning.earmarked || "0", currency)
        : null;
  if (
    !facts ||
    !investment ||
    reserve === null ||
    !facts.summary ||
    amount <= 0n ||
    amount > minor(facts.summary.surplus, currency) ||
    amount > minor(facts.cashTotal, currency) - reserve
  )
    throw new Error(
      "Use a positive amount within recorded surplus and unreserved cash",
    );
  return {
    cashBefore: facts.cashTotal,
    cashAfter: format(minor(facts.cashTotal, currency) - amount, currency),
    investmentBefore: investment.latest.market_value,
    investmentAfter: format(
      minor(investment.latest.market_value, currency) + amount,
      currency,
    ),
    name: investment.name,
  };
}
export function narrativeBrief(state, currency, locale = "en") {
  const f = advisoryFacts(state, currency);
  if (!f)
    throw new Error("Analysis consent and a current snapshot are required");
  const escape = (s) =>
    String(s)
      .replace(/[\\`*_{}[\]<>#|]/g, "\\$&")
      .replace(/[\r\n]+/g, " ");
  const zh = locale === "zh",
    lines = [
      `# ${zh ? "财务简报" : "Financial brief"} · ${f.period} · ${currency}`,
      `\n${zh ? "确定性账本摘要，非模型推断" : "Deterministic ledger summary; no model inference"} · Ledger v${f.ledger_version}`,
    ];
  if (f.summary)
    lines.push(
      `\n${zh ? "已确认收入" : "Confirmed income"}: ${f.summary.income} ${currency}\n${zh ? "已确认费用" : "Confirmed expenses"}: ${f.summary.expenses} ${currency}\n${zh ? "收支结余" : "Surplus"}: ${f.summary.surplus} ${currency}`,
    );
  lines.push(
    `\n${zh ? "已记录利息费用" : "Recorded interest charges"}: ${f.interestTotal} ${currency}`,
  );
  for (const b of f.budgets)
    lines.push(
      `- ${escape(b.category)}: ${b.actual} / ${b.amount} ${currency}`,
    );
  lines.push(`\n## ${zh ? "来源事件" : "Source events"}`);
  for (const e of f.events)
    lines.push(
      `- ${e.date} · ${escape(e.merchant)} · ${e.amount} ${currency} · ${e.kind} · ID: ${escape(e.id)}`,
    );
  lines.push(
    `\n${zh ? "草稿不计入。仅涵盖已保存记录，账户未完成银行对账。" : "Drafts excluded. Covers saved records only; accounts have not been reconciled to bank statements."}`,
  );
  return lines.join("\n");
}

export function splitRecordFollowup(input) {
  const match = String(input).match(
    /^(.+?)[,，;；]?\s*(?:顺便|and\s+(?:check|show)|also\s+(?:check|show))(.+(?:budget|预算).*)$/i,
  );
  return match
    ? {
        record: match[1].replace(/[,，;；]$/, " ").trim(),
        budgetQuestion: match[2].trim(),
      }
    : { record: input, budgetQuestion: null };
}
