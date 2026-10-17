"use client";
import { useLocale } from "./locale-provider";
import { Money } from "./financial-values";
import { CategoryIcon } from "./command-result-card";
import { ArrowUpRight, Target, Layers3 } from "lucide-react";

export function BudgetComparison({ state, currency, onDrill }) {
  const { t } = useLocale();
  if (!state.consents.analysis) return null;
  const same = state.planning.currency === currency,
    budgets = same ? state.risk?.budgets || [] : [];
  return (
    <section className="relation-section budget-comparison">
      <header>
        <h2>
          <Target size={19} />
          {t("实际支出与预算")}
        </h2>
        <span>
          {currency} · {state.period}
        </span>
      </header>
      {!same ? (
        <p>
          {t("预算使用 {currency}，请切换币种后查看。", {
            currency: state.planning.currency,
          })}
        </p>
      ) : !budgets.length ? (
        <p>{t("还没有批准预算，先设定类别上限。")}</p>
      ) : (
        budgets.map((b) => {
          const maximum = Math.max(Number(b.amount), Number(b.actual), 1),
            overs = Number(b.delta) > 0;
          return (
            <button
              className={`budget-relation ${overs ? "over-limit" : ""}`}
              key={b.id || b.category}
              onClick={() =>
                onDrill({
                  tab: "ledger",
                  category: b.category,
                  currency,
                  period: state.period,
                })
              }
            >
              <div>
                <span>
                  <CategoryIcon category={b.category} />
                  <strong>{state.demo ? t(b.category) : b.category}</strong>
                </span>
                <span>
                  <Money value={b.actual} currency={currency} /> /{" "}
                  <Money value={b.amount} currency={currency} />
                </span>
              </div>
              <div className="budget-comparison-track">
                <i
                  className="budget-limit"
                  style={{
                    width: `${Math.max(0, (Number(b.amount) / maximum) * 100)}%`,
                  }}
                />
                <i
                  className="budget-actual"
                  style={{
                    width: `${Math.max(0, (Number(b.actual) / maximum) * 100)}%`,
                  }}
                />
              </div>
              <div className="budget-relation-caption">
                <span>
                  {t(
                    overs ? "超出 {amount} {currency}" : "已使用 {percent}%",
                    overs
                      ? { amount: b.delta, currency }
                      : { percent: b.used_percent },
                  )}
                </span>
                <span>
                  {t("查看记录")}
                  <ArrowUpRight size={13} />
                </span>
              </div>
            </button>
          );
        })
      )}
    </section>
  );
}

export function CategoryExpenses({ state, currency, onDrill }) {
  const { t } = useLocale();
  if (!state.consents.analysis) return null;
  const summary = state.summary?.find((s) => s.currency === currency),
    categories = Object.entries(summary?.categories || {}).sort(
      (a, b) => Number(b[1]) - Number(a[1]),
    );
  const maximum = Math.max(
    1,
    ...categories.map(([, amount]) => Math.abs(Number(amount))),
  );
  return (
    <section className="relation-section category-expenses">
      <header>
        <h2>
          <Layers3 size={19} />
          {t("钱花在哪里")}
        </h2>
        <span>
          {state.period} · {currency}
        </span>
      </header>
      {categories.length ? (
        <>
          {categories.slice(0, 5).map(([name, amount]) => (
            <button
              className="category-relation"
              key={state.demo ? t(name) : name}
              onClick={() =>
                onDrill({
                  tab: "ledger",
                  category: name,
                  currency,
                  period: state.period,
                })
              }
            >
              <span>
                <CategoryIcon category={name} />
                {state.demo ? t(name) : name}
              </span>
              <div>
                <i
                  style={{
                    width: `${(Math.abs(Number(amount)) / maximum) * 100}%`,
                  }}
                />
              </div>
              <Money value={amount} currency={currency} />
              <ArrowUpRight size={14} />
            </button>
          ))}
          {categories.length > 5 && (
            <details>
              <summary>
                {t("展开其他 {count} 个类别", { count: categories.length - 5 })}
              </summary>
              {categories.slice(5).map(([name, amount]) => (
                <button
                  key={state.demo ? t(name) : name}
                  className="category-relation"
                  onClick={() =>
                    onDrill({
                      tab: "ledger",
                      category: name,
                      currency,
                      period: state.period,
                    })
                  }
                >
                  <span>{state.demo ? t(name) : name}</span>
                  <Money value={amount} currency={currency} />
                </button>
              ))}
            </details>
          )}
          <p className="relation-note">
            {t("分类合计与确认费用一致；关联退款冲减原类别。")}
          </p>
        </>
      ) : (
        <p>{t("本期没有有效分类费用。")}</p>
      )}
    </section>
  );
}

export function CashBridge({ state, currency }) {
  const { t } = useLocale();
  if (!state.consents.analysis) return null;
  const s = state.summary?.find((s) => s.currency === currency),
    rows = state.cash_bridge?.filter((x) => x.currency === currency) || [];
  const kinds = {
    expense: "消费现金影响",
    income: "收入现金影响",
    transfer: "内部转账净影响",
    card_payment: "信用卡本金偿还",
    debt_principal: "债务本金",
    loan_received: "借款本金",
    interest: "利息费用",
    dividend: "分红现金",
    investment_buy: "投资买入本金",
    investment_sell: "投资卖出本金",
    refund: "退款现金",
  };
  return (
    <section className="relation-section cash-bridge">
      <header>
        <h2>{t("现金变化为何不同于结余")}</h2>
        <span>
          {state.period} · {currency}
        </span>
      </header>
      <div className="cash-bridge-equation">
        <div>
          <span>{t("期初现金")}</span>
          <Money value={s?.opening_cash} currency={currency} />
        </div>
        <span>+</span>
        <div>
          <span>{t("现金变动")}</span>
          <Money value={s?.cash_change} currency={currency} />
        </div>
        <span>=</span>
        <div>
          <span>{t("期末现金")}</span>
          <Money value={s?.closing_cash} currency={currency} />
        </div>
      </div>
      <details>
        <summary>{t("查看现金分项")}</summary>
        <dl>
          {rows.map((r) => (
            <div key={r.kind}>
              <dt>{t(kinds[r.kind] || r.kind)}</dt>
              <dd>
                <Money value={r.amount} currency={currency} />
              </dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="relation-note">
        {t("本金、转账和信用卡还款影响现金，但不重复计入费用。")}
      </p>
    </section>
  );
}

export function MonthComparison({ state, currency }) {
  const { t } = useLocale();
  if (!state.consents.analysis) return null;
  const rows =
    state.month_comparison?.filter((x) => x.currency === currency) || [];
  return (
    <section className="relation-section month-comparison">
      <header>
        <h2>{t("同币种月份对照")}</h2>
        <span>{currency}</span>
      </header>
      {rows.length < 2 ? (
        <p>{t("至少两个有记录月份后显示对照，不填造前期数据。")}</p>
      ) : (
        <div className="month-comparison-rows">
          {rows.map((r) => (
            <div key={r.period}>
              <strong>{r.period}</strong>
              <span>
                {t("收入")} <Money value={r.income} currency={currency} />
              </span>
              <span>
                {t("费用")} <Money value={r.expenses} currency={currency} />
              </span>
              <span>
                {t("现金变动")}{" "}
                <Money value={r.cash_change} currency={currency} />
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="relation-note">
        {t("导入覆盖未知；未结束月份不视为完整月，未推算投资月收益。")}
      </p>
    </section>
  );
}

export function GoalProgress({ state, currency }) {
  const { t } = useLocale();
  if (!state.consents.analysis || state.planning.currency !== currency)
    return null;
  return (
    <section className="relation-section goal-progress">
      <header>
        <h2>
          <Target size={19} />
          {t("距离目标还有多远")}
        </h2>
      </header>
      {(state.risk?.goals || []).length ? (
        state.risk.goals.map((g) => (
          <div className="goal-progress-item" key={g.id || g.name}>
            <div>
              <strong>{g.name}</strong>
              <span>{g.deadline}</span>
            </div>
            <div className="goal-progress-track">
              <i
                style={{
                  width: `${Math.min(100, Math.max(0, (Number(g.saved) / Number(g.target)) * 100))}%`,
                }}
              />
            </div>
            <p>
              {t("还差 {amount} {currency} · 每月至少 {monthly}", {
                amount: g.gap,
                currency,
                monthly: g.monthly_required,
              })}
              {g.overdue && ` · ${t("期限已过")}`}
            </p>
          </div>
        ))
      ) : (
        <p>{t("新增目标后显示已存、差额与期限关系。")}</p>
      )}
    </section>
  );
}
