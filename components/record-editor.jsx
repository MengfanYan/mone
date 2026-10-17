"use client";

import { useEffect, useId, useRef } from "react";
import { X, FileText } from "lucide-react";
import { useLocale, LanguageSwitch } from "./locale-provider";

function Field({ label, children, ...props }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children ? children(id) : <input id={id} {...props} />}
    </div>
  );
}

function useModal() {
  const element = useRef(null);
  useEffect(() => {
    const previous = document.activeElement,
      dialog = element.current;
    dialog.showModal();
    (
      dialog.querySelector("input:not([type=checkbox]),select,textarea") ||
      dialog.querySelector("button")
    )?.focus();
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const cycleFocus = (event) => {
      if (event.key !== "Tab") return;
      const controls = [
        ...dialog.querySelectorAll(
          'button:not([disabled]),a[href],input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex="0"]',
        ),
      ].filter((e) => e.getClientRects().length && e.tabIndex >= 0);
      const first = controls[0],
        last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    dialog.addEventListener("keydown", cycleFocus);
    return () => {
      dialog.removeEventListener("keydown", cycleFocus);
      dialog.close();
      document.body.style.overflow = before;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return element;
}

export function ModalDialog({ titleId, onClose, children }) {
  const element = useModal();
  return (
    <dialog
      ref={element}
      className="modal"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export function EditorDrawer({ title, onClose, children }) {
  const element = useModal();
  const { t } = useLocale();
  return (
    <dialog
      ref={element}
      className="editor-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        const bounds = e.currentTarget.getBoundingClientRect();
        if (
          e.target === e.currentTarget &&
          (e.clientX < bounds.left ||
            e.clientX > bounds.right ||
            e.clientY < bounds.top ||
            e.clientY > bounds.bottom)
        )
          onClose();
      }}
    >
      <div className="editor-dialog-content">
        <header>
          <div>
            <span className="eyebrow">{t("核对本地记录")}</span>
            <h2>{title}</h2>
          </div>
          <LanguageSwitch />
          <button
            type="button"
            className="icon-button"
            aria-label={t("关闭编辑器")}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export default function RecordEditor({
  value,
  onChange,
  accounts,
  transactions = [],
  onSave,
  onCancel,
  busy,
  error,
  source,
  submitLabel,
  resourceType = "record",
  operationKind = "",
}) {
  const { t } = useLocale();
  const update = (key, v) => onChange({ ...value, [key]: v });
  const kinds = {
    expense: "日常支出",
    income: "工资/其他收入",
    transfer: "内部转账",
    card_payment: "信用卡还款本金",
    loan_received: "借款本金到账",
    debt_principal: "债务本金偿还",
    interest: "利息/费用",
    dividend: "分红收入",
    investment_buy: "投资买入本金",
    investment_sell: "投资卖出本金",
    refund: "关联退款",
  };
  const codes = [
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
  ];
  const record = resourceType === "record";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      {source && (
        <details className="editor-source">
          <summary>
            <FileText size={15} />
            {t("对照来源")}
          </summary>
          <p>{source}</p>
        </details>
      )}
      {error && (
        <p id="record-field-error" className="notice error" role="alert">
          {error}
        </p>
      )}
      <div className="form-grid two">
        {record ? (
          <>
            <Field label={t("账户")}>
              {(id) => (
                <select
                  id={id}
                  value={value.account_id || ""}
                  required
                  onChange={(e) => {
                    const a = accounts.find((x) => x.id === e.target.value);
                    onChange({
                      ...value,
                      account_id: a?.id || null,
                      currency: a?.currency || value.currency,
                      counterparty_id: null,
                    });
                  }}
                >
                  <option value="">{t("选择账户")}</option>
                  {accounts
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.currency}
                      </option>
                    ))}
                </select>
              )}
            </Field>
            <Field label={t("交易类型")}>
              {(id) => (
                <select
                  id={id}
                  value={value.kind || "expense"}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      kind: e.target.value,
                      counterparty_id: null,
                      refund_of: null,
                    })
                  }
                >
                  {Object.entries(kinds).map(([key, label]) => (
                    <option value={key} key={key}>
                      {t(label)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "record-field-error" : undefined}
              label={t("金额 · {v0}", { v0: value.currency || "?" })}
              value={value.amount || ""}
              required
              inputMode="decimal"
              onChange={(e) => update("amount", e.target.value)}
            />
            <Field
              label={t("发生日")}
              type="date"
              value={value.date || ""}
              required
              onChange={(e) => update("date", e.target.value)}
            />
            <Field
              label={t("商户/描述")}
              value={value.merchant || ""}
              maxLength={120}
              required
              onChange={(e) => update("merchant", e.target.value)}
            />
            <Field
              label={t("类别")}
              value={value.category || ""}
              maxLength={40}
              required
              onChange={(e) => update("category", e.target.value)}
            />
            {[
              "transfer",
              "card_payment",
              "loan_received",
              "debt_principal",
            ].includes(value.kind) && (
              <Field label={t("对方账户")}>
                {(id) => (
                  <select
                    id={id}
                    value={value.counterparty_id || ""}
                    required
                    onChange={(e) => update("counterparty_id", e.target.value)}
                  >
                    <option value="">{t("选择同币种对方账户")}</option>
                    {accounts
                      .filter(
                        (a) =>
                          !a.archived &&
                          a.id !== value.account_id &&
                          a.currency === value.currency &&
                          a.type ===
                            (value.kind === "transfer" ? "cash" : "liability"),
                      )
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
            )}
            {value.kind === "refund" && (
              <Field label={t("关联原消费")}>
                {(id) => (
                  <select
                    id={id}
                    value={value.refund_of || ""}
                    required
                    onChange={(e) => update("refund_of", e.target.value)}
                  >
                    <option value="">{t("选择原消费")}</option>
                    {transactions
                      .filter(
                        (x) =>
                          x.kind === "expense" &&
                          !x.reverses &&
                          x.account_id === value.account_id &&
                          !transactions.some((r) => r.reverses === x.id),
                      )
                      .map((x) => (
                        <option key={x.id} value={x.id}>
                          {x.date} {x.merchant} {x.amount}
                        </option>
                      ))}
                  </select>
                )}
              </Field>
            )}
          </>
        ) : (
          <>
            <Field
              label={t(resourceType === "budget" ? "类别" : "名称")}
              value={
                (resourceType === "budget" ? value.category : value.name) || ""
              }
              required
              onChange={(e) =>
                update(
                  resourceType === "budget" ? "category" : "name",
                  e.target.value,
                )
              }
            />
            <Field label={t("币种")}>
              {(id) => (
                <select
                  id={id}
                  value={value.currency || ""}
                  disabled={["update_account", "delete_account"].includes(
                    operationKind,
                  )}
                  required
                  onChange={(e) => update("currency", e.target.value)}
                >
                  <option value="">{t("选择币种")}</option>
                  {codes.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              )}
            </Field>
            {["budget", "goal", "account"].includes(resourceType) &&
              !["update_account", "delete_account"].includes(operationKind) && (
                <Field
                  label={t(resourceType === "goal" ? "目标金额" : "金额")}
                  value={value.target || value.amount || ""}
                  required
                  inputMode="decimal"
                  onChange={(e) =>
                    update(
                      resourceType === "goal" ? "target" : "amount",
                      e.target.value,
                    )
                  }
                />
              )}
            {resourceType === "goal" && (
              <>
                <Field
                  label={t("已存金额")}
                  value={value.saved || "0"}
                  onChange={(e) => update("saved", e.target.value)}
                />
                <Field
                  label={t("截止日期")}
                  type="date"
                  required
                  value={value.deadline || ""}
                  onChange={(e) => update("deadline", e.target.value)}
                />
              </>
            )}
            {resourceType === "investment" && (
              <>
                <Field
                  label={t("观察时间（含时区）")}
                  placeholder="2026-09-30T06:00:00Z"
                  value={value.observed_at || ""}
                  onChange={(e) => update("observed_at", e.target.value)}
                />
                <Field
                  label={t("市值（未知留空）")}
                  value={value.market_value || ""}
                  inputMode="decimal"
                  onChange={(e) => update("market_value", e.target.value)}
                />
                <Field
                  label={t("剩余成本（未知留空）")}
                  value={value.cost_basis || ""}
                  inputMode="decimal"
                  onChange={(e) => update("cost_basis", e.target.value)}
                />
                <Field
                  label={t("凭证报告累计收益")}
                  value={value.reported_gain || ""}
                  inputMode="decimal"
                  onChange={(e) => update("reported_gain", e.target.value)}
                />
                <Field
                  label={t("今日收益（不计为累计）")}
                  value={value.daily_gain || ""}
                  inputMode="decimal"
                  onChange={(e) => update("daily_gain", e.target.value)}
                />
              </>
            )}
          </>
        )}
      </div>
      {record && (
        <label className="inline-choice">
          <input
            type="checkbox"
            checked={Boolean(value.mock)}
            onChange={(e) => update("mock", e.target.checked)}
          />
          {t("合成演示记录（MOCK）")}
        </label>
      )}
      <div className="form-footer editor-actions">
        <p>{t("保存更正后仍需明确确认，候选不计入正式统计。")}</p>
        <div className="button-row">
          <button type="button" className="secondary" onClick={onCancel}>
            {t("取消修改")}
          </button>
          <button className="primary" disabled={busy}>
            {submitLabel || t("保存草稿")}
          </button>
        </div>
      </div>
    </form>
  );
}
