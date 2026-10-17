"use client";

import { useId, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  Bell,
  Check,
  CheckCheck,
  CircleDollarSign,
  RefreshCw,
  Wallet,
  X,
} from "lucide-react";
import { useLocale } from "./locale-provider";
import { ModalDialog } from "./record-editor";
import { Money } from "./financial-values";

export default function NotificationCenter({
  feed,
  loading = false,
  demo,
  onRead,
  onRefresh,
  onNavigate,
  onRebalance,
}) {
  const { locale, t } = useLocale(),
    text = (en, zh) => (locale === "zh" ? zh : en);
  const [unreadOnly, setUnreadOnly] = useState(false),
    [expanded, setExpanded] = useState(false),
    [selectedId, setSelectedId] = useState(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const titleId = useId();
  const items = feed?.items || [],
    unread = items.filter((n) => !n.read),
    filtered = unreadOnly ? unread : items,
    visible = expanded ? filtered : filtered.slice(0, 3),
    selected = items.find((n) => n.id === selectedId);
  const label = (n) =>
    n.kind === "budget"
      ? text(`${t(n.name)} budget exceeded`, `${t(n.name)}预算超额`)
      : n.kind === "income"
        ? text("Salary recorded", "工资已记账")
        : text(`${n.name}: recorded price lower`, `${n.name}：记录价格下跌`);
  const types = {
    budget: text("Budget", "预算"),
    income: text("Income", "收入"),
    price: text("Price observation", "价格观察"),
  };
  const date = (n) =>
    new Intl.DateTimeFormat(
      locale === "zh" ? "zh-CN" : "en-AU",
      n.kind === "budget"
        ? { month: "short", year: "numeric", timeZone: "UTC" }
        : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" },
    ).format(new Date(n.date + "T12:00:00Z"));
  async function act(operation) {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await operation();
    } catch (e) {
      setError(t(e.message));
    } finally {
      setPending(false);
    }
  }
  function open(n) {
    setSelectedId(n.id);
    if (!n.read) act(() => onRead([n.id]));
  }
  function detail(n) {
    if (n.kind === "budget")
      return (
        <>
          {text(
            "Above your approved monthly budget by ",
            "超过已批准月度预算 ",
          )}
          <Money value={n.amount} currency={n.currency} />.
        </>
      );
    if (n.kind === "income")
      return (
        <>
          {n.name} · <Money value={n.amount} currency={n.currency} />
        </>
      );
    return (
      <>
        {text("Unit price down ", "单位价格下降 ")}
        <strong>{n.percent}%</strong>
        {text(" between saved observations.", "，基于两次已保存观察。")}
      </>
    );
  }
  return (
    <section
      className="notification-center panel"
      id="workspace-notifications"
      tabIndex={-1}
      aria-label={text("Notifications", "通知")}
    >
      <header className="notification-heading">
        <div>
          <span className="terminal-overline">
            {text("YOUR ATTENTION", "值得关注")}
          </span>
          <h2>
            <Bell size={18} />
            {text("Notifications", "通知")}
            {unread.length > 0 && (
              <span className="notification-count">{unread.length}</span>
            )}
          </h2>
          <p>
            {text(
              "Important changes from your saved records. All original currencies.",
              "已保存记录中的重要变化，保留各自原币种。",
            )}
          </p>
        </div>
        <div className="notification-tools">
          <div
            className="notification-tabs"
            role="group"
            aria-label={text("Notification filter", "通知筛选")}
          >
            <button
              aria-pressed={!unreadOnly}
              onClick={() => setUnreadOnly(false)}
            >
              {text("All", "全部")}
            </button>
            <button
              aria-pressed={unreadOnly}
              onClick={() => setUnreadOnly(true)}
            >
              {text("Unread", "未读")}
              {unread.length > 0 && ` ${unread.length}`}
            </button>
          </div>
          <button
            className="text-button"
            disabled={pending || loading || !unread.length}
            onClick={() => act(() => onRead(unread.map((n) => n.id)))}
          >
            <CheckCheck size={15} />
            {text("Mark all read", "全部已读")}
          </button>
          <button
            className="terminal-icon"
            aria-label={text("Refresh notifications", "刷新通知")}
            disabled={pending || loading}
            onClick={() => act(onRefresh)}
          >
            <RefreshCw size={16} className={pending ? "refreshing" : ""} />
          </button>
        </div>
      </header>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {visible.length ? (
        <div className="notification-list">
          {visible.map((n) => {
            const Icon =
              n.kind === "budget"
                ? Wallet
                : n.kind === "income"
                  ? CircleDollarSign
                  : ArrowDownRight;
            return (
              <article
                key={n.id}
                className={`notification-item ${n.kind} ${n.read ? "is-read" : "is-unread"}`}
                data-notification-kind={n.kind}
              >
                <span className="notification-glyph" aria-hidden="true">
                  <Icon size={20} />
                </span>
                <div className="notification-copy">
                  <div className="notification-meta">
                    <span>{types[n.kind]}</span>
                    <time dateTime={n.kind === "budget" ? feed.period : n.date}>
                      {date(n)}
                    </time>
                    {!n.read && (
                      <span className="notification-unread">
                        {text("New", "未读")}
                      </span>
                    )}
                  </div>
                  <button
                    className="notification-title"
                    onClick={() => open(n)}
                  >
                    {label(n)}
                  </button>
                  <p>{detail(n)}</p>
                  {n.kind === "budget" && onRebalance && (
                    <button
                      className="text-button notification-rebalance"
                      onClick={() => onRebalance(n)}
                    >
                      {text("Simulate a budget rebalance", "模拟预算调平")}
                    </button>
                  )}
                </div>
                <div className="notification-actions">
                  {!n.read && (
                    <button
                      className="terminal-icon"
                      disabled={pending}
                      aria-label={text(
                        `Mark read: ${label(n)}`,
                        `标记已读：${label(n)}`,
                      )}
                      onClick={() => act(() => onRead([n.id]))}
                    >
                      <Check size={16} />
                    </button>
                  )}
                  <button
                    className="notification-open"
                    aria-label={text(
                      `View notification: ${label(n)}`,
                      `查看通知：${label(n)}`,
                    )}
                    onClick={() => open(n)}
                  >
                    <ArrowRight size={17} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="notification-empty">
          <Bell size={24} />
          <div>
            <h3>
              {loading
                ? text(
                    "Updating this month's notifications…",
                    "正在更新本月通知…",
                  )
                : unreadOnly && items.length
                  ? text("You're all caught up", "未读通知已处理完毕")
                  : text("No notifications for this month", "本月暂无通知")}
            </h3>
            <p>
              {text(
                "Confirmed salary, approved budget overruns and saved price changes will appear here.",
                "工资确认入账、已批准预算超额或已保存价格变化后，将在此显示。",
              )}
            </p>
          </div>
        </div>
      )}
      <footer className="notification-footer">
        <span>
          {demo
            ? text(
                "Demo presets · No external feed",
                "演示预设 · 无外部数据连接",
              )
            : text(
                "Saved records · No live bank or market feed",
                "已保存记录 · 尚无实时银行或行情连接",
              )}
        </span>
        {filtered.length > 3 && (
          <button
            className="text-button"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? text("Show less", "收起")
              : text(
                  `Show all ${filtered.length}`,
                  `查看全部 ${filtered.length} 条`,
                )}
          </button>
        )}
      </footer>
      {selected && (
        <ModalDialog titleId={titleId} onClose={() => setSelectedId(null)}>
          <div className="notification-detail">
            <header>
              <span className={`notification-type ${selected.kind}`}>
                {types[selected.kind]}
              </span>
              <button
                className="terminal-icon"
                aria-label={text("Close notification", "关闭通知")}
                onClick={() => setSelectedId(null)}
              >
                <X size={18} />
              </button>
            </header>
            <h2 id={titleId}>{label(selected)}</h2>
            <p>{detail(selected)}</p>
            <dl>
              <dt>{text("Period / currency", "期间 / 币种")}</dt>
              <dd>
                {selected.period} · {selected.currency}
              </dd>
              {selected.kind === "budget" && (
                <>
                  <dt>{text("Confirmed spending", "已确认费用")}</dt>
                  <dd>
                    <Money
                      value={selected.actual}
                      currency={selected.currency}
                    />
                  </dd>
                  <dt>{text("Approved budget", "已批准预算")}</dt>
                  <dd>
                    <Money
                      value={selected.limit}
                      currency={selected.currency}
                    />
                  </dd>
                </>
              )}
              {selected.kind === "price" && (
                <>
                  <dt>{text("Previous observation", "上次观察")}</dt>
                  <dd>
                    {selected.previous_price} {selected.currency}/unit ·{" "}
                    {selected.previous_observed_at.slice(0, 10)}
                  </dd>
                  <dt>{text("Latest observation", "最近观察")}</dt>
                  <dd>
                    {selected.price} {selected.currency}/unit ·{" "}
                    {selected.observed_at.slice(0, 10)}
                  </dd>
                </>
              )}
              <dt>{text("Basis", "依据")}</dt>
              <dd>
                {selected.source === "confirmed_ledger"
                  ? text("Confirmed ledger records", "已确认账本记录")
                  : text(
                      "Two saved unit-price observations",
                      "两次已保存单位价格观察",
                    )}
              </dd>
            </dl>
            <p className="notification-disclosure">
              {selected.kind === "price"
                ? text(
                    "This compares recorded unit prices. Corporate actions, FX and fees are not adjusted. It is neither live market performance nor a recommendation to trade.",
                    "此处比较已记录的单位价格，未调整公司行动、汇率或费用；不代表实时市场表现，也不是交易建议。",
                  )
                : selected.kind === "income"
                  ? text(
                      "This confirms a record in your ledger. It does not verify receipt in a bank account.",
                      "此通知确认账本记录，不代表已经核实银行账户到账。",
                    )
                  : text(
                      "Only confirmed expenses, net of linked refunds, are compared with your approved budget for this month and currency.",
                      "仅比较本月本币种已确认费用（扣除关联退款）与已批准预算。",
                    )}
            </p>
            <button
              className="primary"
              onClick={() => {
                setSelectedId(null);
                onNavigate(selected.target);
              }}
            >
              {selected.kind === "price"
                ? text("View investment history", "查看投资历史")
                : selected.kind === "budget"
                  ? text("Review related spending", "查看相关费用")
                  : text("View salary record", "查看工资记录")}
              <ArrowRight size={16} />
            </button>
          </div>
        </ModalDialog>
      )}
    </section>
  );
}
