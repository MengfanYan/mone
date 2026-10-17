"use client";
import { pageInsight } from "@/lib/page-insights.mjs";
import { useLocale } from "./locale-provider";
import { Money } from "./financial-values";
import { ArrowUpRight, ShieldCheck, ListChecks } from "lucide-react";

export default function PageSummary({ state, tab, currency, onDrill }) {
  const { t } = useLocale();
  const summary = state.summary?.find((s) => s.currency === currency),
    risk = state.risk,
    counts = state.data_counts || {};
  let metrics;
  if (tab === "privacy")
    metrics = [
      ["本地账户", counts.accounts],
      ["已保存事件", counts.events],
      ["投资条目", counts.investments],
      ["固定月报", counts.statements],
    ];
  else if (tab === "assistant")
    metrics = [
      ["待确认草稿", counts.drafts],
      ["支持的批次上限", state.command_capabilities?.max_operations || 20],
      ["外部支付与交易", t("未开放")],
    ];
  else if (!state.consents.analysis)
    metrics = [
      ["已保存事件", counts.events],
      ["待确认草稿", counts.drafts],
      ["本地投资", counts.investments],
    ];
  else if (tab === "planning")
    metrics = [
      [
        "可用现金",
        risk?.metrics.currency === currency ? risk.metrics.available : null,
        currency,
      ],
      [
        "剩余预算",
        state.planning.currency === currency ? risk?.budget_remaining : null,
        currency,
      ],
      ["储蓄目标", state.planning.goals?.length || 0],
    ];
  else if (tab === "portfolio") {
    const p = state.investment_summary?.find((x) => x.currency === currency);
    metrics = [
      ["当前有证据市值", p?.current_value, currency],
      ["已知成本条目", p?.known_count || 0],
      ["未知成本条目", p?.unknown_count || 0],
    ];
  } else
    metrics = [
      ["确认收入", summary?.income, currency],
      ["确认费用（扣退款）", summary?.expenses, currency],
      ["收入减费用", summary?.surplus, currency],
      ["待确认草稿", counts.drafts],
    ];
  const insight = pageInsight(state, tab, currency);
  return (
    <section className="page-summary" aria-label={t("页面摘要")}>
      <div className="summary-facts">
        {metrics.map(([label, value, code]) => (
          <div key={label}>
            <span>{t(label)}</span>
            <strong>
              {code ? <Money value={value} currency={code} /> : (value ?? "—")}
            </strong>
          </div>
        ))}
      </div>
      <div className="summary-scope">
        <span>
          {tab === "privacy" ? (
            <ShieldCheck size={15} />
          ) : (
            <ListChecks size={15} />
          )}{" "}
          {t(
            tab === "portfolio"
              ? "当前手工观察，不是实时行情；历史按月份查看。"
              : "范围：{period} · {currency} · 未确认候选不计入",
            { period: state.period, currency },
          )}
        </span>
        <button
          className="text-button"
          onClick={() => onDrill(insight?.drilldown || { tab })}
        >
          {t("查看依据")}
          <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}
