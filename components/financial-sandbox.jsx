"use client";
import { useState } from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { useTerminalText } from "./terminal/context";
import { useLocale } from "./locale-provider";
import { Money } from "./financial-values";
import { saveFile } from "./terminal/workbench";
import {
  advisoryFacts,
  unifiedWorth,
  exposureGroups,
  cashProjection,
  cashToAsset,
  narrativeBrief,
} from "@/lib/terminal/advisory.mjs";

export default function FinancialSandbox({
  state,
  currency,
  period,
  demo,
  onSource,
}) {
  const text = useTerminalText(),
    { locale } = useLocale();
  const [mode, setMode] = useState("subscriptions"),
    [quotes, setQuotes] = useState({}),
    [purchase, setPurchase] = useState("0"),
    [commitments, setCommitments] = useState([]),
    [transfer, setTransfer] = useState(""),
    [investment, setInvestment] = useState("");
  const facts = advisoryFacts(state, currency, period);
  if (!facts) return null;
  const date = String(state.as_of).slice(0, 10),
    reserve =
      state.planning.currency === currency ? state.planning.earmarked : null;
  let converted = null,
    projection = null,
    bridge = null,
    error = "";
  try {
    if (mode === "fx") converted = unifiedWorth(state, currency, quotes);
    if (mode === "cash" && reserve != null)
      projection = cashProjection({
        cash: facts.cashTotal,
        reserve,
        purchase,
        currency,
        asOf: date,
        commitments,
      });
    if (mode === "bridge" && transfer && investment)
      bridge = cashToAsset(state, currency, investment, transfer);
  } catch {
    error = text(
      "Complete the fields with valid amounts and dates. Transfers must fit surplus and unreserved cash.",
      "请填写有效金额与日期；划拨金额不能超过结余及未预留现金。",
    );
  }
  const quoteChange = (code, key, value) =>
    setQuotes((old) => ({ ...old, [code]: { ...old[code], [key]: value } }));
  const itemChange = (id, key, value) =>
    setCommitments((old) =>
      old.map((x) => (x.id === id ? { ...x, [key]: value } : x)),
    );
  return (
    <section
      className="panel financial-sandbox"
      aria-label={text("Financial planning lab", "财务规划实验室")}
    >
      <header className="terminal-section-header">
        <div>
          <span className="terminal-overline">
            {text("PLAN / VERIFY / REVIEW", "规划 / 验证 / 审阅")}
          </span>
          <h2>{text("Financial planning lab", "财务规划实验室")}</h2>
          <p>
            {text(
              "Deterministic scenarios · current records · no model call",
              "确定性情景 · 当前记录 · 无模型调用",
            )}
          </p>
        </div>
      </header>
      <div
        className="lab-tabs"
        role="group"
        aria-label={text("Planning tools", "规划工具")}
      >
        {[
          ["subscriptions", "Subscription radar", "订阅雷达"],
          ["cash", "Cash-flow sandbox", "现金流沙盒"],
          ["fx", "Unified net worth", "折算净值"],
          ["bridge", "Cash to assets", "现金与投资"],
          ["brief", "Monthly brief", "月度简报"],
        ].map(([id, en, zh]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
          >
            {text(en, zh)}
          </button>
        ))}
      </div>
      {mode === "subscriptions" && (
        <div className="subscription-radar">
          <p>
            {text(
              "Candidates from saved expenses. A monthly cadence requires at least three separate dates; names alone do not establish a recurring charge.",
              "从已记录费用识别候选。月度周期至少需要三个独立日期，仅凭名称不能确定为订阅。",
            )}
          </p>
          {facts.subscriptions.length ? (
            facts.subscriptions.map((s) => {
              const days = s.nextDate
                ? Math.round(
                    (Date.parse(s.nextDate) - Date.parse(date)) / 86400000,
                  )
                : null;
              return (
                <article
                  key={`${s.merchant}-${s.account_id}-${s.amount}`}
                  className="subscription-item"
                >
                  <div>
                    <strong>{s.merchant}</strong>
                    <p>
                      {s.recurring
                        ? text("Possible monthly cadence", "可能的月度周期")
                        : text(
                            "Name-based candidate · confirm schedule",
                            "名称候选 · 请确认周期",
                          )}
                    </p>
                    <small>
                      {s.nextDate
                        ? text(
                            `Next estimated date: ${s.nextDate}`,
                            `下次预计日期：${s.nextDate}`,
                          )
                        : text("Next charge date unknown", "下次扣款日期未知")}
                      {days !== null && days >= 0 && days <= 3 && (
                        <b className="warning">
                          {" "}
                          · {text("Within 3 days", "三天内")}
                        </b>
                      )}
                    </small>
                  </div>
                  <Money value={s.amount} currency={currency} />
                  <button
                    className="text-button"
                    onClick={() =>
                      onSource({
                        tab: "ledger",
                        resource_id: s.evidence.at(-1),
                        currency,
                        period: state.transactions
                          .find((e) => e.id === s.evidence.at(-1))
                          .date.slice(0, 7),
                      })
                    }
                  >
                    {text("Inspect source", "核对来源")}
                  </button>
                </article>
              );
            })
          ) : (
            <p className="empty">
              {text(
                "No subscription candidates in the available history.",
                "现有历史中没有订阅候选。",
              )}
            </p>
          )}
          <p className="terminal-note">
            {text(
              "Unverified candidates are excluded from committed cash flow. Add an explicit schedule in the cash-flow sandbox.",
              "未核对候选不计入已承诺现金流，可在现金流沙盒中明确填写计划。",
            )}
          </p>
        </div>
      )}
      {mode === "cash" && (
        <div className="cash-sandbox">
          <p>
            {text("As of", "截至")} {date} · {text("Recorded cash", "记录现金")}{" "}
            <Money value={facts.cashTotal} currency={currency} /> ·{" "}
            {text("Approved reserve", "已批准预留")}{" "}
            <Money value={reserve} currency={currency} />
          </p>
          <p>
            {text(
              "Enter only unpaid scheduled items. Results exclude unknown bills, future market returns and unentered obligations; a positive balance is not a guarantee of safe spending. Scenarios stay in this session.",
              "仅填写尚未支付的计划项目。结果不包含未知账单、未来投资收益及未录入义务；正余额不是安全消费保证。情景只保留于本次会话。",
            )}
          </p>
          <div className="schedule-list">
            {commitments.map((c) => (
              <div className="schedule-row" key={c.id}>
                <label>
                  {text("Description", "描述")}
                  <input
                    value={c.name}
                    onChange={(e) => itemChange(c.id, "name", e.target.value)}
                    maxLength={100}
                  />
                </label>
                <label>
                  {text("Due date", "到期日")}
                  <input
                    type="date"
                    min={date}
                    value={c.date}
                    onChange={(e) => itemChange(c.id, "date", e.target.value)}
                  />
                </label>
                <label>
                  {text("Amount", "金额")}
                  <input
                    inputMode="decimal"
                    value={c.amount}
                    onChange={(e) => itemChange(c.id, "amount", e.target.value)}
                  />
                </label>
                <label>
                  {text("Direction", "方向")}
                  <select
                    value={c.kind}
                    onChange={(e) => itemChange(c.id, "kind", e.target.value)}
                  >
                    <option value="outflow">{text("Outflow", "支出")}</option>
                    <option value="income">{text("Income", "收入")}</option>
                  </select>
                </label>
                <label className="inline-choice">
                  <input
                    type="checkbox"
                    checked={c.monthly}
                    onChange={(e) =>
                      itemChange(c.id, "monthly", e.target.checked)
                    }
                  />
                  {text("Monthly", "每月")}
                </label>
                <button
                  className="terminal-icon"
                  aria-label={text("Remove scheduled item", "移除计划项目")}
                  onClick={() =>
                    setCommitments((old) => old.filter((x) => x.id !== c.id))
                  }
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            className="secondary"
            disabled={commitments.length >= 50}
            onClick={() =>
              setCommitments((old) => [
                ...old,
                {
                  id: crypto.randomUUID(),
                  name: "",
                  date,
                  amount: "",
                  kind: "outflow",
                  monthly: false,
                },
              ])
            }
          >
            <Plus size={15} />
            {text("Add unpaid commitment", "添加待支付计划")}
          </button>
          <label className="purchase-scenario">
            {text("What-if purchase now", "假设现在消费")} · {currency}
            <input
              aria-label={text("What-if purchase amount", "假设消费金额")}
              inputMode="decimal"
              value={purchase}
              onChange={(e) => setPurchase(e.target.value)}
            />
            <input
              aria-label={text("Purchase slider", "消费滑块")}
              type="range"
              min="0"
              max="10000"
              step="50"
              value={Math.min(10000, Math.max(0, Number(purchase) || 0))}
              onChange={(e) => setPurchase(e.target.value)}
            />
          </label>
          {projection && (
            <div className="projection-grid">
              {projection.rows.map((r) => (
                <article key={r.period}>
                  <h3>{r.period}</h3>
                  <Money value={r.closing} currency={currency} />
                  <p>
                    + {r.income} − {r.outflow} {currency}
                  </p>
                  <small>
                    {text(
                      "Projected after reserve & purchase",
                      "扣除预留与假设消费后",
                    )}
                  </small>
                </article>
              ))}
            </div>
          )}
          {reserve == null && (
            <p>
              {text(
                "Approve a reserve for this currency before calculating.",
                "请先批准当前币种的预留金额。",
              )}
            </p>
          )}
        </div>
      )}
      {mode === "fx" && (
        <div>
          <p>
            {text(
              "Original ledgers remain separate. Supply a dated conversion quote for each other currency. This is a manual valuation, not a live FX feed.",
              "各币种原账本独立。为其他币种填写带日期的汇率；此为手动折算，并非实时行情。",
            )}
          </p>
          {exposureGroups(state)
            .rows.filter((r) => r.currency !== currency)
            .map((r) => (
              <div className="fx-quote" key={r.currency}>
                <strong>
                  {r.amount} {r.currency} → {currency}
                </strong>
                <div className="form-grid two">
                  <label>
                    {text(
                      `1 ${r.currency} in ${currency}`,
                      `1 ${r.currency} 折合 ${currency}`,
                    )}
                    <input
                      inputMode="decimal"
                      value={quotes[r.currency]?.rate || ""}
                      onChange={(e) =>
                        quoteChange(r.currency, "rate", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    {text("Quote date", "汇率日期")}
                    <input
                      type="date"
                      value={quotes[r.currency]?.date || ""}
                      onChange={(e) =>
                        quoteChange(r.currency, "date", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    {text("Source / provider", "来源 / 提供方")}
                    <input
                      maxLength={120}
                      value={quotes[r.currency]?.source || ""}
                      onChange={(e) =>
                        quoteChange(r.currency, "source", e.target.value)
                      }
                    />
                  </label>
                  <label>
                    {text(
                      "Earlier comparison rate (optional)",
                      "前期比较汇率（可选）",
                    )}
                    <input
                      inputMode="decimal"
                      value={quotes[r.currency]?.previousRate || ""}
                      onChange={(e) =>
                        quoteChange(r.currency, "previousRate", e.target.value)
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
          {converted && (
            <div className="lab-result">
              <h3>{text("Converted recorded net worth", "折算已记录净值")}</h3>
              <Money value={converted.total} currency={currency} />
              {converted.missing.length > 0 && (
                <p>
                  {text("Missing prices or quotes: ", "缺少估值或汇率：")}
                  {converted.missing.join(", ")}
                </p>
              )}
              <p>
                {text(
                  "Cash + recorded investments − recorded liabilities. Unrecorded assets and debts are excluded.",
                  "现金 + 已记录投资 − 已记录负债，不包含未记录资产负债。",
                )}
              </p>
              {converted.fxEffect !== null && (
                <p>
                  {text(
                    "FX-only effect at unchanged holdings: ",
                    "保持同一持仓的汇率影响：",
                  )}
                  <Money value={converted.fxEffect} currency={currency} />
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {mode === "bridge" && (
        <div>
          <p>
            {text(
              "Illustrate moving recorded surplus into a chosen investment at its recorded value. No order, expected return or price-drop recommendation. Fees and taxes are excluded.",
              "按记录估值模拟将结余划入用户选定投资；不下单、不预测收益或因价格下跌推荐买入。不包含费用税务。",
            )}
          </p>
          <div className="form-grid two">
            <label>
              {text("Investment for illustration", "模拟投资条目")}
              <select
                value={investment}
                onChange={(e) => setInvestment(e.target.value)}
              >
                <option value="">
                  {text("Choose investment", "选择投资")}
                </option>
                {state.investments
                  .filter(
                    (i) =>
                      !i.archived &&
                      i.currency === currency &&
                      i.latest?.market_value != null,
                  )
                  .map((i) => (
                    <option value={i.id} key={i.id}>
                      {i.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {text("Hypothetical allocation", "假设划拨金额")}
              <input
                inputMode="decimal"
                value={transfer}
                onChange={(e) => setTransfer(e.target.value)}
              />
            </label>
          </div>
          {bridge && (
            <div className="lab-result">
              <p>
                {text("Cash", "现金")}: {bridge.cashBefore} → {bridge.cashAfter}{" "}
                {currency}
              </p>
              <p>
                {bridge.name}: {bridge.investmentBefore} →{" "}
                {bridge.investmentAfter} {currency}
              </p>
            </div>
          )}
        </div>
      )}
      {mode === "brief" && (
        <div>
          <p>
            {text(
              "A fixed narrative from confirmed records, with original amounts, scope and source IDs. No invented causal explanation.",
              "从已确认记录生成固定叙事，包含原币种金额、范围及来源ID，不编造因果归因。",
            )}
          </p>
          <pre className="narrative-preview">
            {narrativeBrief(state, currency, locale)}
          </pre>
          <button
            className="primary"
            onClick={() =>
              saveFile(
                `financial-brief-${state.period}-${currency}.md`,
                narrativeBrief(state, currency, locale),
                "text/markdown;charset=utf-8",
              )
            }
          >
            <Download size={16} />
            {text("Download Markdown brief", "下载Markdown简报")}
          </button>
          <div className="advisory-citations">
            {facts.events.slice(0, 5).map((e) => (
              <button
                className="citation-link"
                key={e.id}
                onClick={() =>
                  onSource({
                    tab: "ledger",
                    period: e.date.slice(0, 7),
                    currency,
                    resource_id: e.id,
                  })
                }
              >
                {e.merchant} · {e.date}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <footer className="terminal-note">
        {demo
          ? text("Synthetic demo records", "合成演示记录")
          : text("Current saved records", "当前已保存记录")}{" "}
        · {state.period} · Ledger v{state.ledger_version}
      </footer>
    </section>
  );
}
