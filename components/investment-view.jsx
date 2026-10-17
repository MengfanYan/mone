"use client";
import { useEffect, useState } from "react";
import {
  Plus,
  TrendingUp,
  Upload,
  Archive,
  Pencil,
  ChevronDown,
  History,
  CircleAlert,
} from "lucide-react";
import { useLocale } from "./locale-provider";
import { Money } from "./financial-values";
import { monthWindow } from "@/lib/time-scopes.mjs";
import { minor, format } from "@/lib/demo/calculations.mjs";
import { EditorDrawer } from "./record-editor";

function GainCurve({ history, currency, period, timezone }) {
  const { t, dateLocale } = useLocale();
  const [mode, setMode] = useState(() =>
    history?.points.some((p) => p.net_quality === "VERIFIED_HISTORY")
      ? "NET"
      : history?.reported_points.length
        ? "REPORTED"
        : history?.points.some((p) => p.unrealized !== null)
          ? "UNREALIZED"
          : "VALUE",
  );
  const [range, setRange] = useState("ALL"),
    [selected, setSelected] = useState(null),
    [unit, setUnit] = useState("AMOUNT");
  const source = [
    ...(mode === "REPORTED"
      ? history?.reported_points || []
      : history?.points || []),
  ].sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const { start: monthStart, end: cutoff } = monthWindow(period, timezone);
  const from =
    range === "ALL"
      ? 0
      : cutoff - { "1M": 31, "3M": 93, "1Y": 366 }[range] * 86400000;
  const filtered = source.filter(
    (p) =>
      Date.parse(p.observed_at) <= cutoff && Date.parse(p.observed_at) >= from,
  );
  const points = filtered.map((p) => ({
    ...p,
    amount:
      mode === "UNREALIZED" && unit === "PERCENT"
        ? p.unrealized_percent
        : mode === "NET"
          ? p.net_gain
          : mode === "REPORTED"
            ? p.amount
            : mode === "UNREALIZED"
              ? p.unrealized
              : p.market_value,
    series: mode === "NET" ? p.net_quality : mode,
  }));
  const valid = points.filter(
    (p) => p.amount !== null && p.amount !== undefined,
  );
  const numbers = valid.map((p) => Number(p.amount)),
    min = Math.min(0, ...numbers),
    max = Math.max(1, ...numbers),
    span = max - min;
  const x = (p) => {
    const first = Date.parse(points[0]?.observed_at || 0),
      last = Date.parse(points.at(-1)?.observed_at || 1);
    return (
      72 +
      (last === first
        ? 230
        : ((Date.parse(p.observed_at) - first) / (last - first)) * 480)
    );
  };
  const y = (v) => 201 - ((Number(v) - min) / span) * 155;
  const paths = [];
  let current = [],
    previousQuality;
  for (const p of points) {
    if (p.amount == null || (previousQuality && previousQuality !== p.series)) {
      if (current.length) paths.push(current);
      current = [];
    }
    if (p.amount != null) current.push(p);
    previousQuality = p.series;
  }
  if (current.length) paths.push(current);
  const allValues = source
    .map((p) => ({
      ...p,
      amount:
        mode === "NET"
          ? p.net_gain
          : mode === "REPORTED"
            ? p.amount
            : mode === "UNREALIZED"
              ? unit === "PERCENT"
                ? p.unrealized_percent
                : p.unrealized
              : p.market_value,
      series: mode === "NET" ? p.net_quality : mode,
    }))
    .sort((a, b) => Date.parse(a.observed_at) - Date.parse(b.observed_at));
  const startPoint = allValues
      .filter((p) => Date.parse(p.observed_at) < monthStart)
      .at(-1),
    endPoint = allValues
      .filter(
        (p) =>
          Date.parse(p.observed_at) >= monthStart &&
          Date.parse(p.observed_at) <= cutoff,
      )
      .at(-1);
  const monthChange =
    startPoint?.amount != null &&
    endPoint?.amount != null &&
    startPoint.series === endPoint.series &&
    !(mode === "UNREALIZED" && unit === "PERCENT")
      ? format(
          minor(endPoint.amount, currency) - minor(startPoint.amount, currency),
          currency,
        )
      : null;
  const selectedPoint = points.find((p) => p.id === selected) || valid.at(-1);
  const label = {
    NET: "累计净收益 / 已知项收益",
    REPORTED: "凭证报告累计收益",
    UNREALIZED: "持有浮盈 / 浮亏",
    VALUE: "市值观察，不是收益",
  }[mode];
  return (
    <div className="investment-performance">
      <div className="performance-controls">
        <label>
          <span className="sr-only">{t("收益口径")}</span>
          <select
            aria-label={t("收益口径")}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setSelected(null);
            }}
          >
            <option value="NET">{t("累计净收益 / 已知项收益")}</option>
            <option value="UNREALIZED">{t("持有浮盈 / 浮亏")}</option>
            <option value="REPORTED">{t("凭证报告累计收益")}</option>
            <option value="VALUE">{t("市值观察，不是收益")}</option>
          </select>
        </label>
        <div role="group" aria-label={t("曲线时间范围")}>
          {["1M", "3M", "1Y", "ALL"].map((r) => (
            <button
              key={r}
              disabled={points.length < 2}
              aria-pressed={r === range}
              onClick={() => {
                setRange(r);
                setSelected(null);
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      {mode === "UNREALIZED" && (
        <label className="inline-choice">
          <span>{t("显示单位")}</span>
          <select
            aria-label={t("显示单位")}
            value={unit}
            onChange={(e) => {
              setUnit(e.target.value);
              setSelected(null);
            }}
          >
            <option value="AMOUNT">{t("金额")}</option>
            <option value="PERCENT">{t("浮盈率：浮盈除以剩余成本")}</option>
          </select>
        </label>
      )}
      {mode === "UNREALIZED" && unit === "PERCENT" && (
        <p className="curve-note">
          {t("只在成本大于零时显示浮盈率；不是累计总回报或TWR。")}
        </p>
      )}
      <div className="performance-value">
        <div>
          <span>{t(label)}</span>
          <strong>
            {mode === "UNREALIZED" && unit === "PERCENT" ? (
              selectedPoint?.amount != null ? (
                `${selectedPoint.amount}%`
              ) : (
                t("资料不足")
              )
            ) : (
              <Money value={selectedPoint?.amount} currency={currency} />
            )}
          </strong>
        </div>
        <p>
          {selectedPoint
            ? new Date(selectedPoint.observed_at).toLocaleDateString(dateLocale)
            : t("尚无有效观察点")}
          {mode === "NET" && selectedPoint && (
            <span className="chip">
              {t(
                selectedPoint.net_quality === "VERIFIED_HISTORY"
                  ? "资料完整（用户提供）"
                  : "税费或成本链未完整",
              )}
            </span>
          )}
        </p>
      </div>
      <div className="performance-chart-slot">
        {valid.length > 1 ? (
          <svg
            viewBox="0 0 620 244"
            className="gain-curve"
            role="group"
            aria-label={t("{label}历史曲线 · {currency}", {
              label: t(label),
              currency,
            })}
          >
            {[min, 0, max]
              .filter((v, i, a) => a.indexOf(v) === i)
              .map((v) => (
                <g key={v}>
                  <line
                    x1="72"
                    x2="580"
                    y1={y(v)}
                    y2={y(v)}
                    className={v === 0 ? "gain-zero" : "gain-grid"}
                  />
                  <text x="7" y={y(v) + 4}>
                    {String(v)}
                  </text>
                </g>
              ))}
            {paths
              .filter((p) => p.length > 1)
              .map((segment, i) => (
                <path
                  key={i}
                  d={segment
                    .map(
                      (p, j) => `${j === 0 ? "M" : "L"} ${x(p)} ${y(p.amount)}`,
                    )
                    .join(" ")}
                  fill="none"
                  strokeWidth="3"
                  className={
                    mode === "NET" &&
                    segment[0].net_quality !== "VERIFIED_HISTORY"
                      ? "gain-known-line"
                      : "gain-line"
                  }
                />
              ))}
            {valid.map((p, i) => (
              <g
                key={p.id}
                role="button"
                tabIndex="0"
                aria-label={`${new Date(p.observed_at).toLocaleDateString(dateLocale)}: ${p.amount} ${mode === "UNREALIZED" && unit === "PERCENT" ? "%" : currency}`}
                onClick={() => setSelected(p.id)}
                onKeyDown={(e) => {
                  if (["Enter", " "].includes(e.key)) {
                    e.preventDefault();
                    setSelected(p.id);
                  }
                }}
              >
                <circle cx={x(p)} cy={y(p.amount)} r="16" fill="transparent" />
                <circle
                  cx={x(p)}
                  cy={y(p.amount)}
                  r={p.id === selectedPoint?.id ? 6 : 4}
                  className="gain-point"
                />
                {(i === 0 || i === valid.length - 1 || valid.length <= 5) && (
                  <text x={x(p)} y="232" textAnchor="middle">
                    {new Date(p.observed_at).toLocaleDateString(dateLocale, {
                      day: "2-digit",
                      month: "short",
                    })}
                  </text>
                )}
              </g>
            ))}
          </svg>
        ) : valid.length === 1 ? (
          <p className="single-observation-note">
            {t("仅有一个点；添加第二次观察后才能看变化。")}
          </p>
        ) : (
          <div className="performance-empty">
            <CircleAlert size={24} />
            <strong>
              {t(mode === "VALUE" ? "还没有市值观察" : "收益资料不足")}
            </strong>
            <p>{t("补充观察时间、成本或明确的累计收益；不会用零代替未知。")}</p>
          </div>
        )}
      </div>
      <div className="performance-notes">
        {mode !== "VALUE" && (
          <p className="curve-note">
            {t("本月同口径变化")} ·{" "}
            {monthChange === null ? (
              t("缺期初基点或口径不一致，无法比较。")
            ) : (
              <Money value={monthChange} currency={currency} />
            )}
          </p>
        )}

        {valid.length > 1 && (
          <p className="curve-note">
            {t("观察点连线，不代表期间每日实测。")}
            {points.some((p) => p.amount == null) &&
              ` ${t("缺资料处保留断点。")}`}
          </p>
        )}
      </div>
      <details className="performance-evidence">
        <summary>
          <History size={15} />
          {t("查看观察点、来源与收益事件")}
        </summary>
        <div className="performance-data-list">
          {points.map((p) => (
            <button
              key={p.id}
              className={p.id === selectedPoint?.id ? "selected" : ""}
              onClick={() => setSelected(p.id)}
            >
              <span>
                {new Date(p.observed_at).toLocaleDateString(dateLocale)}
              </span>
              {mode === "UNREALIZED" && unit === "PERCENT" ? (
                p.amount == null ? (
                  t("资料不足")
                ) : (
                  `${p.amount}%`
                )
              ) : (
                <Money value={p.amount} currency={currency} />
              )}
              <span>
                {t(
                  p.series === "VERIFIED_HISTORY"
                    ? "资料完整（用户提供）"
                    : p.series === "KNOWN_COMPONENTS"
                      ? "已知项，资料未完整"
                      : "用户/凭证观察",
                )}
              </span>
            </button>
          ))}
        </div>
        {selectedPoint && (
          <dl className="evidence-facts">
            <dt>{t("来源")}</dt>
            <dd>{selectedPoint.evidence?.source}</dd>
            <dt>{t("观察编号")}</dt>
            <dd>{selectedPoint.id}</dd>
            <dt>{t("关联收益事件")}</dt>
            <dd>{selectedPoint.event_refs?.join(", ") || t("无")}</dd>
          </dl>
        )}
        <div className="performance-event-list">
          {(history?.events || []).map((e) => (
            <div key={e.id}>
              <span>
                {t(
                  {
                    buy: "买入本金",
                    sell: "卖出及成本分摊",
                    distribution: "收益分配",
                    fee: "费用",
                    tax: "税费",
                    reinvestment: "分红再投资",
                  }[e.content.type],
                )}
              </span>
              <Money value={e.content.amount} currency={currency} />
              <small>{e.observed_at}</small>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default function InvestmentView({
  state,
  api,
  period,
  currency,
  onConfirm,
  onUpload,
  trigger = 0,
  focusResource,
}) {
  const { t } = useLocale();
  const [histories, setHistories] = useState({}),
    [error, setError] = useState(""),
    [editor, setEditor] = useState(null),
    [showArchived, setShowArchived] = useState(false),
    [saving, setSaving] = useState(false),
    [seen, setSeen] = useState(trigger),
    [focusSeen, setFocusSeen] = useState(null);
  if (focusResource && focusResource.key !== focusSeen) {
    setFocusSeen(focusResource.key);
    const entry = state.investments.find((e) => e.id === focusResource.id);
    if (entry && !focusResource.viewOnly)
      setEditor({
        action: "metadata",
        entry,
        fields: { name: entry.name, issuer: entry.issuer },
      });
  }
  useEffect(() => {
    if (!focusResource?.viewOnly) return;
    const target = [...document.querySelectorAll("[data-investment]")].find(
      (node) => node.getAttribute("data-investment") === focusResource.id,
    );
    target?.scrollIntoView({ block: "start", behavior: "instant" });
    target?.focus({ preventScroll: true });
  }, [focusResource]);
  if (trigger !== seen) {
    setSeen(trigger);
    setEditor({
      action: "create",
      fields: {
        name: "",
        issuer: "",
        currency,
        observed_at: "",
        market_value: "",
        cost_basis: "",
        reported_gain: "",
        history_complete: false,
        fees_taxes_known: false,
      },
    });
  }
  useEffect(() => {
    if (!state.consents.analysis) return;
    let active = true;
    Promise.all(
      state.investments.map(async (entry) => [
        entry.id,
        await api(`investments/${entry.id}/performance`),
      ]),
    )
      .then((data) => {
        if (active) {
          setHistories(Object.fromEntries(data));
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [
    api,
    state.investments,
    state.portfolio_version,
    state.consents.analysis,
  ]);
  const entries = state.investments.filter(
    (x) => x.currency === currency && (showArchived || !x.archived),
  );
  const update = (key, value) =>
    setEditor((old) => ({ ...old, fields: { ...old.fields, [key]: value } }));
  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const f = editor.fields;
      let payload;
      if (editor.action === "metadata")
        payload = {
          action: "metadata",
          version: editor.entry.version,
          patch: { name: f.name, issuer: f.issuer },
        };
      else if (editor.action === "performance_event")
        payload = {
          action: "performance_event",
          version: editor.entry.version,
          event: {
            type: f.type,
            amount: f.amount,
            observed_at: f.observed_at,
            cost_allocated: f.cost_allocated || null,
            cost_added: f.cost_added || null,
            fee: f.fee === "" ? null : f.fee,
            tax: f.tax === "" ? null : f.tax,
            capitalized: Boolean(f.capitalized),
            included_in_net: Boolean(f.included_in_net),
            distribution_in_cost: Boolean(f.distribution_in_cost),
            ledger_event_ref: f.ledger_event_ref || null,
            evidence: {
              source: state.mock ? "DEMO_USER_EVENT" : "user_event",
              mock: state.mock,
            },
          },
        };
      else {
        const valuation =
          f.market_value || f.reported_gain || (f.quantity && f.price)
            ? {
                observed_at: f.observed_at,
                market_value: f.market_value || null,
                cost_basis: f.cost_basis || null,
                reported_gain: f.reported_gain || null,
                reported_semantics: "CUMULATIVE",
                quantity: f.quantity || null,
                price: f.price || null,
                fees_taxes_known: Boolean(f.fees_taxes_known),
                supersedes: f.supersedes || null,
              }
            : null;
        if (editor.action === "create")
          payload = {
            action: "create",
            entry: {
              name: f.name,
              issuer: f.issuer || "User provided",
              currency: f.currency,
              asset_type: f.asset_type || "fund",
              history_complete: Boolean(f.history_complete),
              mock: state.mock,
            },
            ...(valuation && { valuation }),
          };
        else
          payload = {
            action: "valuation",
            version: editor.entry.version,
            valuation,
          };
      }
      const resource = editor.entry?.id || "new",
        path =
          editor.action === "create"
            ? "investments"
            : editor.action === "metadata"
              ? `investments/${resource}`
              : `investments/${resource}/${editor.action === "performance_event" ? "performance-events" : "valuations"}`;
      await onConfirm(
        "investment_change",
        resource,
        path,
        editor.action === "metadata" ? "PATCH" : "POST",
        payload,
      );
      setEditor(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="investment-view">
      <div className="section-action-row">
        <div>
          <h2>
            <TrendingUp size={20} />
            {t("每项投资，各有一条历史")}
          </h2>
          <p>{t("新增估值更新同一条目；浮盈不会计入现金收入。")}</p>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={onUpload}>
            <Upload size={16} />
            {t("上传投资截图")}
          </button>
          <button
            className="primary"
            onClick={() =>
              setEditor({
                action: "create",
                fields: {
                  name: "",
                  issuer: "",
                  currency,
                  observed_at: "",
                  market_value: "",
                  cost_basis: "",
                  reported_gain: "",
                  history_complete: false,
                  fees_taxes_known: false,
                },
              })
            }
          >
            <Plus size={16} />
            {t("新增本地投资")}
          </button>
        </div>
      </div>
      <label className="inline-choice">
        <input
          type="checkbox"
          checked={showArchived}
          onChange={(e) => setShowArchived(e.target.checked)}
        />
        {t("显示归档投资与历史")}
      </label>
      {error && (
        <div className="notice error" role="alert">
          {t(error)}
        </div>
      )}
      <div className="investment-card-grid">
        {entries.map((entry) => (
          <article
            className={`investment-card ${focusResource?.viewOnly && focusResource.id === entry.id ? "resource-highlight" : ""}`}
            key={entry.id}
            data-investment={entry.id}
            tabIndex={-1}
          >
            <header>
              <span className="investment-symbol">
                <TrendingUp size={22} />
              </span>
              <div>
                <h3>{entry.name}</h3>
                <p>
                  {entry.issuer} · {entry.currency}
                </p>
              </div>
              <span className="chip">
                {t(
                  entry.archived
                    ? "已归档，历史保留"
                    : entry.mock
                      ? "MOCK"
                      : "本地自定义",
                )}
              </span>
            </header>
            <div className="investment-card-actions">
              <button
                className="text-button"
                disabled={entry.archived}
                onClick={() =>
                  setEditor({
                    action: "valuation",
                    entry,
                    fields: {
                      name: entry.name,
                      currency: entry.currency,
                      observed_at: "",
                      market_value: "",
                      cost_basis: "",
                      reported_gain: "",
                      fees_taxes_known: false,
                    },
                  })
                }
              >
                <Plus size={14} />
                {t("更新估值")}
              </button>
              <button
                className="text-button"
                onClick={() =>
                  setEditor({
                    action: "metadata",
                    entry,
                    fields: { name: entry.name, issuer: entry.issuer },
                  })
                }
              >
                <Pencil size={14} />
                {t("编辑投资")}
              </button>
              <button
                className="text-button"
                disabled={entry.archived}
                onClick={() =>
                  setEditor({
                    action: "performance_event",
                    entry,
                    fields: {
                      type: "buy",
                      amount: "",
                      observed_at: "",
                      cost_allocated: "",
                      cost_added: "",
                      fee: "",
                      tax: "",
                      capitalized: false,
                      included_in_net: false,
                    },
                  })
                }
              >
                <History size={14} />
                {t("记录收益事件")}
              </button>
              <button
                className="text-button"
                disabled={entry.archived}
                onClick={() =>
                  onConfirm(
                    "investment_change",
                    entry.id,
                    `investments/${entry.id}`,
                    "PATCH",
                    { action: "archive", version: entry.version },
                  ).catch((e) => setError(e.message))
                }
              >
                <Archive size={14} />
                {t("归档")}
              </button>
            </div>
            {state.consents.analysis ? (
              histories[entry.id] ? (
                <GainCurve
                  history={histories[entry.id]}
                  currency={entry.currency}
                  period={period}
                  timezone={state.planning.timezone}
                />
              ) : (
                <p className="performance-empty">{t("正在读取历史观察…")}</p>
              )
            ) : (
              <div className="performance-empty">
                <Money
                  value={entry.latest?.market_value}
                  currency={entry.currency}
                />
                <p>{t("原始观察可编辑；开启分析后查看收益曲线。")}</p>
              </div>
            )}
          </article>
        ))}
      </div>
      {!entries.length && (
        <div className="empty">
          <TrendingUp size={30} />
          <strong>{t("此币种还没有本地投资")}</strong>
          <p>{t("可先创建条目，逐次补充真实估值；不会自动买入。")}</p>
        </div>
      )}
      {editor && (
        <EditorDrawer
          title={t(
            {
              create: "新增本地投资",
              valuation: "更新估值",
              metadata: "编辑投资",
              performance_event: "记录收益事件",
            }[editor.action],
          )}
          onClose={() => setEditor(null)}
        >
          <form onSubmit={save}>
            <div className="form-grid two">
              {["create", "metadata"].includes(editor.action) && (
                <>
                  <label className="field">
                    <span>{t("投资名称")}</span>
                    <input
                      value={editor.fields.name}
                      onChange={(e) => update("name", e.target.value)}
                      required
                      maxLength={120}
                    />
                  </label>
                  <label className="field">
                    <span>{t("发行人")}</span>
                    <input
                      value={editor.fields.issuer}
                      onChange={(e) => update("issuer", e.target.value)}
                      maxLength={120}
                    />
                  </label>
                </>
              )}
              {editor.action === "create" && (
                <label className="field">
                  <span>{t("币种")}</span>
                  <select
                    aria-label={t("币种")}
                    value={editor.fields.currency}
                    onChange={(e) => update("currency", e.target.value)}
                  >
                    {["AUD", "CNY", "USD", "EUR", "GBP", "JPY", "KWD"].map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                </label>
              )}
              {editor.action !== "metadata" && (
                <label className="field">
                  <span>{t("观察时间（含时区）")}</span>
                  <input
                    value={editor.fields.observed_at || ""}
                    placeholder="2026-09-30T06:00:00Z"
                    onChange={(e) => update("observed_at", e.target.value)}
                    required={editor.action !== "create"}
                  />
                </label>
              )}
              {["create", "valuation"].includes(editor.action) && (
                <>
                  {[
                    ["market_value", "市值（未知留空）"],
                    ["cost_basis", "剩余成本（未知留空）"],
                    ["reported_gain", "凭证报告累计收益"],
                    ["quantity", "份额（可选）"],
                    ["price", "单位价格（可选）"],
                  ].map(([key, label]) => (
                    <label key={key} className="field">
                      <span>{t(label)}</span>
                      <input
                        inputMode="decimal"
                        value={editor.fields[key] || ""}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    </label>
                  ))}
                </>
              )}
              {editor.action === "valuation" && (
                <label className="field">
                  <span>{t("同一观察时间的修订（可选）")}</span>
                  <select
                    aria-label={t("同一观察时间的修订（可选）")}
                    value={editor.fields.supersedes || ""}
                    onChange={(e) => update("supersedes", e.target.value)}
                  >
                    <option value="">{t("新增观察，不覆盖旧点")}</option>
                    {[
                      ...(histories[editor.entry.id]?.points || []),
                      ...(histories[editor.entry.id]?.reported_points || []),
                    ]
                      .filter(
                        (p, i, arr) =>
                          arr.findIndex((x) => x.id === p.id) === i,
                      )
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.observed_at} · v{p.version}
                        </option>
                      ))}
                  </select>
                  <small>
                    {t("修订时填写该点相同的观察时间；旧版本保留。")}
                  </small>
                </label>
              )}
              {editor.action === "performance_event" && (
                <>
                  <label className="field">
                    <span>{t("收益事件类型")}</span>
                    <select
                      aria-label={t("收益事件类型")}
                      value={editor.fields.type}
                      onChange={(e) => update("type", e.target.value)}
                    >
                      {Object.entries({
                        buy: "买入本金",
                        sell: "卖出及成本分摊",
                        distribution: "收益分配",
                        fee: "费用",
                        tax: "税费",
                        reinvestment: "分红再投资",
                      }).map(([key, label]) => (
                        <option value={key} key={key}>
                          {t(label)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {[
                    ["amount", "金额"],
                    ["cost_allocated", "售出对应成本（未知留空）"],
                    ["cost_added", "新增成本（可选）"],
                    ["fee", "未重复计入的费用（未知留空）"],
                    ["tax", "未重复计入的税费（未知留空）"],
                  ].map(([key, label]) => (
                    <label className="field" key={key}>
                      <span>{t(label)}</span>
                      <input
                        value={editor.fields[key] || ""}
                        inputMode="decimal"
                        onChange={(e) => update(key, e.target.value)}
                        required={key === "amount"}
                      />
                    </label>
                  ))}
                  <label className="field">
                    <span>{t("关联已确认现金事件（可选）")}</span>
                    <select
                      aria-label={t("关联已确认现金事件（可选）")}
                      value={editor.fields.ledger_event_ref || ""}
                      onChange={(e) =>
                        update("ledger_event_ref", e.target.value)
                      }
                    >
                      <option value="">{t("不建立现金分录")}</option>
                      {state.transactions
                        .filter(
                          (x) =>
                            !x.reverses &&
                            x.currency === editor.entry.currency &&
                            [
                              "dividend",
                              "investment_buy",
                              "investment_sell",
                            ].includes(x.kind) &&
                            !state.transactions.some(
                              (r) => r.reverses === x.id,
                            ),
                        )
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.date} {x.merchant} {x.amount}
                          </option>
                        ))}
                    </select>
                  </label>
                </>
              )}
            </div>
            {["create", "valuation"].includes(editor.action) && (
              <label className="inline-choice">
                <input
                  type="checkbox"
                  checked={editor.fields.fees_taxes_known || false}
                  onChange={(e) => update("fees_taxes_known", e.target.checked)}
                />
                {t("已核对费用与税费；未知时保持关闭")}
              </label>
            )}
            {editor.action === "create" && (
              <label className="inline-choice">
                <input
                  type="checkbox"
                  checked={editor.fields.history_complete || false}
                  onChange={(e) => update("history_complete", e.target.checked)}
                />
                {t("历史链从起点完整，后续成本变动逐项录入")}
              </label>
            )}
            {editor.action === "performance_event" && (
              <>
                {editor.fields.type === "distribution" && (
                  <label className="inline-choice">
                    <input
                      type="checkbox"
                      checked={Boolean(editor.fields.distribution_in_cost)}
                      onChange={(e) =>
                        update("distribution_in_cost", e.target.checked)
                      }
                    />
                    {t("收益分配已在成本调减中体现，不重复加收益")}
                  </label>
                )}
                <label className="inline-choice">
                  <input
                    type="checkbox"
                    checked={editor.fields.capitalized}
                    onChange={(e) => update("capitalized", e.target.checked)}
                  />
                  {t("费用已资本化计入成本，不再重复扣除")}
                </label>
                <label className="inline-choice">
                  <input
                    type="checkbox"
                    checked={editor.fields.included_in_net}
                    onChange={(e) =>
                      update("included_in_net", e.target.checked)
                    }
                  />
                  {t("金额已净扣税费，不再次扣减")}
                </label>
              </>
            )}
            {error && (
              <p role="alert" className="notice error">
                {t(error)}
              </p>
            )}
            <p className="editor-help">
              {t("仅维护本地历史，不执行外部买卖，不另建现金收入。")}
            </p>
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                onClick={() => setEditor(null)}
              >
                {t("取消")}
              </button>
              <button className="primary" disabled={saving}>
                {t("预览投资变更")}
                <ChevronDown size={15} />
              </button>
            </div>
          </form>
        </EditorDrawer>
      )}
    </div>
  );
}
