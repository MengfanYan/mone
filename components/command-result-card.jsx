"use client";
import {
  Coffee,
  BriefcaseBusiness,
  FileText,
  Pencil,
  ArrowUpRight,
  TriangleAlert,
  CheckCircle2,
} from "lucide-react";
import { useLocale } from "./locale-provider";
import EvidenceQuality from "./evidence-quality";
import { Money } from "./financial-values";

export function CategoryIcon({ category = "", merchant = "", size = 19 }) {
  const Icon = /咖啡|coffee|dining|餐饮/i.test(category + merchant)
    ? Coffee
    : /income|salary|工资|兼职/i.test(category + merchant)
      ? BriefcaseBusiness
      : FileText;
  return <Icon size={size} aria-hidden="true" />;
}

export default function CommandResultCard({
  op,
  accounts,
  onChange,
  onEdit,
  locked,
  onOpen,
}) {
  const { t } = useLocale();
  const f = op.fields || {};
  return (
    <article
      className={`command-result ${op.errors?.length ? "needs-clarification" : ""}`}
    >
      <div className="command-result-heading">
        <span className="category-token">
          <CategoryIcon category={f.category} merchant={f.merchant || f.name} />
        </span>
        <div>
          <strong>{f.merchant || f.name || t("待补充条目")}</strong>
          <p>
            {t(
              f.kind === "income"
                ? "收入"
                : op.kind?.includes("investment")
                  ? "投资观察，不是现金收入"
                  : "本地记录候选",
            )}
          </p>
        </div>
        {!locked && (
          <input
            aria-label={t("选择 {name}", {
              name: f.merchant || f.name || op.op_id,
            })}
            type="checkbox"
            checked={op.selected !== false}
            onChange={(e) => onChange({ selected: e.target.checked })}
          />
        )}
      </div>
      <div className="command-result-value">
        <Money
          value={f.market_value || f.reported_gain || f.target || f.amount}
          currency={f.currency || "?"}
        />
        {f.date && <span>{f.date}</span>}
      </div>
      {!locked &&
        (op.kind === "create_draft" || op.kind === "update_record") && (
          <div className="result-context-fields">
            <label>
              <span>{t("币种")}</span>
              <select
                aria-label={t("候选 {id} 币种", { id: op.op_id })}
                value={f.currency || ""}
                onChange={(e) =>
                  onChange({
                    fields: { currency: e.target.value, account_id: null },
                  })
                }
              >
                <option value="">{t("选择币种")}</option>
                {[
                  "AUD",
                  "CNY",
                  "USD",
                  "EUR",
                  "GBP",
                  "NZD",
                  "JPY",
                  "KWD",
                  "HKD",
                  "SGD",
                  "CAD",
                  "KRW",
                  "BHD",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label>
              <span>{t("账户")}</span>
              <select
                aria-label={t("候选 {id} 账户", { id: op.op_id })}
                value={f.account_id || ""}
                onChange={(e) => {
                  const a = accounts.find((x) => x.id === e.target.value);
                  onChange({
                    fields: {
                      account_id: a?.id || null,
                      currency: a?.currency || f.currency,
                    },
                  });
                }}
              >
                <option value="">{t("选择账户")}</option>
                {accounts
                  .filter(
                    (a) =>
                      !a.archived && (!f.currency || a.currency === f.currency),
                  )
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
      {!locked && op.targets && (
        <label className="field">
          <span>{t("选择匹配条目")}</span>
          <select
            aria-label={t("候选 {id} 目标", { id: op.op_id })}
            value={op.resource_id || ""}
            onChange={(e) => onChange({ resource_id: e.target.value })}
          >
            <option value="">{t("请选择，不会自动决定")}</option>
            {op.targets.map((x) => (
              <option key={x.id} value={x.id}>
                {t(x.label)}
              </option>
            ))}
          </select>
        </label>
      )}
      {op.errors?.length > 0 && (
        <p className="candidate-warning">
          <TriangleAlert size={15} />
          {t("需要补齐：{fields}", {
            fields: op.errors
              .map((x) =>
                t(
                  {
                    amount: "金额",
                    currency: "币种",
                    date: "发生日",
                    merchant: "商户/描述",
                    account_id: "账户",
                    counterparty_id: "对方账户",
                    target: "匹配条目",
                    investment: "投资条目",
                    observed_at: "观察时间",
                    "market_value/reported_gain": "市值或累计收益",
                  }[x] || x,
                ),
              )
              .join(" / "),
          })}
        </p>
      )}
      {op.evidence && <EvidenceQuality evidence={op.evidence} />}
      <details className="candidate-source">
        <summary>{t("查看来源片段")}</summary>
        <p>{op.source_span || f.evidence?.source_span || t("用户提供")}</p>
        {op.evidence?.quality && (
          <small>
            {t(
              op.evidence.quality === "DEMO_PRESET"
                ? "模拟识别，非真实OCR"
                : "未校准识别，请人工复核",
            )}
          </small>
        )}
      </details>
      <div className="result-actions">
        {locked && (
          <span className="chip">
            <CheckCircle2 size={13} />
            {t(
              op.status === "APPLIED"
                ? "已提交；原记录可追溯"
                : "已保存草稿，尚未入账",
            )}
          </span>
        )}
        <button type="button" className="secondary" onClick={onEdit}>
          <Pencil size={14} />
          {t("编辑")}
        </button>
        {onOpen && (
          <button className="text-button" onClick={onOpen}>
            {t("查看记录")}
            <ArrowUpRight size={14} />
          </button>
        )}
      </div>
    </article>
  );
}
