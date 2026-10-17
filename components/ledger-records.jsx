"use client";
import { Search, Download } from "lucide-react";
import { useState } from "react";
import { useTerminalText } from "./terminal/context";
import { saveFile } from "./terminal/workbench";
import { minor } from "@/lib/demo/calculations.mjs";
import { Money } from "./financial-values";
import { CategoryIcon } from "./command-result-card";
import { useLocale } from "./locale-provider";

export default function LedgerRecords({
  state,
  period,
  currency,
  scope,
  filter,
  onFilter,
  accounts,
  kinds,
  busy,
  onEdit,
  onReverse,
}) {
  const { t } = useLocale();
  const text = useTerminalText();
  const [sort, setSort] = useState("date-desc"),
    [kind, setKind] = useState(""),
    [selected, setSelected] = useState([]),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  const reversedIds = new Set(
    state.transactions.map((e) => e.reverses).filter(Boolean),
  );
  const entries = state.transactions
    .filter(
      (e) =>
        e.date.startsWith(period) &&
        e.currency === currency &&
        (!scope.focus_only || e.id === scope.resource_id) &&
        (!scope.budget_only ||
          (["expense", "interest", "refund"].includes(e.kind) &&
            e.category === scope.category)) &&
        (!kind || e.kind === kind) &&
        (!from || e.date >= from) &&
        (!to || e.date <= to) &&
        (!scope.effective || (!e.reverses && !reversedIds.has(e.id))) &&
        (!scope.from || e.date >= scope.from) &&
        (!scope.to || e.date <= scope.to) &&
        `${e.merchant} ${e.category}`
          .toLowerCase()
          .includes(filter.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "date-asc"
        ? a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
        : sort === "amount-desc"
          ? minor(a.amount, currency) > minor(b.amount, currency)
            ? -1
            : minor(a.amount, currency) < minor(b.amount, currency)
              ? 1
              : 0
          : b.date.localeCompare(a.date) || b.id.localeCompare(a.id),
    );
  const chosen = entries.filter((e) => selected.includes(e.id));
  const toggle = (id) =>
    setSelected((old) =>
      old.includes(id) ? old.filter((x) => x !== id) : [...old, id],
    );
  function exportRows() {
    const quote = (value) =>
      `"${String(value ?? "")
        .replaceAll('"', '""')
        .replace(/^[\s\uFEFF]*[=+@-]/, "'$&")}"`;
    const rows = [
      [
        "id",
        "date",
        "kind",
        "merchant",
        "category",
        "currency",
        "amount",
        "status",
        "mock",
      ],
      ...(chosen.length ? chosen : entries).map((e) => [
        e.id,
        e.date,
        e.kind,
        e.merchant,
        e.category,
        e.currency,
        e.amount,
        e.reverses
          ? "REVERSAL"
          : reversedIds.has(e.id)
            ? "REVERSED"
            : "CONFIRMED",
        !!e.mock,
      ]),
    ];
    saveFile(
      `ledger-${period}-${currency}.csv`,
      rows.map((r) => r.map(quote).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  }
  const status = (event) =>
    event.reverses
      ? t("冲正分录")
      : reversedIds.has(event.id)
        ? t("已冲正")
        : t("已确认");
  const actions = (event) =>
    !event.reverses &&
    !reversedIds.has(event.id) &&
    event.kind !== "opening" ? (
      <div className="ledger-record-actions">
        <button className="text-button" onClick={() => onEdit(event.id)}>
          {t("更正")}
        </button>
        <button
          className="text-button"
          disabled={busy}
          onClick={() => onReverse(event.id)}
        >
          {t("冲正")}
        </button>
      </div>
    ) : null;
  return (
    <section className="panel ledger-records">
      <div className="panel-heading">
        <h2>{t("已确认账本")}</h2>
        <div className="search">
          <Search size={16} />
          <input
            aria-label={t("搜索账本")}
            placeholder={t("搜索商户或类别")}
            value={filter}
            onChange={(e) => onFilter(e.target.value)}
          />
        </div>
      </div>
      <div className="ledger-toolbar">
        <label>
          {text("Transaction type", "交易类型")}
          <select
            aria-label={text("Transaction type", "交易类型")}
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            <option value="">{text("All types", "全部类型")}</option>
            {Object.entries(kinds).map(([id, label]) => (
              <option value={id} key={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {text("From date", "开始日期")}
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          {text("To date", "结束日期")}
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
        <label>
          {text("Sort records", "记录排序")}
          <select
            aria-label={text("Sort records", "记录排序")}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="date-desc">
              {text("Newest first", "最新优先")}
            </option>
            <option value="date-asc">{text("Oldest first", "最早优先")}</option>
            <option value="amount-desc">
              {text("Largest amount", "金额从高到低")}
            </option>
          </select>
        </label>
        <button
          className="secondary"
          disabled={!entries.length}
          onClick={exportRows}
        >
          <Download size={15} />
          {chosen.length
            ? text(
                `Export ${chosen.length} selected`,
                `导出已选${chosen.length}条`,
              )
            : text("Export filtered CSV", "导出筛选CSV")}
        </button>
      </div>
      <div className="ledger-mobile-list">
        {entries.map((event) => (
          <article
            key={event.id}
            data-resource={event.id}
            className={`ledger-mobile-record ${scope.resource_id === event.id ? "resource-highlight" : ""}`}
          >
            <CategoryIcon
              category={event.category}
              merchant={event.merchant}
              kind={event.kind}
            />
            <div>
              <label className="ledger-select">
                <input
                  type="checkbox"
                  aria-label={`${text("Select record", "选择记录")} ${event.id}`}
                  checked={selected.includes(event.id)}
                  onChange={() => toggle(event.id)}
                />
                {text("Select", "选择")}
              </label>
              <strong>
                {event.kind === "opening" ? kinds.opening : event.merchant}
              </strong>
              <p>
                {event.date} · {kinds[event.kind]} · {event.category}
              </p>
              <small>
                {accounts[event.account_id]?.name}
                {event.mock && " · MOCK"} · {status(event)}
              </small>
              {actions(event)}
            </div>
            <Money value={event.amount} currency={event.currency} />
          </article>
        ))}
      </div>
      <div className="table-wrap ledger-desktop-table">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label={text(
                    "Select all filtered records",
                    "选择全部筛选记录",
                  )}
                  checked={
                    entries.length > 0 && chosen.length === entries.length
                  }
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? entries.map((x) => x.id) : [],
                    )
                  }
                />
              </th>
              {[
                "发生日 / 描述",
                "类型 / 类别",
                "账户",
                "原币金额",
                "状态",
                "操作",
              ].map((v) => (
                <th key={v}>{t(v)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {entries.map((event) => (
              <tr
                key={event.id}
                data-resource={event.id}
                className={
                  scope.resource_id === event.id ? "resource-highlight" : ""
                }
              >
                <td>
                  <input
                    type="checkbox"
                    aria-label={`${text("Select record", "选择记录")} ${event.id}`}
                    checked={selected.includes(event.id)}
                    onChange={() => toggle(event.id)}
                  />
                </td>
                <td>
                  <strong>
                    {event.kind === "opening" ? kinds.opening : event.merchant}
                  </strong>
                  <small>
                    {event.date}
                    {event.mock && " · MOCK"}
                  </small>
                </td>
                <td>
                  {kinds[event.kind]}
                  <small>
                    {event.kind === "opening" ? kinds.opening : event.category}
                  </small>
                </td>
                <td>{accounts[event.account_id]?.name}</td>
                <td>
                  <Money value={event.amount} currency={event.currency} />
                </td>
                <td>
                  <span
                    className={`chip ${event.reverses || reversedIds.has(event.id) ? "amber-chip" : "green-chip"}`}
                  >
                    {status(event)}
                  </span>
                </td>
                <td>{actions(event)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!entries.length && (
        <p className="empty">{t("没有匹配的已确认记录。")}</p>
      )}
      <div className="panel-foot">
        {t("有效记录与冲正历史按所选范围展示。匹配{count}个事件。", {
          count: entries.length,
        })}
      </div>
    </section>
  );
}
