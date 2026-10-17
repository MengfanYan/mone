// Currency-scoped presentation uses record identity only, never converts money.
export function pageInsight(state, tab, currency) {
  const original = state.page_insights?.[tab];
  if (!original || !state.consents.analysis) return original;
  if (tab === "ledger") {
    const reversed = new Set(
      state.transactions.map((e) => e.reverses).filter(Boolean),
    );
    const events = state.transactions.filter(
      (e) =>
        e.currency === currency &&
        e.date.startsWith(state.period) &&
        e.kind !== "opening" &&
        !e.reverses &&
        !reversed.has(e.id),
    );
    return {
      ...original,
      text_key: "本月{currency}有{count}笔有效记录；草稿单独列出。",
      params: { currency, count: events.length },
      evidence_refs: events.map((e) => e.id),
    };
  }
  if (tab === "portfolio") {
    const entries = state.investments.filter(
      (e) => e.currency === currency && !e.archived,
    );
    return {
      ...original,
      text_key: "{currency}有{count}项本地投资，{missing}项成本未知。",
      params: {
        currency,
        count: entries.length,
        missing: entries.filter((e) => e.latest?.cost_basis == null).length,
      },
    };
  }
  if (original.params?.currency && original.params.currency !== currency)
    return {
      ...original,
      text_key:
        tab === "overview"
          ? "还有 {count} 条草稿待确认。"
          : "预算与目标由你批准；未知资料不会按零计算。",
      params: { count: state.drafts.length },
      drilldown: { tab: tab === "overview" ? "ledger" : "planning" },
    };
  return original;
}
