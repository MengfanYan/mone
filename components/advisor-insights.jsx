"use client";
import { useState } from "react";
import {
  Sparkles,
  ArrowUpRight,
  AlertTriangle,
  Landmark,
  TrendingDown,
} from "lucide-react";
import { useTerminalText } from "./terminal/context";
import { Money } from "./financial-values";
import {
  advisoryFacts,
  rebalanceBudget,
  payoffDraft,
  monthDiningComparison,
  savingTarget,
  duplicateSubscriptions,
} from "@/lib/terminal/advisory.mjs";
import { minor, format } from "@/lib/demo/calculations.mjs";

export default function AdvisorInsights({
  state,
  currency,
  period,
  onSource,
  onPropose,
  compact = false,
}) {
  const text = useTerminalText(),
    facts = advisoryFacts(state, currency, period);
  const [action, setAction] = useState(null),
    [donor, setDonor] = useState(""),
    [amount, setAmount] = useState(""),
    [source, setSource] = useState(""),
    [liability, setLiability] = useState(""),
    [date, setDate] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [question, setQuestion] = useState(null);
  if (!facts)
    return (
      <p className="terminal-note">
        {text(
          "Enable analysis to see evidence-based diagnostics.",
          "开启分析授权后查看有依据的诊断。",
        )}
      </p>
    );
  const over = facts.budgets.find((b) => minor(b.delta, currency) > 0n),
    price = facts.prices[0];
  const sources = (events) =>
    events.slice(0, 3).map((e) => (
      <button
        type="button"
        className="citation-link"
        key={e.id}
        onClick={() =>
          onSource({
            tab: "ledger",
            resource_id: e.id,
            period: e.date.slice(0, 7),
            currency,
          })
        }
      >
        {e.merchant} · {e.date}
        <ArrowUpRight size={12} />
      </button>
    ));
  async function propose(e) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const payload =
        action === "budget"
          ? rebalanceBudget(state, currency, over.category, donor, amount)
          : payoffDraft(state, currency, source, liability, amount, date);
      await onPropose(action === "budget" ? "planning" : "payoff", payload, {
        ledger_version: state.ledger_version,
        settings_version: state.settings_version,
      });
      setAction(null);
    } catch {
      setError(
        text(
          "Check the amount, accounts and available budget, then try again.",
          "请核对金额、账户及可用预算后重试。",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const comparison =
    question === "dining"
      ? monthDiningComparison(state, currency, period)
      : null;
  const target =
    question === "saving" ? savingTarget(state, currency, 65) : null;
  const duplicates =
    question === "duplicates"
      ? duplicateSubscriptions(state, currency, period)
      : [];
  return (
    <section
      className={`advisor-insights ${compact ? "compact" : ""}`}
      aria-label={text("Ledger diagnostics", "账本诊断")}
    >
      <header className="advisor-heading">
        <span>
          <Sparkles size={16} />
          {text("Ledger diagnostics", "账本诊断")}
        </span>
        <small>
          {text("LOCAL RULES · NO MODEL CALL", "本地规则 · 无模型调用")}
        </small>
      </header>
      <div className="advisory-cards">
        <article className={`advisory-card ${over ? "watch" : ""}`}>
          <header>
            <AlertTriangle size={17} />
            <h3>{text("Budget position", "预算状况")}</h3>
          </header>
          {over ? (
            <>
              <p>
                <b>{over.category}</b> {text("is over budget by", "超出预算")}{" "}
                <Money value={over.delta} currency={currency} /> ·{" "}
                {over.used_percent}%.
              </p>
              <progress
                max="100"
                value={Math.min(100, Number(over.used_percent) || 0)}
              />
              <div className="advisory-citations">
                {sources(
                  facts.events.filter(
                    (e) =>
                      e.category === over.category &&
                      ["expense", "interest", "refund"].includes(e.kind),
                  ),
                )}
              </div>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setAction("budget");
                  setAmount(over.delta);
                  setDonor("");
                  setError("");
                }}
              >
                {text("Simulate budget rebalance", "模拟预算调平")}
              </button>
            </>
          ) : (
            <p>
              {text(
                facts.budgets.length
                  ? "No approved category is over budget in this snapshot."
                  : "No approved budget in this currency. Add one to compare.",
                "当前币种" +
                  (facts.budgets.length
                    ? "没有已批准类别超支。"
                    : "尚无已批准预算，可添加后比较。"),
              )}
            </p>
          )}
        </article>
        <article
          className={`advisory-card ${minor(facts.interestTotal, currency) > 0n ? "watch" : ""}`}
        >
          <header>
            <Landmark size={17} />
            <h3>{text("Cash & liabilities", "现金与负债")}</h3>
          </header>
          <p>
            {text("Recorded cash", "已记录现金")}{" "}
            <Money value={facts.cashTotal} currency={currency} /> ·{" "}
            {text("interest charged", "本月利息")}{" "}
            <Money value={facts.interestTotal} currency={currency} />.
          </p>
          <p className="terminal-note">
            {text(
              "Check due dates, reserved cash and repayment terms before preparing a transfer.",
              "先核对到期日、预留资金和还款条款，再准备还款记录。",
            )}
          </p>
          <div className="advisory-citations">{sources(facts.interest)}</div>
          {facts.debt.length > 0 && (
            <button
              type="button"
              className="secondary"
              onClick={() => {
                setAction("payoff");
                setSource("");
                setLiability("");
                setAmount("");
                setDate(String(state.as_of).slice(0, 10));
                setError("");
              }}
            >
              {text("Draft payoff transfer", "准备还款草稿")}
            </button>
          )}
        </article>
        <article className="advisory-card">
          <header>
            <TrendingDown size={17} />
            <h3>{text("Portfolio observation", "持仓观察")}</h3>
          </header>
          {price ? (
            <>
              <p>
                {price.name} ·{" "}
                {text("saved unit price fell", "记录单位价格下降")}{" "}
                <b>{price.percent}%</b>.
              </p>
              <p className="terminal-note">
                {text(
                  "Two recorded observations. Position size alone does not establish risk or a buying opportunity.",
                  "基于两次记录。仅凭持仓占比无法判定风险或买入机会。",
                )}
              </p>
              <button
                type="button"
                className="citation-link"
                onClick={() => onSource(price.target)}
              >
                {text("View price evidence", "查看价格依据")}
                <ArrowUpRight size={12} />
              </button>
            </>
          ) : (
            <p>
              {text(
                "No comparable price-decline observations in this period and currency.",
                "本期、当前币种没有可比较的价格下跌观察。",
              )}
            </p>
          )}
        </article>
      </div>
      {action && (
        <div
          className="advisory-action-form"
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.target.tagName !== "BUTTON") {
              e.preventDefault();
              if (!busy) propose(e);
            }
          }}
        >
          <h3>
            {action === "budget"
              ? text("Review a budget transfer", "检查预算划拨")
              : text("Prepare a repayment record", "准备还款记录")}
          </h3>
          {action === "budget" ? (
            <>
              <p>
                {text(
                  "Total approved budget stays the same. This moves budget allowance, not money.",
                  "预算总额保持不变，仅调整类别额度。",
                )}
              </p>
              <label>
                {text("Move allowance from", "转出类别")}
                <select
                  required
                  aria-label={text("Move allowance from", "转出类别")}
                  value={donor}
                  onChange={(e) => setDonor(e.target.value)}
                >
                  <option value="">
                    {text("Choose donor category", "选择转出类别")}
                  </option>
                  {facts.budgets
                    .filter(
                      (b) =>
                        b.category !== over?.category &&
                        minor(b.amount, currency) > minor(b.actual, currency),
                    )
                    .map((b) => (
                      <option key={b.category} value={b.category}>
                        {b.category} · {text("remaining", "剩余")}{" "}
                        {format(
                          minor(b.amount, currency) - minor(b.actual, currency),
                          currency,
                        )}{" "}
                        {currency}
                      </option>
                    ))}
                </select>
              </label>
              <p>→ {over?.category}</p>
            </>
          ) : (
            <>
              <p>
                {text(
                  "Creates a reviewable ledger entry. It does not send money to a bank.",
                  "生成待核对的账本记录，不会向银行发起付款。",
                )}
              </p>
              <label>
                {text("Cash account", "现金账户")}
                <select
                  required
                  aria-label={text("Cash account", "现金账户")}
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">{text("Choose account", "选择账户")}</option>
                  {facts.cash
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.balance} {currency}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {text("Liability account", "负债账户")}
                <select
                  required
                  aria-label={text("Liability account", "负债账户")}
                  value={liability}
                  onChange={(e) => {
                    setLiability(e.target.value);
                    setAmount(
                      facts.debt.find((a) => a.id === e.target.value)
                        ?.balance || "",
                    );
                  }}
                >
                  <option value="">
                    {text("Choose liability", "选择负债")}
                  </option>
                  {facts.debt
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.balance} {currency}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {text("Recorded repayment date", "还款记录日期")}
                <input
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
            </>
          )}
          <label>
            {text("Amount", "金额")} · {currency}
            <input
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="button-row">
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={propose}
            >
              {action === "budget"
                ? text("Preview exact changes", "预览具体变更")
                : text("Open draft editor", "打开草稿编辑器")}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setAction(null)}
            >
              {text("Cancel", "取消")}
            </button>
          </div>
        </div>
      )}
      <div
        className="advisory-prompts"
        aria-label={text("Suggested follow-ups", "建议追问")}
      >
        <button type="button" onClick={() => setQuestion("dining")}>
          {text("Compare last month’s dining", "对比上月餐饮")}
        </button>
        <button type="button" onClick={() => setQuestion("saving")}>
          {text("Explore a 65% savings rate", "试算65%储蓄率")}
        </button>
        <button type="button" onClick={() => setQuestion("duplicates")}>
          {text("Check duplicate charges", "检查重复扣款")}
        </button>
      </div>
      {question && (
        <div className="advisory-followup" role="status">
          {comparison ? (
            <>
              <p>
                {comparison.current.period}:{" "}
                <Money value={comparison.current.amount} currency={currency} />{" "}
                · {comparison.previous.period}:{" "}
                {comparison.previous.count ? (
                  <Money
                    value={comparison.previous.amount}
                    currency={currency}
                  />
                ) : (
                  text("No saved dining records", "没有餐饮记录")
                )}
              </p>
              <p>
                {text(
                  "Recorded expenses net of linked refunds. Missing records do not prove zero spending.",
                  "已记录费用扣除关联退款；没有记录不代表没有实际消费。",
                )}
              </p>
              {sources(
                facts.events.filter((e) =>
                  comparison.current.ids.includes(e.id),
                ),
              )}
            </>
          ) : question === "saving" ? (
            <p>
              {target ? (
                <>
                  {text(
                    "At the same recorded income, expenses would need to stay within",
                    "按相同已记录收入，费用需控制在",
                  )}{" "}
                  <Money value={target.allowed} currency={currency} />;{" "}
                  {text("reduction required", "所需减少")}{" "}
                  <Money value={target.reduction} currency={currency} />.{" "}
                  {text(
                    "A mathematical scenario, not a recommendation to cut essential spending.",
                    "仅为数学情景，不能据此削减必要支出。",
                  )}
                </>
              ) : (
                text(
                  "A positive recorded income is required.",
                  "需要正数的已记录收入。",
                )
              )}
            </p>
          ) : (
            <>
              <p>
                {text(
                  `${duplicates.length} possible duplicate groups. Same merchant, date, amount and account; check evidence before changing anything.`,
                  `${duplicates.length}组可能重复：商户、日期、金额及账户相同，请先核对来源。`,
                )}
              </p>
              {duplicates.map((rows, i) => (
                <div key={i}>{sources(rows)}</div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}
