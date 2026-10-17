"use client";
import { Sparkles } from "lucide-react";
import { useLocale } from "./locale-provider";
export default function AnalysisQuery({
  value,
  onChange,
  onSubmit,
  busy,
  authorized,
  period,
  currency,
  onBasis,
}) {
  const { t } = useLocale();
  return (
    <section className="panel analysis-query">
      <h2>{t("你想了解什么？")}</h2>
      <div className="analysis-query-scope">
        <span>
          {t("范围")} · {period} · {currency}
        </span>
        <button className="text-button" onClick={onBasis}>
          {t("查看依据")}
        </button>
      </div>
      <form className="ask-form" onSubmit={onSubmit}>
        <input
          aria-label={t("财务分析问题")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("例如：这个月的现金变化为什么与结余不同？")}
          maxLength={2000}
          required
        />
        <button className="primary" disabled={busy || !authorized}>
          {busy ? t("分析中…") : t("分析")}
          <Sparkles size={16} />
        </button>
      </form>
      <div className="suggestions">
        {[
          "分析本月收支和现金风险",
          "无收入压力情景",
          "检查持仓风险",
          "查看市场证据",
        ].map((key) => (
          <button key={key} onClick={() => onChange(t(key))}>
            {t(key)}
          </button>
        ))}
      </div>
    </section>
  );
}
