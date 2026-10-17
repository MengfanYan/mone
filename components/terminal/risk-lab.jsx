"use client";
import { useMemo, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { historicalRisk } from "@/lib/terminal/analytics.mjs";
import { useTerminalText } from "./context";
import { saveFile } from "./workbench";

const sample =
  "observed_at,unit_price\n" +
  Array.from(
    { length: 30 },
    (_, i) =>
      `2026-09-${String(i + 1).padStart(2, "0")},${[100, 100.6, 100.4, 100.9, 100.2, 100.7, 100.5, 101.2, 101.8, 101.1, 101.7, 102.1, 101.5, 101.9, 102.4, 102.2, 102.7, 103.1, 102.4, 102.8, 103.3, 102.9, 103.5, 103.2, 103.7, 103.1, 103.8, 104.1, 103.7, 104.2][i]}`,
  ).join("\n");

export function parsePriceHistory(source) {
  const rows = source
    .trim()
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  if (
    rows.length < 2 ||
    rows.length > 501 ||
    rows.shift().trim() !== "observed_at,unit_price"
  )
    throw new Error("PRICE_CSV_FORMAT");
  const seen = new Set();
  return rows.map((row) => {
    const [at, price, ...extra] = row.split(",").map((v) => v.trim());
    if (
      extra.length ||
      !/^\d{4}-\d{2}-\d{2}$/.test(at) ||
      new Date(at + "T00:00:00Z").toISOString().slice(0, 10) !== at ||
      seen.has(at) ||
      !/^\d+(?:\.\d{1,8})?$/.test(price) ||
      !Number.isFinite(Number(price)) ||
      Number(price) <= 0
    )
      throw new Error("PRICE_CSV_FORMAT");
    seen.add(at);
    return { observed_at: at + "T00:00:00Z", unit_price: price };
  });
}

export default function PortfolioRiskLab({ currency, demo }) {
  const text = useTerminalText(),
    [source, setSource] = useState(""),
    [simulated, setSimulated] = useState(false),
    [frequency, setFrequency] = useState("weekdays"),
    [closed, setClosed] = useState(""),
    [market, setMarket] = useState(""),
    [adjustment, setAdjustment] = useState("unknown");
  const result = useMemo(() => {
    if (!source.trim()) return null;
    try {
      return historicalRisk(parsePriceHistory(source), currency, {
        frequency,
        closedDates: closed.split(/[\s,]+/).filter(Boolean),
        market: market || text("Unspecified market", "未指定市场"),
        adjustment,
      });
    } catch {
      return { error: true };
    }
  }, [source, currency, frequency, closed, market, adjustment, text]);
  return (
    <section className="panel risk-lab">
      <div className="terminal-section-header">
        <div>
          <span className="terminal-overline">PORTFOLIO / RISK EVIDENCE</span>
          <h2>{text("Understand the observed risk", "理解已观察到的风险")}</h2>
          <p>
            {text(
              "Single-series historical loss, calculated from unit prices, never from changes in holding value.",
              "根据单位价格计算单序列历史损失，不把持仓市值变化当作价格变化。",
            )}
          </p>
        </div>
        <ShieldCheck size={21} />
      </div>
      <div className="terminal-split">
        <div className="terminal-form">
          <div className="risk-history-options">
            <label>
              {text("Observation frequency", "观察频率")}
              <select
                aria-label={text("Observation frequency", "观察频率")}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="weekdays">
                  {text(
                    "Trading sessions: weekdays + declared closures",
                    "交易日：工作日与指定休市日",
                  )}
                </option>
                <option value="calendar_days">
                  {text(
                    "Every calendar day (including crypto)",
                    "每个自然日（含加密资产）",
                  )}
                </option>
              </select>
            </label>
            <label>
              {text("Market / source label", "市场 / 来源名称")}
              <input
                value={market}
                onChange={(e) => setMarket(e.target.value)}
                maxLength={100}
              />
            </label>
            {frequency === "weekdays" && (
              <label>
                {text(
                  "Exchange closure dates (YYYY-MM-DD)",
                  "交易所休市日（YYYY-MM-DD）",
                )}
                <textarea
                  value={closed}
                  onChange={(e) => setClosed(e.target.value)}
                  maxLength={4000}
                  rows={2}
                />
              </label>
            )}
            <label>
              {text("Price adjustment", "价格复权口径")}
              <select
                value={adjustment}
                onChange={(e) => setAdjustment(e.target.value)}
              >
                <option value="unknown">
                  {text(
                    "Unknown — corporate actions not checked",
                    "未知 — 未核对公司行动",
                  )}
                </option>
                <option value="adjusted">
                  {text(
                    "Source declares adjusted prices",
                    "来源声明为复权价格",
                  )}
                </option>
                <option value="unadjusted">
                  {text("Unadjusted prices", "未复权价格")}
                </option>
              </select>
            </label>
            <p className="terminal-note">
              {text(
                "Weekdays alone are not an exchange calendar. Enter the selected market's closures; no holiday feed or missing prices are invented.",
                "仅工作日不等于交易所日历。请填写对应市场休市日；系统不虚构节假日或补造缺失价格。",
              )}
            </p>
          </div>
          <label>
            {text("Unit-price CSV", "单位价格CSV")}
            <textarea
              aria-label={text("Unit-price CSV", "单位价格CSV")}
              rows={5}
              maxLength={40000}
              value={source}
              onChange={(e) => {
                setSource(e.target.value);
                setSimulated(false);
              }}
              placeholder={
                "observed_at,unit_price\n2026-09-01,100.25\n2026-09-02,99.80"
              }
            />
          </label>
          <div className="button-row">
            <button
              className="secondary"
              onClick={() =>
                saveFile(
                  "unit-price-template.csv",
                  "observed_at,unit_price\n2026-09-01,100.25\n2026-09-02,99.80",
                  "text/csv;charset=utf-8",
                )
              }
            >
              <Download size={15} />
              {text("CSV template", "CSV模板")}
            </button>
            {demo && (
              <button
                className="secondary"
                onClick={() => {
                  setFrequency("calendar_days");
                  setClosed("");
                  setMarket("Synthetic daily series");
                  setSource(sample);
                  setSimulated(true);
                }}
              >
                {text("Use synthetic price sample", "使用合成价格样例")}
              </button>
            )}
          </div>
          <p>
            {text(
              "Paste 21–500 dated positive prices with a chosen calendar. Kept in this view's memory only; not added to the ledger or sent to a model.",
              "粘贴21至500条正价格，日期应符合所选日历。仅保留在本视图内存中，不计入账本，不发送给模型。",
            )}
          </p>
        </div>
        <div>
          {simulated && (
            <span className="chip">
              MOCK · {text("Synthetic calendar-day sample", "合成日历日样本")}
            </span>
          )}
          {result?.available ? (
            <>
              <div className="terminal-kpis risk-metrics">
                <div className="terminal-kpi amber">
                  <span>
                    {text(
                      "95% historical loss percentile",
                      "95%历史损失分位数",
                    )}
                  </span>
                  <strong>{result.loss_percent_95.toFixed(2)}%</strong>
                </div>
                <div className="terminal-kpi">
                  <span>
                    {text("Observed interval volatility", "观察间隔收益波动")}
                  </span>
                  <strong>{result.volatility_percent.toFixed(2)}%</strong>
                </div>
              </div>
              <p className="terminal-note">
                {result.observations} {text("price observations", "个价格观察")}{" "}
                ·{" "}
                {result.frequency === "weekdays"
                  ? text("one trading session", "一个交易观察间隔")
                  : result.interval_days.toFixed(1)}{" "}
                {result.frequency !== "weekdays" &&
                  text("calendar days per interval", "日历天 / 间隔")}{" "}
                · {result.market} · {result.window_start}–{result.window_end} ·{" "}
                {result.adjustment}
              </p>
              <button
                className="secondary"
                onClick={() =>
                  saveFile("historical-risk-evidence.json", {
                    ...result,
                    observations: parsePriceHistory(source),
                    mock: simulated,
                    disclaimer:
                      "EMPIRICAL_SINGLE_SERIES_NOT_PORTFOLIO_FORECAST",
                  })
                }
              >
                <Download size={15} />
                {text("Export risk evidence", "导出风险依据")}
              </button>
            </>
          ) : (
            <div className="terminal-empty" role="status">
              {result?.error
                ? text(
                    "Use observed_at,unit_price columns, valid dates, and positive prices without duplicate dates.",
                    "请使用 observed_at,unit_price 两列，日期有效且不重复，价格必须为正数。",
                  )
                : result
                  ? text(
                      ({
                        MISSING_SESSION:
                          "Missing a price for an expected session: ",
                        OBSERVATION_OUTSIDE_CALENDAR:
                          "A price date falls outside the selected calendar.",
                        INVALID_CALENDAR:
                          "Use valid closure dates in YYYY-MM-DD format.",
                        DUPLICATE_DATES:
                          "Duplicate observation dates are not allowed.",
                        INVALID_PRICE_OR_DATE:
                          "Each observation needs a valid date and a positive unit price.",
                      }[result.reason] ||
                        "Insufficient or irregular price history. At least 21 unit prices matching the selected calendar are required.") +
                        (result.missing_date || ""),
                      ({
                        MISSING_SESSION: "预期交易日缺少价格：",
                        OBSERVATION_OUTSIDE_CALENDAR:
                          "观察日期不符合所选日历。",
                        INVALID_CALENDAR: "休市日必须是有效的YYYY-MM-DD日期。",
                        DUPLICATE_DATES: "观察日期不能重复。",
                        INVALID_PRICE_OR_DATE:
                          "每个观察需要有效日期及正的单位价格。",
                      }[result.reason] ||
                        "价格历史不足或不规律。至少需要21条符合所选日历的单位价格。") +
                        (result.missing_date || ""),
                    )
                  : text(
                      "Risk is unknown without unit-price evidence. Paste a history to calculate it locally.",
                      "缺少单位价格证据时，风险保持未知。粘贴历史数据后可在本机计算。",
                    )}
            </div>
          )}
          <div className="terminal-muted-box">
            {text(
              "Empirical fifth-percentile simple returns and sample standard deviation, per observed interval. Not annualized, not whole-portfolio VaR, and not a prediction or maximum possible loss. No correlation, fees or liquidity model.",
              "使用每个观察间隔的简单收益率计算经验第5百分位和样本标准差。未年化，不代表整个组合的VaR，也不是预测或最大可能损失；不包含相关性、费用或流动性模型。",
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
