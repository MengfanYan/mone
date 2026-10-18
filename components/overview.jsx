"use client";

import { useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  Check,
  ChevronRight,
  FileText,
  Landmark,
  Plus,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { useLocale } from "@/components/locale-provider";
import { Amount, Money } from "@/components/financial-values";
import { displayMoney } from "@/lib/money-format.mjs";

function IncomeGlyph({ points }) {
  const peak = Math.max(1, ...points.map((p) => Number(p.income)));
  return (
    <div className="income-glyph" aria-hidden="true">
      {points.map((point, column) => (
        <div key={column}>
          {[4, 3, 2, 1, 0].map((row) => (
            <i
              key={row}
              data-filled={Number(point.income) > (peak * row) / 5}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function MoneyFlow({ points, currency, period, analysisAuthorized, onRange }) {
  const { t } = useLocale();
  const [active, setActive] = useState(null);
  const positive = Math.max(
    1,
    ...points.flatMap((p) => [Number(p.income), Number(p.expenses)]),
  );
  const negative = Math.min(
    0,
    ...points.flatMap((p) => [Number(p.income), Number(p.expenses)]),
  );
  const range = positive - negative;
  const y = (value) => 190 - ((value - negative) / range) * 150;
  const baseline = y(0);
  const hasData = points.some(
    (p) =>
      (p.income !== "0.00" && Number(p.income) !== 0) ||
      Number(p.expenses) !== 0,
  );
  const selected = active === null ? null : points[active];
  return (
    <section className="panel flow-panel">
      <div className="panel-heading">
        <div>
          <h2>{t("资金流向")}</h2>
          <p className="section-caption">
            {period} · {currency}
          </p>
        </div>
        <div className="chart-legend">
          <span>
            <i />
            {t("收入")}
          </span>
          <span>
            <i />
            {t("本月确认费用")}
          </span>
        </div>
      </div>
      <div className="chart-wrap">
        {selected && (
          <div className="chart-tooltip" role="status">
            <span>{selected.label}</span>
            <strong>
              {t("收入")} {displayMoney(selected.income)}
            </strong>
            <strong>
              {t("本月确认费用")} {displayMoney(selected.expenses)}
            </strong>
            <small>{currency}</small>
          </div>
        )}
        <svg
          className="flow-chart"
          viewBox="0 0 590 235"
          role="group"
          aria-label={`${t("资金流向")} · ${period} · ${currency}`}
        >
          <defs>
            <pattern
              id="flow-hatch"
              width="7"
              height="7"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(35)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="7"
                stroke="#e7efea"
                strokeWidth="2"
              />
            </pattern>
          </defs>
          {[0, positive / 2, positive, ...(negative < 0 ? [negative] : [])].map(
            (value) => (
              <g key={value}>
                <line
                  x1="36"
                  y1={y(value)}
                  x2="581"
                  y2={y(value)}
                  className="chart-grid"
                />
                <text x="4" y={y(value) - 8} className="axis-label">
                  {Math.abs(value) < 1000
                    ? Math.round(value)
                    : `${(value / 1000).toFixed(1)}k`}
                </text>
              </g>
            ),
          )}
          {points.map((point, i) => {
            const x = 50 + i * (515 / Math.max(1, points.length));
            const income = Number(point.income),
              expense = Number(point.expenses);
            return (
              <g
                key={point.label}
                tabIndex="0"
                role="button"
                aria-label={`${point.label}: ${t("收入")} ${point.income}, ${t("本月确认费用")} ${point.expenses} ${currency}`}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                onClick={() => {
                  const [from, to] = point.label.split("–");
                  onRange?.({
                    from: `${period}-${from}`,
                    to: `${period}-${to}`,
                  });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setActive(null);
                  if (["Enter", " "].includes(event.key)) {
                    event.preventDefault();
                    const [from, to] = point.label.split("–");
                    onRange?.({
                      from: `${period}-${from}`,
                      to: `${period}-${to}`,
                    });
                  }
                }}
              >
                <rect
                  x={x}
                  y="34"
                  width="66"
                  height={Math.max(0, baseline - 34)}
                  rx="9"
                  fill="url(#flow-hatch)"
                />
                <rect
                  x={x}
                  y={income >= 0 ? y(income) : baseline}
                  width="31"
                  height={Math.max(2, Math.abs(y(income) - baseline))}
                  rx="6"
                  className="income-bar"
                  opacity={income === 0 ? 0.18 : 1}
                />
                <rect
                  x={x + 35}
                  y={expense >= 0 ? y(expense) : baseline}
                  width="31"
                  height={Math.max(2, Math.abs(y(expense) - baseline))}
                  rx="6"
                  className="expense-bar"
                  opacity={expense === 0 ? 0.18 : 1}
                />
                <text
                  x={x + 33}
                  y="225"
                  textAnchor="middle"
                  className="axis-label"
                >
                  {point.label}
                </text>
                <title>
                  {point.label}: {point.income} / {point.expenses} {currency}
                </title>
              </g>
            );
          })}
        </svg>
        {!hasData && (
          <div className="chart-empty">
            <strong>
              {t(analysisAuthorized ? "本期暂无记录" : "本地分析尚未授权。")}
            </strong>
            <span>
              {t(
                analysisAuthorized
                  ? "导入并确认交易，图表会自动更新。"
                  : "在隐私页开启本地分析后查看图表。",
              )}
            </span>
          </div>
        )}
      </div>
      <details className="chart-data">
        <summary>{t("按周数据与记录")}</summary>
        {points.map((p) => (
          <button
            key={p.label}
            className="text-button"
            onClick={() => {
              const [from, to] = p.label.split("–");
              onRange?.({ from: `${period}-${from}`, to: `${period}-${to}` });
            }}
          >
            {p.label} · {t("收入")} {p.income} · {t("本月确认费用")}{" "}
            {p.expenses} {currency}
          </button>
        ))}
      </details>
      <div className="panel-foot">{t("收入与费用，来自真实账本计算")}</div>
    </section>
  );
}

export default function Overview({
  state,
  period,
  onAddAccount,
  onNavigate,
  currencyChoice,
  onRange,
  demo = false,
  relationships,
}) {
  const { t } = useLocale();
  const summaries = state.summary || [];
  const summary =
    summaries.find((s) => s.currency === currencyChoice) ||
    (!currencyChoice &&
      (summaries.find((s) => s.currency === state.planning.currency) ||
        summaries[0]));
  const currency =
    currencyChoice || summary?.currency || state.accounts[0]?.currency || "AUD";
  const points =
    state.money_flow?.find((s) => s.currency === currency)?.points || [];
  const budgets =
    state.planning.currency === currency ? state.risk?.budgets || [] : [];
  const accountMap = Object.fromEntries(
    state.accounts.map((account) => [account.id, account]),
  );
  const recent = state.transactions
    .filter(
      (event) =>
        event.date.startsWith(period) &&
        event.currency === currency &&
        event.kind !== "opening",
    )
    .slice()
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        String(b.created_at || b.id).localeCompare(
          String(a.created_at || a.id),
        ),
    )
    .slice(0, 5);
  const percentage = summary?.expense_income_percent;
  const kinds = {
    income: t("收入"),
    dividend: t("分红收入"),
    expense: t("日常支出"),
    interest: t("利息/费用"),
    transfer: t("内部转账"),
    card_payment: t("信用卡还款本金"),
    debt_principal: t("债务本金偿还"),
    loan_received: t("借款本金到账"),
    investment_buy: t("投资买入本金"),
    investment_sell: t("投资卖出本金"),
    refund: t("关联退款"),
  };
  return (
    <>
      {!state.accounts.length && (
        <section className="panel welcome">
          <div>
            <div className="eyebrow">{t("开始一份清晰的账本")}</div>
            <h2>{t("欢迎来到知账")}</h2>
            <p>{t("添加账户和期初余额，导入你的CSV，核对草稿后确认。")}</p>
            <div className="button-row">
              <button className="primary" onClick={onAddAccount}>
                <Plus size={16} />
                {t("添加账户")}
              </button>
              <a className="secondary" href="/demo">
                {t("打开产品演示")}
                <ArrowRight size={15} />
              </a>
            </div>
          </div>
          <div className="welcome-art" aria-hidden="true">
            <i />
            <i />
            <i />
            <span>
              <Check size={16} />
              {t("你的账本，从这里开始")}
            </span>
          </div>
        </section>
      )}
      <div className="overview-toolbar">
        <span className="section-caption">{t("按原币种展示")}</span>
        <span className="currency-chip">{currency}</span>
      </div>
      <details className="overview-details">
        <summary>{t("更多收支与预算明细")}</summary>
        <div className="metrics-grid overview-metrics">
          <section className="metric balance-metric">
            <div className="metric-top">
              <span>{t("现金余额")}</span>
              <span className="chip">{period}</span>
            </div>
            <div className="metric-subtitle">
              {t("截至")} {period}
            </div>
            <div className="metric-value">
              <Amount value={summary?.closing_cash} />
              <small>{currency}</small>
            </div>
            <div className="metric-foot-row">
              <Wallet size={14} />
              <span>{t("现金变化")}</span>
              <Money value={summary?.cash_change} currency={currency} />
            </div>
            <p>{t("计算余额；尚未与银行对账。")}</p>
          </section>
          <section className="metric income-metric">
            <div className="metric-top">
              <span>{t("本月确认收入")}</span>
              <ArrowDownLeft size={18} />
            </div>
            <div className="income-number">
              <div>
                <div className="metric-subtitle">{t("已确认记录")}</div>
                <div className="metric-value">
                  <Amount value={summary?.income} />
                  <small>{currency}</small>
                </div>
              </div>
              <IncomeGlyph points={points} />
            </div>
            <div className="metric-foot-row">
              <Check size={14} />
              <span>{t("收支结余")}</span>
              <Money value={summary?.surplus} currency={currency} />
            </div>
            <p>{t("工资、分红等；不含借款本金")}</p>
          </section>
          <section className="metric expense-metric">
            <div className="metric-top">
              <span>{t("本月确认费用")}</span>
              <ArrowUpRight size={18} />
            </div>
            <div className="metric-value">
              <Amount value={summary?.expenses} />
              <small>{currency}</small>
            </div>
            <div className="expense-progress" aria-hidden="true">
              {Array.from({ length: 32 }, (_, i) => (
                <i
                  key={i}
                  data-filled={
                    percentage !== null &&
                    percentage !== undefined &&
                    i <
                      (Math.min(100, Math.max(0, Number(percentage))) / 100) *
                        32
                  }
                />
              ))}
            </div>
            <div className="expense-ratio">
              <span>{t("费用占收入")}</span>
              <strong>
                {percentage ?? "—"}
                {percentage !== null && percentage !== undefined && "%"}
              </strong>
            </div>
            <p>{t("退款抵减费用，还款本金不重复计费")}</p>
          </section>
        </div>
        {relationships}
        <div className="dashboard-grid analysis-grid">
          <MoneyFlow
            points={points}
            currency={currency}
            period={period}
            analysisAuthorized={state.consents.analysis}
            onRange={onRange}
          />
          <section className="panel budget-overview">
            <div className="panel-heading">
              <h2>{t("已批准预算")}</h2>
              <button
                className="text-button"
                onClick={() => onNavigate("planning")}
              >
                {t("查看规划")}
                <ArrowUpRight size={15} />
              </button>
            </div>
            {budgets.length ? (
              <>
                <div className="budget-total">
                  <Amount value={state.risk.budget_remaining} />
                  <small>{state.risk.metrics.currency}</small>
                </div>
                <p className="section-caption">{t("剩余预算")}</p>
                <div className="budget-tiles">
                  {budgets.slice(0, 3).map((budget, i) => (
                    <div
                      className={`budget-tile tile-${i}`}
                      key={budget.category}
                    >
                      <div className="budget-tile-track">
                        <i
                          style={{
                            width: `${Math.min(100, Math.max(0, Number(budget.used_percent)))}%`,
                          }}
                        />
                      </div>
                      <strong>{budget.used_percent}%</strong>
                      <span>
                        {state.demo ? t(budget.category) : budget.category}
                      </span>
                      <small>
                        {displayMoney(budget.actual)} /{" "}
                        {displayMoney(budget.amount)}
                      </small>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="budget-empty">
                <div className="budget-empty-glyph" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <strong>
                  {t(
                    state.consents.analysis
                      ? "尚未设定预算"
                      : "本地分析尚未授权。",
                  )}
                </strong>
                <p>
                  {t(
                    state.consents.analysis
                      ? "设定预算后查看使用进度。"
                      : "在隐私页开启本地分析后查看图表。",
                  )}
                </p>
                <button
                  className="secondary"
                  onClick={() =>
                    onNavigate(state.consents.analysis ? "planning" : "privacy")
                  }
                >
                  <Plus size={15} />
                  {t(state.consents.analysis ? "添加预算" : "隐私与授权")}
                </button>
              </div>
            )}
          </section>
        </div>
      </details>
      <section className="panel recent-panel">
        <div className="panel-heading">
          <div>
            <h2>{t("账本动态")}</h2>
            <p className="section-caption">
              {t("已确认账本")} · {period}
            </p>
          </div>
          <button className="text-button" onClick={() => onNavigate("ledger")}>
            {t("查看全部")}
            <ArrowRight size={15} />
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t("商户/描述")}</th>
                <th>{t("发生日")}</th>
                <th>{t("账户")}</th>
                <th>{t("类型")}</th>
                <th>{t("金额")}</th>
                <th>{t("状态")}</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((event, i) => (
                <tr key={event.id}>
                  <td>
                    <div className="merchant-cell">
                      <span className={`merchant-avatar avatar-${i % 4}`}>
                        {(() => {
                          const label = t(event.merchant);
                          const words = label.trim().split(/\s+/);
                          return words.length > 1
                            ? words
                                .slice(-2)
                                .map((w) => w[0])
                                .join("")
                                .toUpperCase()
                            : label.slice(0, 2).toUpperCase();
                        })()}
                      </span>
                      <div>
                        <strong>{t(event.merchant)}</strong>
                        <small>{t(event.category)}</small>
                      </div>
                    </div>
                  </td>
                  <td>{event.date}</td>
                  <td>{t(accountMap[event.account_id]?.name || "")}</td>
                  <td>{kinds[event.kind]}</td>
                  <td>
                    <Money value={event.amount} currency={event.currency} />
                  </td>
                  <td>
                    <span
                      className={`chip ${event.reverses || state.transactions.some((other) => other.reverses === event.id) ? "amber-chip" : "green-chip"}`}
                    >
                      {event.reverses
                        ? t("冲正分录")
                        : state.transactions.some(
                              (other) => other.reverses === event.id,
                            )
                          ? t("已冲正")
                          : t("已确认")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!recent.length && (
            <div className="empty compact-empty">
              <FileText size={24} />
              <strong>{t("本期暂无记录")}</strong>
              <p>{t("手工、CSV或凭证导入的新记录会出现在这里。")}</p>
              <button
                className="text-button"
                onClick={() => onNavigate("ledger")}
              >
                {t("开始记账")}
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </section>
      <div className="dashboard-grid detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>{t("账户与现金")}</h2>
            <button className="text-button" onClick={onAddAccount}>
              <Plus size={15} />
              {t("添加账户")}
            </button>
          </div>
          {state.accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <div className="account-icon">
                <Landmark size={18} />
              </div>
              <div>
                <strong>{t(account.name)}</strong>
                <p>
                  {account.type === "liability"
                    ? t("负债 · 欠款")
                    : t("现金/银行")}
                </p>
              </div>
              <Money value={account.balance} currency={account.currency} />
            </div>
          ))}
          <div className="panel-foot">
            {t("按原币种展示")} · {t("计算余额；尚未与银行对账。")}
          </div>
        </section>
        <section className="panel checklist-panel">
          <div className="panel-heading">
            <h2>{t("现在值得关注")}</h2>
            <ShieldCheck size={18} />
          </div>
          <div className="insight">
            <div className="insight-dot amber" />
            <div>
              <strong>
                {state.drafts.length}
                {t("笔待确认草稿")}
              </strong>
              <p>{t("未确认数据不影响余额与收支。")}</p>
              <button
                className="text-button"
                onClick={() => onNavigate("ledger")}
              >
                {t("去核对")}
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          {state.risk?.findings.map((finding, i) => (
            <div className="insight" key={i}>
              <div
                className={`insight-dot ${finding.severity === "HIGH" ? "red" : "green"}`}
              />
              <div>
                <strong>
                  {finding.severity === "DATA_GAP"
                    ? t("资料需要补充")
                    : t("财务规则提醒")}
                </strong>
                <p>{t(finding.message)}</p>
              </div>
            </div>
          ))}
          <div className="daily-summary">
            <span>
              {t(demo ? "预设日期摘要" : "今日摘要")} · {state.daily?.date}
            </span>
            {state.daily?.summary?.map((daily) => (
              <p key={daily.currency}>
                {daily.currency} · {t("收入")} {displayMoney(daily.income)} ·{" "}
                {t("本月确认费用")} {displayMoney(daily.expenses)}
              </p>
            ))}
            <small>
              {t(
                demo
                  ? "预设日期的已确认记录，不代表今日实际消费。"
                  : "仅含今日已确认记录。没有记录不等于没有支出。",
              )}
            </small>
          </div>
        </section>
      </div>
    </>
  );
}
