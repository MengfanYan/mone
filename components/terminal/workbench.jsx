"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  Bot,
  Check,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  Layers,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { minor, format, precision } from "@/lib/demo/calculations.mjs";
import { LanguageSwitch } from "../locale-provider";
import { ModalDialog } from "../record-editor";
import { Money } from "../financial-values";
import { useScreenPrivacy, useTerminalText } from "./context";
import {
  assetAllocation,
  allocationWorksheet,
  currentAllocationWorksheet,
  csvWorksheet,
} from "@/lib/terminal/analytics.mjs";
import {
  DEFAULT_SCENARIO,
  simulatePlanning,
} from "@/lib/terminal/simulation.mjs";

export function saveFile(name, content, type = "application/json") {
  const url = URL.createObjectURL(
    new Blob(
      [
        typeof content === "string"
          ? content
          : JSON.stringify(content, null, 2),
      ],
      { type },
    ),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TerminalHeader({
  cloud = false,
  tabs,
  onNavigate,
  demo,
  onLock,
  unreadCount = 0,
  onNotifications,
  onTask,
}) {
  const text = useTerminalText(),
    { masked, toggleMask } = useScreenPrivacy();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const titleId = useId();
  useEffect(() => {
    const handle = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((x) => !x);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);
  return (
    <>
      <header className="topbar">
        <a
          className="terminal-brand"
          aria-label={text("ZhiZhang home", "知账首页")}
          href={demo ? "/demo" : "/"}
        >
          <span className="terminal-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span>
            {text("ZhiZhang", "知账")}{" "}
            <span>{text("Finance workspace", "财务工作台")}</span>
          </span>
        </a>
        <button
          className="terminal-search"
          aria-label={text("Go to module…", "跳转模块…")}
          onClick={() => {
            setQuery("");
            setOpen(true);
          }}
        >
          <Search size={15} />
          <span>{text("Ask, record or find…", "提问、记账或查找…")}</span>
          <kbd>⌘ K</kbd>
        </button>
        <div className="topbar-right">
          <span className="terminal-mode">
            <i />
            {demo ? "DEMO" : cloud ? "CLOUD" : "LOCAL"}
          </span>
          <LanguageSwitch />
          <button
            className="terminal-icon notification-bell"
            aria-label={text(
              `Notifications, ${unreadCount} unread`,
              `通知，${unreadCount}条未读`,
            )}
            disabled={masked}
            onClick={onNotifications}
          >
            <Bell size={17} />
            {!masked && unreadCount > 0 && (
              <span>{unreadCount > 9 ? "9+" : unreadCount}</span>
            )}
          </button>
          <button
            className="terminal-icon"
            aria-label={
              masked
                ? text("Reveal financial content", "显示财务内容")
                : text("Hide financial content", "隐藏财务内容")
            }
            aria-pressed={masked}
            onClick={toggleMask}
          >
            {masked ? <EyeOff size={17} /> : <Eye size={17} />}
          </button>

          <button
            className="icon-button mobile-lock"
            aria-label={text("Lock workspace", "锁定工作台")}
            onClick={onLock}
          >
            <ShieldCheck size={17} />
          </button>
          <div className="avatar">S</div>
        </div>
      </header>
      {open && (
        <ModalDialog titleId={titleId} onClose={() => setOpen(false)}>
          <div className="terminal-palette">
            <div className="terminal-section-header">
              <h2 id={titleId}>{text("Command center", "指令中心")}</h2>
              <button
                className="terminal-icon"
                aria-label={text("Close", "关闭")}
                onClick={() => setOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <input
              aria-label={text("Search modules", "搜索模块")}
              placeholder={text(
                "Type a task or module name…",
                "输入任务或模块名称…",
              )}
              onKeyDown={(e) => {
                if (e.key === "Enter" && query.trim() && !masked) {
                  setOpen(false);
                  onTask({ text: query });
                }
              }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {!masked && (
              <div className="omni-actions">
                <button
                  className="primary"
                  onClick={() => {
                    setOpen(false);
                    onTask({ text: query });
                  }}
                >
                  <Sparkles size={16} />
                  {text("Preview a task", "预览任务")}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setOpen(false);
                    onTask({ mode: "evidence" });
                  }}
                >
                  {text("Receipt / PDF / CSV", "小票 / PDF / CSV")}
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setOpen(false);
                    onTask({ mode: "analysis", text: query });
                  }}
                >
                  {text("Read-only diagnostics", "只读诊断")}
                </button>
              </div>
            )}
            <div className="palette-results">
              {tabs
                .filter((x) =>
                  x.label.toLowerCase().includes(query.toLowerCase()),
                )
                .map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => {
                      onNavigate(id);
                      setOpen(false);
                    }}
                  >
                    <Icon size={18} />
                    <span>{label}</span>
                    <ChevronRight size={16} />
                  </button>
                ))}
            </div>
            {!tabs.some((x) =>
              x.label.toLowerCase().includes(query.toLowerCase()),
            ) && <p>{text("No matching modules.", "没有匹配的模块。")}</p>}
          </div>
        </ModalDialog>
      )}
    </>
  );
}

function AssetDonut({ allocation, onSelect }) {
  const text = useTerminalText();
  return (
    <div className="terminal-donut-wrap">
      <svg
        viewBox="0 0 180 180"
        className="terminal-donut"
        role="img"
        aria-label={text(
          "Asset allocation, excluding liabilities",
          "资产分布，不包含负债",
        )}
      >
        <circle
          cx="90"
          cy="90"
          r="65"
          fill="none"
          stroke="#20334a"
          strokeWidth="21"
        />
        {allocation.slices.map((s, index) => {
          const start = allocation.slices
            .slice(0, index)
            .reduce((sum, previous) => sum + previous.percent, 0);
          return (
            <circle
              key={s.id}
              cx="90"
              cy="90"
              r="65"
              fill="none"
              stroke={s.color}
              strokeWidth="21"
              pathLength="100"
              strokeDasharray={`${s.percent} ${100 - s.percent}`}
              strokeDashoffset={-start}
              transform="rotate(-90 90 90)"
            >
              <title>
                {s.name}: {s.percent}%
              </title>
            </circle>
          );
        })}
        <text x="90" y="82" textAnchor="middle">
          {text("RECORDED ASSETS", "已记录资产")}
        </text>
        <text x="90" y="104" textAnchor="middle" className="donut-total">
          {allocation.currency}
        </text>
      </svg>
      <div className="allocation-legend">
        {allocation.slices.map((s) => (
          <button key={s.id} onClick={() => onSelect?.(s.id)}>
            <i style={{ background: s.color }} />
            <span>
              {s.id === "cash" ? text("Cash accounts", "现金账户") : s.name}
            </span>
            <b>{s.percent.toFixed(2)}%</b>
            <small>
              <Money value={s.value} currency={allocation.currency} />
            </small>
          </button>
        ))}
        {!allocation.slices.length && (
          <p>
            {text(
              "No positive recorded assets in this currency.",
              "此币种暂无已记录的正资产。",
            )}
          </p>
        )}
      </div>
    </div>
  );
}

export function AllocationPanel({
  state,
  currency,
  onNavigate,
  worksheet = false,
}) {
  const text = useTerminalText();
  const allocation = assetAllocation(state, currency);
  const [open, setOpen] = useState(false),
    [targets, setTargets] = useState({}),
    [edited, setEdited] = useState(false),
    [error, setError] = useState("");
  const titleId = useId();
  let preview = null;
  if (open) {
    try {
      preview = edited
        ? allocationWorksheet(allocation, targets)
        : currentAllocationWorksheet(allocation);
    } catch (e) {
      error || (preview = { error: e.message });
    }
  }
  function begin() {
    const next = Object.fromEntries(
      allocation.slices.map((s) => [s.id, s.percent.toFixed(2)]),
    );
    setEdited(false);
    setTargets(next);
    setError("");
    setOpen(true);
  }
  return (
    <section className="panel terminal-allocation">
      <div className="terminal-section-header">
        <div>
          <span className="terminal-overline">
            01 / {text("ALLOCATION", "资产配置")}
          </span>
          <h2>{text("Where your assets live", "资产分布")}</h2>
        </div>
        <span className="chip">{currency}</span>
      </div>
      <AssetDonut
        allocation={allocation}
        onSelect={(id) => onNavigate(id === "cash" ? "ledger" : "portfolio")}
      />
      <p className="terminal-note">
        {text(
          "Ledger cash + latest manual valuations. Liabilities and unrecorded assets excluded; currencies stay separate.",
          "账本现金 + 最近手工估值。不含负债和未记录资产；各币种分别展示。",
        )}
      </p>
      {worksheet && (
        <button
          className="secondary"
          disabled={!allocation.slices.length}
          onClick={begin}
        >
          <SlidersHorizontal size={15} />
          {text("Allocation worksheet", "配置调整工作表")}
        </button>
      )}
      {open && (
        <ModalDialog titleId={titleId} onClose={() => setOpen(false)}>
          <div className="terminal-form">
            <div className="terminal-section-header">
              <h2 id={titleId}>
                {text("Review your target weights", "检查目标权重")}
              </h2>
              <button
                className="terminal-icon"
                onClick={() => setOpen(false)}
                aria-label={text("Close", "关闭")}
              >
                <X size={16} />
              </button>
            </div>
            <p>
              {text(
                "User-defined illustration. No orders are placed. Fees, taxes and missing assets are excluded.",
                "由你指定的配置示意，不会下单。不包含费用、税务和缺失资产。",
              )}
            </p>
            <p className="terminal-note">
              {text(
                edited
                  ? "Edited targets must total 100%. Minor-unit remainders go to the final asset."
                  : "Current allocation: no changes proposed. Display weights are rounded; differences remain zero until you edit a target.",
                edited
                  ? "编辑后权重须合计100%；最小货币单位余数分配给最后一项。"
                  : "当前配置：尚未提出调整。显示权重经过舍入；修改目标前差额保持为零。",
              )}
            </p>
            {allocation.slices.map((s) => (
              <label className="worksheet-row" key={s.id}>
                <span>{s.id === "cash" ? text("Cash", "现金") : s.name}</span>
                <input
                  aria-label={`${s.name} %`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={targets[s.id] ?? ""}
                  onChange={(e) => {
                    setEdited(true);
                    setTargets({ ...targets, [s.id]: e.target.value });
                    setError("");
                  }}
                />
                <span>%</span>
              </label>
            ))}
            {preview?.rows && (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>{text("Asset", "资产")}</th>
                      <th>{text("Target value", "目标金额")}</th>
                      <th>{text("Difference", "调整差额")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.name}</td>
                        <td>
                          <Money value={r.target_value} currency={currency} />
                        </td>
                        <td>
                          <Money value={r.change} currency={currency} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {(error || preview?.error) && (
              <p role="alert" className="terminal-error">
                {text(
                  "Weights must total 100%, with up to two decimals per asset.",
                  "各项权重之和必须为100%，最多保留两位小数。",
                )}
              </p>
            )}
            <button
              className="primary"
              disabled={!preview?.rows}
              onClick={() => {
                try {
                  saveFile(
                    "allocation-worksheet.csv",
                    csvWorksheet(
                      edited
                        ? allocationWorksheet(allocation, targets)
                        : currentAllocationWorksheet(allocation),
                    ),
                    "text/csv;charset=utf-8",
                  );
                } catch (e) {
                  setError(e.message);
                }
              }}
            >
              <Download size={16} />
              {text("Export reviewed worksheet", "导出已检查的工作表")}
            </button>
          </div>
        </ModalDialog>
      )}
    </section>
  );
}

export function TerminalMetrics({ state, currency, onSource, onReview }) {
  const text = useTerminalText(),
    allocation = assetAllocation(state, currency),
    summary = state.summary?.find((x) => x.currency === currency);
  const required =
    state.planning.currency === currency
      ? (state.risk?.goals || []).reduce(
          (n, g) => n + minor(g.monthly_required || "0", currency),
          0n,
        )
      : 0n;
  const surplus = minor(summary?.surplus || "0", currency);
  const progress =
    required > 0n
      ? Number(((surplus > 0n ? surplus : 0n) * 100n) / required)
      : null;
  return (
    <div className="terminal-kpis">
      <div className="terminal-kpi green">
        <span>{text("Recorded assets", "已记录资产")}</span>
        <Layers size={18} />
        <strong>
          <Money value={allocation.total} currency={currency} />
        </strong>
        <p>
          {text("Cash + manual investment observations", "现金 + 手工投资观察")}
        </p>
        <div
          className="asset-microbar"
          aria-label={text("Recorded asset composition", "已记录资产构成")}
        >
          {allocation.slices.map((x) => (
            <button
              key={x.id}
              title={`${x.name} · ${x.percent}%`}
              aria-label={`${x.name} ${x.value} ${currency}`}
              style={{ flexGrow: x.percent, background: x.color }}
              onClick={() =>
                onSource(
                  x.id === "cash"
                    ? { tab: "ledger", period: state.period, currency }
                    : {
                        tab: "portfolio",
                        resource_id: x.id,
                        period: state.period,
                        currency,
                      },
                )
              }
            />
          ))}
        </div>
        <details className="metric-basis audit-trail">
          <summary>{text("Definition & evidence", "口径与来源")}</summary>
          <p>
            {state.period} · {currency} · {text("Ledger version", "账本版本")}{" "}
            {state.ledger_version} · {state.calc_version}
          </p>
          <div className="audit-equation">
            <strong>
              {allocation.total} {currency} =
            </strong>
            {allocation.slices.map((x, i) => (
              <button
                key={x.id}
                onClick={() =>
                  onSource(
                    x.id === "cash"
                      ? { tab: "ledger", period: state.period, currency }
                      : {
                          tab: "portfolio",
                          resource_id: x.id,
                          period: state.period,
                          currency,
                        },
                  )
                }
              >
                <span>
                  {i ? "+ " : ""}
                  {x.name}
                </span>
                <span>{x.value}</span>
              </button>
            ))}
          </div>
          <small>
            {text(
              "Recorded positive asset values; liabilities excluded.",
              "已记录正资产估值，不含负债。",
            )}
          </small>
        </details>
      </div>
      <div className="terminal-kpi">
        <span>{text("Monthly surplus", "当月收支结余")}</span>
        <ArrowUpRight size={18} />
        <strong>
          <Money value={summary?.surplus} currency={currency} />
        </strong>
        <p>
          {text(
            "Confirmed income less confirmed expenses",
            "已确认收入减去已确认费用",
          )}
        </p>
        {progress !== null ? (
          <div className="savings-anchor">
            <progress max="100" value={Math.min(100, progress)} />
            <small>
              {progress}% ·{" "}
              {text(
                "surplus / required monthly goal saving",
                "结余 / 目标月存款要求",
              )}
            </small>
          </div>
        ) : (
          <small className="savings-anchor">
            {text(
              "Set a savings goal to track progress",
              "设置储蓄目标后跟踪进度",
            )}
          </small>
        )}
        <details className="metric-basis audit-trail">
          <summary>{text("Definition & evidence", "口径与来源")}</summary>
          <p>
            {state.period} · {currency} · {text("Ledger version", "账本版本")}{" "}
            {state.ledger_version} · {state.calc_version}
          </p>
          <p className="audit-equation">
            {summary
              ? `${summary.surplus} = ${summary.income} − ${summary.expenses} ${currency}`
              : text(
                  "No confirmed income or expenses in this scope.",
                  "当前范围没有已确认收支。",
                )}
          </p>
          <button
            className="text-button"
            onClick={() =>
              document
                .querySelector(".overview-details")
                ?.setAttribute("open", "")
            }
          >
            {text("Show cash-flow details", "展开收支明细")}
          </button>
        </details>
      </div>
      <div className="terminal-kpi amber">
        <span>{text("Review queue", "待确认队列")}</span>
        <ShieldCheck size={18} />
        <strong>
          {state.drafts.length.toString().padStart(2, "0")}{" "}
          <small>{text("drafts", "条草稿")}</small>
        </strong>
        <p>
          {text(
            "Only reviewed records enter your ledger",
            "只有检查确认后的记录才计入账本",
          )}
        </p>
        <details className="metric-basis">
          <summary>{text("Definition & evidence", "口径与来源")}</summary>
          <p>
            {state.period} · {currency} · {text("Ledger version", "账本版本")}{" "}
            {state.ledger_version} · {state.calc_version}
          </p>
          <button className="text-button" onClick={onReview}>
            {text("Open review queue", "打开审阅队列")}
          </button>
        </details>
      </div>
    </div>
  );
}

export function DashboardPulse({ state, currency, onNavigate }) {
  const text = useTerminalText();
  const points =
    state.money_flow?.find((p) => p.currency === currency)?.points || [];
  const net = points.map((p) =>
    format(minor(p.income, currency) - minor(p.expenses, currency), currency),
  );
  const values = net.map(Number);
  const lo = Math.min(0, ...values),
    hi = Math.max(1, ...values),
    x = (i) => 55 + (i / Math.max(1, points.length - 1)) * 462,
    y = (v) => 172 - ((v - lo) / (hi - lo)) * 135;
  const path = values
    .map((v, i) => `${i ? "L" : "M"}${x(i)},${y(v)}`)
    .join(" ");
  return (
    <>
      <div className="terminal-analytics-grid">
        <AllocationPanel
          state={state}
          currency={currency}
          onNavigate={onNavigate}
        />
        <section className="panel">
          <div className="terminal-section-header">
            <div>
              <span className="terminal-overline">02 / CASH FLOW</span>
              <h2>{text("Your month in motion", "本月资金脉动")}</h2>
              <p>
                {text(
                  "Weekly income less expenses · confirmed ledger only",
                  "每周收入减去费用 · 仅已确认账本",
                )}
              </p>
            </div>
            <span className="chip">{currency}</span>
          </div>
          <svg
            className="terminal-chart"
            viewBox="0 0 550 220"
            role="img"
            aria-label={text("Weekly net cash flow", "每周净收支")}
          >
            {[lo, (hi + lo) / 2, hi].map((v, i) => (
              <g key={i}>
                <line
                  className="grid-line"
                  x1="55"
                  x2="517"
                  y1={y(v)}
                  y2={y(v)}
                />
                <text x="48" y={y(v) + 4} textAnchor="end">
                  {new Intl.NumberFormat("en", {
                    notation: "compact",
                    maximumFractionDigits: 1,
                  }).format(v)}
                </text>
              </g>
            ))}
            {values.length > 1 && (
              <path
                d={`${path} L${x(values.length - 1)},${y(0)} L${x(0)},${y(0)} Z`}
                fill="#458bff1f"
              />
            )}
            <path className="curve-line" d={path} />
            {points.map((p, i) => (
              <g key={p.label}>
                <circle cx={x(i)} cy={y(values[i])} r="4" fill="#74b3ff">
                  <title>
                    {p.label}: {net[i]} {currency}
                  </title>
                </circle>
                <text x={x(i)} y="204" textAnchor="middle">
                  {p.label}
                </text>
              </g>
            ))}
          </svg>
          <p className="terminal-note">
            {text(
              "Observed activity, not a market forecast. No smoothing or invented historical balances.",
              "实际记录的活动，不是行情预测；未平滑或编造历史余额。",
            )}
          </p>
        </section>
      </div>
      <section className="terminal-insight">
        <h2>
          <Sparkles size={18} />
          {text("A clear next step", "下一步，有据可循")}
        </h2>
        <p>
          {text(
            `${state.drafts.length} candidates await your review. Only confirmed records affect this month's totals. Compare actual spending with your own approved budget before changing the plan.`,
            `还有${state.drafts.length}条候选待你复核。只有已确认记录影响本月汇总。调整规划前，可以先对照你已批准的预算与实际支出。`,
          )}
        </p>
        <div className="button-row">
          <span className="chip">
            {text("LOCAL RULES · NO MODEL CALL", "本地规则 · 未调用模型")}
          </span>
          <button className="secondary" onClick={() => onNavigate("ledger")}>
            {text("Review the queue", "复核待确认队列")}
            <ArrowUpRight size={14} />
          </button>
          <button
            className="text-button"
            onClick={() => onNavigate("planning")}
          >
            {text("Compare your budget", "对照预算")}
            <ChevronRight size={14} />
          </button>
        </div>
      </section>
    </>
  );
}

export function PlanningSimulator({ currency, authorized, demo, api }) {
  const text = useTerminalText();
  const empty = () =>
    Object.fromEntries(
      Object.keys(DEFAULT_SCENARIO).map((key) => [
        key,
        key === "seed" ? 4819 : "",
      ]),
    );
  const [parameters, setParameters] = useState(() =>
    demo ? { ...DEFAULT_SCENARIO } : empty(),
  );
  const [runs, setRuns] = useState(1200),
    [result, setResult] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const simulation = useMemo(() => {
    if (!authorized) return null;
    if (!demo)
      return result &&
        result.paths === runs &&
        Object.keys(parameters).every(
          (key) => parameters[key] === result.parameters[key],
        )
        ? result
        : null;
    try {
      return simulatePlanning(parameters, runs);
    } catch {
      return null;
    }
  }, [parameters, runs, authorized, demo, result]);
  async function run() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const value = await api("terminal/simulation", "POST", {
        parameters,
        paths: runs,
      });
      if (active.current) setResult(value);
    } catch (e) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  const controls = [
    ["age", text("Current age", "当前年龄"), 18, 80, 1],
    ["retirementAge", text("Target age", "目标年龄"), 19, 100, 1],
    ["initial", text("Starting capital", "起始本金"), 0, 1000000, 1000],
    ["monthly", text("Monthly contribution", "每月投入"), 0, 20000, 50],
    [
      "goal",
      text("Goal in today's money", "目标金额（现值）"),
      10000,
      5000000,
      10000,
    ],
    [
      "annualReturn",
      text("Assumed annual return %", "假设年收益率 %"),
      -20,
      30,
      0.1,
    ],
    ["inflation", text("Assumed inflation %", "假设通胀率 %"), -2, 15, 0.1],
    ["volatility", text("Annual volatility %", "年化波动率 %"), 0, 60, 1],
  ];
  const valid = Boolean(simulation);
  const max = valid
    ? Math.max(
        parameters.goal,
        ...simulation.points.map((p) => p.p95),
        ...simulation.samples.flat(),
      ) * 1.06
    : 1;
  const x = (i) =>
      50 + (i / Math.max(1, parameters.retirementAge - parameters.age)) * 600,
    y = (value) => 235 - Math.min(1, value / max) * 200;
  const path = (values) =>
    values
      .map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
      .join(" ");
  return (
    <section className="scenario-workbench">
      <div className="terminal-section-header">
        <div>
          <span className="terminal-overline">
            PLANNING ENGINE / MONTE CARLO
          </span>
          <h2>{text("Explore your possible futures", "探索未来的可能路径")}</h2>
          <p>
            {text(
              "An illustrative model, separate from your ledger and approved budget.",
              "独立于真实账本与已批准预算的模型示意。",
            )}
          </p>
        </div>
        <span className="chip">{text("LOCAL COMPUTATION", "本地计算")}</span>
      </div>
      {!authorized ? (
        <div className="panel">
          <p>
            {text(
              "Enable local analysis in Privacy & consent to run this simulation.",
              "请在隐私与授权中开启本地分析后运行模拟。",
            )}
          </p>
        </div>
      ) : (
        <div className="scenario-layout">
          <div className="panel scenario-controls">
            <div className="terminal-section-header">
              <h3>{text("Your assumptions", "你的假设")}</h3>
              <SlidersHorizontal size={17} />
            </div>
            {controls.map(([key, label, min, max, step]) => (
              <div className="scenario-control" key={key}>
                <label htmlFor={`scenario-${key}`}>{label}</label>
                <div className="slider-row">
                  {(demo || parameters[key] !== "") && (
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      aria-label={`${label} slider`}
                      value={Math.min(max, Math.max(min, parameters[key]))}
                      onChange={(e) =>
                        setParameters({
                          ...parameters,
                          [key]: Number(e.target.value),
                        })
                      }
                    />
                  )}
                  <input
                    id={`scenario-${key}`}
                    type="number"
                    min={min}
                    max={
                      key === "initial"
                        ? 1e10
                        : key === "monthly"
                          ? 1e6
                          : key === "goal"
                            ? 1e11
                            : max
                    }
                    step={step}
                    value={parameters[key]}
                    onChange={(e) =>
                      setParameters({
                        ...parameters,
                        [key]:
                          e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            ))}
            <div className="scenario-control">
              <label htmlFor="scenario-paths">
                {text("Simulation paths", "模拟路径数")}
              </label>
              <select
                id="scenario-paths"
                value={runs}
                onChange={(e) => setRuns(Number(e.target.value))}
              >
                <option>600</option>
                <option>1200</option>
                <option>2400</option>
              </select>
            </div>
            <div className="scenario-actions">
              {!demo && (
                <button
                  className="primary"
                  disabled={
                    busy ||
                    Object.values(parameters).some((value) => value === "")
                  }
                  onClick={run}
                >
                  {text(
                    busy ? "Calculating…" : "Run simulation",
                    busy ? "计算中…" : "运行模拟",
                  )}
                </button>
              )}

              <button
                className="secondary"
                onClick={() => {
                  setParameters(demo ? { ...DEFAULT_SCENARIO } : empty());
                  setResult(null);
                  setError("");
                }}
              >
                {text(
                  demo ? "Reset assumptions" : "Clear assumptions",
                  demo ? "重置假设" : "清空假设",
                )}
              </button>
              <button
                className="secondary"
                disabled={!valid}
                onClick={() =>
                  saveFile("planning-scenario.json", {
                    ...simulation,
                    currency,
                    disclaimer: "ILLUSTRATIVE_MODEL_NOT_FINANCIAL_ADVICE",
                  })
                }
              >
                <Download size={15} />
                {text("Export scenario", "导出方案")}
              </button>
            </div>
            <p className="scenario-model-note">
              {text(
                "Seed 4819 · monthly lognormal returns · constant contributions in today's money · no taxes, fees or withdrawals. Enter your own assumptions; these are not expected market returns.",
                "固定随机种子4819 · 月度对数正态收益 · 固定现值投入 · 不计税费和取款。请填写你自己的假设，不代表预期市场收益。",
              )}
            </p>
          </div>
          <div className="scenario-output">
            {valid ? (
              <>
                <div className="panel">
                  <div className="terminal-section-header">
                    <div>
                      <h3>{text("Wealth trajectories", "财富路径模拟")}</h3>
                      <p>
                        {runs.toLocaleString()}{" "}
                        {text(
                          "paths · 90% model interval · real purchasing power",
                          "条路径 · 90%模型区间 · 实际购买力",
                        )}
                      </p>
                    </div>
                    <span className="chip">{currency}</span>
                  </div>
                  <svg
                    viewBox="0 0 680 275"
                    className="terminal-chart"
                    role="img"
                    aria-label={text(
                      "Monte Carlo wealth paths and 90 percent model interval",
                      "蒙特卡洛财富路径与90%模型区间",
                    )}
                  >
                    {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                      <g key={f}>
                        <line
                          x1="50"
                          x2="650"
                          y1={y(max * f)}
                          y2={y(max * f)}
                          className="grid-line"
                        />
                        <text x="43" y={y(max * f) + 4} textAnchor="end">
                          {new Intl.NumberFormat("en", {
                            notation: "compact",
                            maximumFractionDigits: 1,
                          }).format(max * f)}
                        </text>
                      </g>
                    ))}
                    <path
                      className="curve-band"
                      d={`${path(simulation.points.map((p) => p.p95))} ${simulation.points.map((p, i) => `L${x(simulation.points.length - 1 - i)},${y(simulation.points.at(-1 - i).p05)}`).join(" ")} Z`}
                    />
                    {simulation.samples.map((p, i) => (
                      <path className="sample-path" key={i} d={path(p)} />
                    ))}
                    <path
                      className="curve-line"
                      d={path(simulation.points.map((p) => p.median))}
                    />
                    <line
                      x1="50"
                      x2="650"
                      y1={y(parameters.goal)}
                      y2={y(parameters.goal)}
                      stroke="#e1be69"
                      strokeDasharray="5 5"
                    />
                    <text
                      x="650"
                      y={Math.max(16, y(parameters.goal) - 7)}
                      textAnchor="end"
                    >
                      {text("GOAL", "目标")}
                    </text>
                    {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                      <text
                        key={f}
                        x={50 + 600 * f}
                        y="260"
                        textAnchor="middle"
                      >
                        {Math.round(
                          Number(parameters.age) +
                            (parameters.retirementAge - parameters.age) * f,
                        )}
                      </text>
                    ))}
                  </svg>
                  <div className="chart-legend">
                    <span>
                      <i style={{ background: "#4d9aff" }} />
                      {text("Median", "中位数")}
                    </span>
                    <span>
                      <i style={{ background: "#8870e9" }} />
                      {text("5th–95th percentile", "第5至95百分位")}
                    </span>
                  </div>
                </div>
                <div className="scenario-metrics">
                  {[
                    [
                      text("Model success rate", "模型达标率"),
                      `${(simulation.probability * 100).toFixed(1)}%`,
                    ],
                    [
                      text("Median ending value", "期末中位数"),
                      simulation.median,
                    ],
                    [
                      text("10th percentile", "第10百分位"),
                      simulation.downside,
                    ],
                    [
                      text("Monthly for 90% in model", "模型90%达标所需月投入"),
                      simulation.monthlyFor90,
                    ],
                  ].map(([label, value], i) => (
                    <div className="terminal-kpi" key={label}>
                      <span>{label}</span>
                      <strong>
                        {i ? (
                          <Money
                            value={value.toFixed(precision[currency] ?? 2)}
                            currency={currency}
                          />
                        ) : (
                          value
                        )}
                      </strong>
                    </div>
                  ))}
                </div>
                <div className="terminal-insight">
                  <h2>
                    <Sparkles size={18} />
                    {text("A decision you can examine", "让决策有据可查")}
                  </h2>
                  <p>
                    {text(
                      "The model reuses the same random paths when assumptions change, making comparisons reproducible. A 90% simulated success rate is not a real-world guarantee.",
                      "修改假设后仍使用相同随机路径，便于复现和比较。模型90%达标率不等于现实中的保证。",
                    )}
                  </p>
                  <button
                    className="secondary"
                    disabled={simulation.monthlyFor90 > 1e6}
                    onClick={() =>
                      setParameters({
                        ...parameters,
                        monthly: simulation.monthlyFor90,
                      })
                    }
                  >
                    {text(
                      "Try the model's 90% contribution",
                      "试用模型90%达标月投入",
                    )}
                  </button>
                </div>
              </>
            ) : (
              <div
                className="panel scenario-empty"
                role={error ? "alert" : "status"}
              >
                <SlidersHorizontal size={30} />
                <h3>
                  {text("Start with your own assumptions", "从你的假设开始")}
                </h3>
                <p>
                  {error ||
                    text(
                      demo
                        ? "Check the inputs. Target age must be later than current age, with a horizon of 1–60 years."
                        : "No projection has been generated. Enter all assumptions and run a calculation through the local API. No example balances or market forecasts are loaded.",
                      demo
                        ? "请检查输入。目标年龄必须大于当前年龄，期限为1至60年。"
                        : "尚未生成预测。填写全部假设后，通过本地接口运行计算。不会加载示例余额或行情预测。",
                    )}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ActivityConsole({ state, command, demo, api }) {
  const text = useTerminalText(),
    { masked } = useScreenPrivacy();
  const [copied, setCopied] = useState(false),
    [audit, setAudit] = useState(null);
  useEffect(() => {
    let active = true;
    api("terminal/audit")
      .then((value) => {
        if (active) setAudit(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, state]);
  const operations = command.plan?.operations || [],
    status = command.plan?.status || "IDLE";
  const payload = {
    status,
    ledger_version: state.ledger_version,
    operation_count: operations.length,
    reviewed: command.plan?.reviewed ?? false,
    automatic_cloud: false,
    trading: false,
  };
  return (
    <aside
      className="agent-console"
      aria-label={text("Activity console", "活动控制台")}
    >
      <section className="console-card">
        <div className="terminal-section-header">
          <h2>
            <Bot size={17} />
            {text("Agent console", "代理控制台")}
          </h2>
          <span className="console-status">{demo ? "PRESET" : "LOCAL"}</span>
        </div>
        <p>
          {text(
            "Read, explain, review. You authorize every ledger change.",
            "读取、解释、复核。账本变更均由你批准。",
          )}
        </p>
        <div className="console-workflow">
          {[
            ["01", text("Input & evidence", "输入与证据")],
            ["02", text("Local parsing", "本地解析")],
            ["03", text("Validation & scope", "验证与权限")],
            ["04", text("Your confirmation", "你的确认")],
          ].map(([n, label], i) => (
            <div
              key={n}
              className={operations.length && i < 3 ? "completed" : ""}
            >
              <span>{n}</span>
              <b>{label}</b>
              {operations.length && i < 3 ? (
                <Check size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </div>
          ))}
        </div>
        <div className="console-result">
          <span>{text("CURRENT STATE", "当前状态")}</span>
          <strong>{status}</strong>
        </div>
      </section>
      <section className="console-card">
        <div className="terminal-section-header">
          <h3>{text("Activity log", "活动日志")}</h3>
          <span className="chip">
            {audit?.verified
              ? text("CHAIN OK", "链校验通过")
              : text("LOCAL", "本地")}
          </span>
        </div>
        {masked ? (
          <p>
            {text(
              "Event details hidden by screen privacy.",
              "屏幕隐私已隐藏事件详情。",
            )}
          </p>
        ) : (
          <div className="console-events">
            {audit?.events?.slice(0, 6).map((e, i) => (
              <div key={e.id || i}>
                <time>{e.at?.slice(11, 19) || "—"}</time>
                <span>{e.action}</span>
              </div>
            ))}
            {!audit?.events?.length && (
              <p>{text("No recorded activity yet.", "暂无已记录的活动。")}</p>
            )}
          </div>
        )}
      </section>
      <section className="console-card">
        <div className="terminal-section-header">
          <h3>{text("Execution scope", "执行范围")}</h3>
          <button
            className="text-button"
            onClick={async () => {
              try {
                await globalThis.navigator.clipboard.writeText(
                  JSON.stringify(payload, null, 2),
                );
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? text("Copied", "已复制") : text("Copy", "复制")}
          </button>
        </div>
        <pre>{JSON.stringify(payload, null, 2)}</pre>
        <p>
          {text(
            "No bank connection. No order execution. Console records observable app state, not model thoughts.",
            "未连接银行，不执行订单。控制台展示可观察的应用状态，不展示模型内部思维。",
          )}
        </p>
      </section>
    </aside>
  );
}
