import { minor, format, summaries } from "./calculations.mjs";

export function enrichDemoState(state) {
  const enabled = state.consents.analysis,
    pending = state.drafts.length,
    period = state.period;
  const effective = state.transactions.filter(
    (e) =>
      !e.reverses &&
      e.kind !== "opening" &&
      !state.transactions.some((r) => r.reverses === e.id) &&
      e.date.startsWith(period),
  );
  const facts = Object.fromEntries(
    [
      "overview",
      "ledger",
      "planning",
      "portfolio",
      "reports",
      "assistant",
      "privacy",
    ].map((tab) => [
      tab,
      {
        scope: tab,
        period,
        as_of: state.as_of,
        severity: "INFO",
        completeness: "LIMITED",
        evidence_refs: [],
        params: {},
        mock: true,
      },
    ]),
  );
  Object.assign(facts.overview, {
    text_key: "还有 {count} 条草稿待确认。",
    params: { count: pending },
    drilldown: { tab: "ledger", status: "draft" },
  });
  Object.assign(facts.ledger, {
    text_key: "本月有 {count} 笔有效记录；草稿单独列出。",
    params: { count: effective.length },
    evidence_refs: effective.map((e) => e.id),
    drilldown: { tab: "ledger" },
  });
  Object.assign(facts.planning, {
    text_key: "预算与目标由你批准；未知资料不会按零计算。",
    drilldown: { tab: "planning" },
  });
  const overs = (state.risk?.budgets || []).filter(
    (b) => minor(b.delta, state.planning.currency) > 0n,
  );
  if (enabled && overs.length) {
    const b = overs.sort((a, b) => Number(b.delta) - Number(a.delta))[0],
      drilldown = {
        tab: "ledger",
        category: b.category,
        currency: state.planning.currency,
      };
    Object.assign(facts.overview, {
      text_key:
        "{category} 超出预算 {amount} {currency}，还有 {count} 条草稿。",
      params: {
        category: b.category,
        amount: b.delta,
        currency: state.planning.currency,
        count: pending,
      },
      severity: "WATCH",
      drilldown,
    });
    Object.assign(facts.planning, {
      text_key: "{category} 超出预算 {amount} {currency}。",
      params: {
        category: b.category,
        amount: b.delta,
        currency: state.planning.currency,
      },
      severity: "WATCH",
      drilldown,
    });
  }
  Object.assign(facts.portfolio, {
    text_key: "{count} 项本地投资，{missing} 项成本未知。",
    params: {
      count: state.investments.length,
      missing: state.investments.filter((e) => e.latest?.cost_basis == null)
        .length,
    },
    drilldown: { tab: "portfolio" },
  });
  Object.assign(facts.reports, {
    text_key:
      "{period} 有 {count} 个固定版本；当前 {pending} 条草稿不计入账单。",
    params: {
      period,
      count: state.statements.filter((s) => s.period === period).length,
      pending,
    },
    drilldown: { tab: "reports" },
  });
  Object.assign(facts.assistant, {
    text_key: "可以记录、查询和修正本地条目；所有正式变更需确认。",
    drilldown: { tab: "assistant" },
  });
  Object.assign(facts.privacy, {
    text_key: "数据留在本机。分析：{analysis}；凭证识别：{ocr}。",
    params: {
      analysis: enabled ? "已开启" : "未开启",
      ocr: state.consents.ocr ? "已开启" : "未开启",
    },
    drilldown: { tab: "privacy" },
  });
  if (!enabled)
    for (const tab of [
      "overview",
      "ledger",
      "planning",
      "portfolio",
      "reports",
    ])
      Object.assign(facts[tab], {
        text_key: "已保存记录；开启本地分析后查看摘要与关系图。",
        params: {},
        severity: "DATA_GAP",
        drilldown: { tab: "privacy" },
      });
  state.page_insights = facts;
  state.command_capabilities = {
    parser: "local-rule-1",
    max_operations: 20,
    cloud: false,
  };
  state.data_counts = {
    accounts: state.accounts.length,
    drafts: pending,
    events: state.transactions.length,
    investments: state.investments.length,
    statements: state.statements.length,
  };
  state.cash_bridge = [];
  state.month_comparison = [];
  if (enabled) {
    const cash = new Set(
        state.accounts.filter((a) => a.type === "cash").map((a) => a.id),
      ),
      groups = new Map();
    for (const e of state.transactions)
      if (e.date.startsWith(period) && e.kind !== "opening") {
        const key = `${e.currency}:${e.kind}`,
          value = e.postings
            .filter(([a]) => cash.has(a))
            .reduce((s, [, amount]) => s + minor(amount, e.currency), 0n);
        groups.set(key, (groups.get(key) || 0n) + value);
      }
    state.cash_bridge = [...groups].map(([key, value]) => {
      const [currency, kind] = key.split(":");
      return { currency, kind, amount: format(value, currency) };
    });
    const [year, month] = period.split("-").map(Number),
      cursor = year * 12 + month - 1;
    for (const n of [2, 1, 0]) {
      const p = cursor - n,
        month = `${Math.floor(p / 12)}-${String((p % 12) + 1).padStart(2, "0")}`;
      if (
        state.transactions.some(
          (e) => e.date.startsWith(month) && e.kind !== "opening",
        )
      )
        state.month_comparison.push(
          ...summaries(state.transactions, state.accounts, month).map((s) => ({
            ...s,
            period: month,
            coverage: "UNKNOWN",
          })),
        );
    }
  }
  state.investment_summary = enabled
    ? (state.portfolio || []).map((p) => ({
        currency: p.currency,
        current_value: p.total,
        known_count: p.positions.filter((x) => x.cost_basis != null).length,
        unknown_count: p.positions.filter((x) => x.cost_basis == null).length,
      }))
    : [];
  return state;
}
