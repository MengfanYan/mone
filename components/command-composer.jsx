"use client";
import { splitRecordFollowup } from "@/lib/terminal/advisory.mjs";
import { Money } from "./financial-values";
import AdvisorInsights from "./advisor-insights";
import LocalDictation from "./local-dictation";
import { useTerminalText } from "./terminal/context";
import DuplicateReview from "./duplicate-review";
import { duplicateReviewComplete } from "@/lib/duplicates.mjs";
import { useState, useEffect, useRef } from "react";
import {
  MessageSquareText,
  Send,
  Upload,
  Check,
  Save,
  X,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Landmark,
  TrendingUp,
} from "lucide-react";
import { useLocale } from "./locale-provider";
import RecordEditor, { EditorDrawer } from "./record-editor";
import CommandResultCard from "./command-result-card";
import { DEMO_EVIDENCE } from "@/lib/demo/experience.mjs";
import EvidenceWorkbench from "./terminal/evidence";
import { prepareEvidencePdf } from "@/lib/terminal/evidence-pdf.mjs";

export const emptyCommandContext = () => ({
  text: "",
  plan: null,
  planMode: null,
  modeTexts: {},
  account_id: "",
  currency: "",
  doc_type: "receipt",
  image: null,
  pdfText: false,
  fileName: "",
  patches: {},
  recent: [],
  mode: "command",
  analysis: null,
  error: "",
});

export default function CommandComposer({
  api,
  state,
  demo,
  cloud = false,
  period,
  currency,
  model,
  onModel,
  onRefresh,
  onOpenRecord,
  onAddAccount,
  onManual,
  onImport,
  onAnalyze,
  onNavigate,
  onSource,
  onPropose,
}) {
  const { t } = useLocale();
  const text = useTerminalText();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false),
    [confirming, setConfirming] = useState(null),
    [editing, setEditing] = useState(null);
  const update = (patch) => {
    if (active.current) onModel((old) => ({ ...old, ...patch }));
  };
  const analysis =
    model.mode === "analysis" &&
    state.consents.analysis &&
    (model.analysis?.scope?.ledger_version == null ||
      (model.analysis.scope.ledger_version === state.ledger_version &&
        model.analysis.scope.settings_version === state.settings_version)) &&
    model.analysis?.period === period &&
    model.analysis?.scope?.currency === currency
      ? model.analysis
      : null;
  const plan =
    !model.planMode || model.planMode === model.mode ? model.plan : null;
  const locked = ["APPLIED", "DRAFT_CREATED", "CANCELLED"].includes(
    plan?.status,
  );
  const operations = plan?.operations || [];
  const changed = Object.keys(model.patches).length > 0;
  const shown = operations.map((o) => ({
    ...o,
    ...model.patches[o.op_id],
    fields: { ...o.fields, ...model.patches[o.op_id]?.fields },
  }));
  const pending = (opId, patch) =>
    onModel((old) => ({
      ...old,
      patches: {
        ...old.patches,
        [opId]: {
          ...old.patches[opId],
          ...patch,
          fields: { ...old.patches[opId]?.fields, ...patch.fields },
        },
      },
    }));
  async function work(action) {
    if (busy) return;
    setBusy(true);
    update({ error: "" });
    try {
      await action();
    } catch (e) {
      update({ error: e.message });
    } finally {
      setBusy(false);
    }
  }
  async function saveFields() {
    if (!changed) return plan;
    const result = await api(`commands/${plan.command_id}`, "PATCH", {
      version: plan.version,
      operations: Object.entries(model.patches).map(([op_id, value]) => ({
        op_id,
        ...value,
      })),
    });
    update({ plan: result, patches: {} });
    return result;
  }
  async function generate(e) {
    e?.preventDefault();
    await work(async () => {
      const readOnlyQuestion =
        model.mode === "command" &&
        /\b(analy[sz]e|analysis|recommendations?|why|risk)\b|分析|建议|风险|为什么|现金压力/i.test(
          model.text,
        ) &&
        !/\b(add|create|update|change|delete|remove|rename|cancel)\b|新增|添加|修改|删除|取消|改成|改为/i.test(
          model.text,
        );
      if (model.mode === "analysis" || readOnlyQuestion) {
        update({ analysis: null, plan: null });
        const value = await onAnalyze(model.text);
        if (value) update({ analysis: value, mode: "analysis" });
        return;
      }
      if (
        plan &&
        /^(取消任务|不要保存|别保存|cancel task|cancel)[。.! ]*$/i.test(
          model.text.trim(),
        )
      ) {
        update({
          plan: await api(`commands/${plan.command_id}/cancel`, "POST", {
            version: plan.version,
          }),
          patches: {},
        });
        setConfirming(null);
        return;
      }
      if (
        plan &&
        !locked &&
        /^(只要第一条|仅保留第一条|keep only (?:the )?first)[。.! ]*$/i.test(
          model.text.trim(),
        )
      ) {
        const result = await api(`commands/${plan.command_id}`, "PATCH", {
          version: plan.version,
          operations: operations.map((op, index) => ({
            op_id: op.op_id,
            selected: index === 0,
          })),
        });
        update({ plan: result, patches: {} });
        setConfirming(null);
        return;
      }
      const compound =
        model.mode === "command"
          ? splitRecordFollowup(model.text)
          : { record: model.text, budgetQuestion: null };
      const body = {
        text: compound.record,
        period,
        ...(model.account_id && { account_id: model.account_id }),
        ...(model.currency && { currency: model.currency }),
      };
      let result;
      if (model.mode === "evidence")
        result = await api("evidence-imports", "POST", {
          ...body,
          doc_type: model.doc_type,
          ...(model.image &&
            !model.pdfText && { image_base64: model.image.split(",")[1] }),
        });
      else
        result = await api("commands/plan", "POST", {
          ...body,
          recent_resource_ids: model.recent,
        });
      update({
        plan: result,
        planMode: model.mode,
        budgetQuestion: compound.budgetQuestion,
        patches: {},
        analysis: null,
      });
      setConfirming(null);
    });
  }
  async function preview() {
    await work(async () => {
      const p = await saveFields();
      const challenge = await api("confirmation-challenges", "POST", {
        purpose: "command_apply",
        resource_id: p.command_id,
      });
      setConfirming({
        challenge,
        plan_version: p.version,
        idempotency: crypto.randomUUID(),
      });
    });
  }
  async function apply() {
    await work(async () => {
      const value = await api(
        `commands/${plan.command_id}/apply`,
        "POST",
        {
          ...(confirming.challenge.preview.duplicate_review?.length && {
            duplicate_resolutions: confirming.duplicate_resolutions,
          }),
          nonce: confirming.challenge.nonce,
          content_hash: confirming.challenge.content_hash,
          plan_version: confirming.plan_version,
        },
        confirming.idempotency,
      );
      const next = await api(`commands/${plan.command_id}`);
      update({
        plan: next,
        patches: {},
        recent: value.results.map((x) => x.resource_id),
      });
      setConfirming(null);
      if (active.current)
        await onRefresh({ applied: true, operations: next.operations });
    });
  }
  async function saveDrafts() {
    await work(async () => {
      const p = await saveFields();
      const value = await api(
        `commands/${p.command_id}/drafts`,
        "POST",
        { version: p.version },
        crypto.randomUUID(),
      );
      update({
        plan: await api(`commands/${p.command_id}`),
        patches: {},
        recent: value.results.map((x) => x.resource_id),
      });
      if (active.current) await onRefresh();
    });
  }
  async function upload(file) {
    if (!file) return;
    if (file.type === "text/csv" || file.name.endsWith(".csv")) {
      await work(() => onImport(file));
      return;
    }
    if (/\.pdf$/i.test(file.name)) {
      await work(async () => {
        const prepared = await prepareEvidencePdf(file);
        if (demo && !prepared.pdfText)
          throw new Error(
            t("演示不识别任意图片；请选择模拟样例或粘贴支持的凭证文本。"),
          );
        update({
          text: prepared.text,
          image: prepared.image,
          pdfText: prepared.pdfText,
          fileName: file.name,
          mode: "evidence",
          plan: null,
          patches: {},
        });
      });
      return;
    }
    if (!/^image\/(png|jpeg)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
      update({ error: t("只接受5MiB以内PNG/JPEG；流水PDF请转图片或CSV。") });
      return;
    }
    if (demo) {
      update({
        error: t("演示不识别任意图片；请选择模拟样例或粘贴支持的凭证文本。"),
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      update({
        image: String(reader.result),
        pdfText: false,
        plan: null,
        patches: {},
        fileName: file.name,
        mode: "evidence",
      });
    reader.readAsDataURL(file);
  }
  function openOperation(op) {
    const result = plan.results?.find((r) => r.op_id === op.op_id);
    if (locked && result) {
      onOpenRecord(result);
      return;
    }
    setEditing({
      ...op,
      fields: {
        ...op.fields,
        ...(["budget", "goal"].some((x) => op.kind.endsWith(x)) &&
        !op.fields.currency
          ? { currency: state.planning.currency }
          : {}),
      },
      resourceType:
        op.kind === "investment_observation" || op.kind.endsWith("investment")
          ? "investment"
          : op.kind.endsWith("budget")
            ? "budget"
            : op.kind.endsWith("goal")
              ? "goal"
              : op.kind.endsWith("account")
                ? "account"
                : "record",
    });
  }
  const results =
    plan?.intent === "query"
      ? plan.results.map((r) => ({
          ...r,
          op_id: r.resource_id,
          kind: r.resource_type,
          fields: r.fields,
          status: "APPLIED",
        }))
      : shown.map((o) => ({ ...o, status: plan.status }));
  return (
    <section className="command-composer" aria-label={t("一句话工作台")}>
      <header>
        <span className="composer-symbol">
          <MessageSquareText size={21} />
        </span>
        <div>
          <h2>{t("说一句、传一张。")}</h2>
          <p>{t("先看候选，再由你确认。无需连接银行或支付平台。")}</p>
        </div>
        <span className="chip">
          {t(
            demo
              ? "模拟日期 {date}"
              : cloud
                ? "工作空间规则解析"
                : "本地规则解析",
            demo ? { date: state.demo.date } : {},
          )}
        </span>
      </header>
      <form
        onSubmit={generate}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy) upload(e.dataTransfer.files[0]);
        }}
      >
        <div
          className="composer-mode-row"
          role="tablist"
          aria-label={text("Task mode", "任务模式")}
        >
          {[
            ["command", "记录与查找"],
            ["evidence", "凭证与截图"],
            ["analysis", "只读分析"],
          ].map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="tab"
              tabIndex={model.mode === mode ? 0 : -1}
              onKeyDown={(e) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                ) {
                  e.preventDefault();
                  const tabs = [
                      ...e.currentTarget.parentElement.querySelectorAll(
                        "[role=tab]",
                      ),
                    ],
                    i = tabs.indexOf(e.currentTarget),
                    next =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? 2
                          : (i + (e.key === "ArrowRight" ? 1 : 2)) % 3;
                  tabs[next].click();
                  tabs[next].focus();
                }
              }}
              aria-selected={model.mode === mode}
              className={model.mode === mode ? "selected" : ""}
              onClick={() => {
                onModel((old) =>
                  old.mode === mode
                    ? old
                    : {
                        ...old,
                        mode,
                        text: old.modeTexts?.[mode] || "",
                        modeTexts: { ...old.modeTexts, [old.mode]: old.text },
                        error: "",
                      },
                );
                setConfirming(null);
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>
        {model.mode === "analysis" && (
          <AdvisorInsights
            key={`${period}-${currency}-${state.ledger_version}-${state.settings_version}`}
            state={state}
            currency={currency}
            period={period}
            onSource={onSource}
            onPropose={onPropose}
            compact
          />
        )}
        {model.mode === "evidence" && (
          <>
            <div
              className="evidence-type-pills"
              role="group"
              aria-label={t("凭证类型")}
            >
              {[
                ["receipt", "消费小票", FileText],
                ["bank", "银行流水", Landmark],
                ["investment", "投资估值与收益", TrendingUp],
              ].map(([type, label, Icon]) => (
                <button
                  type="button"
                  key={type}
                  aria-pressed={model.doc_type === type}
                  onClick={() =>
                    update({ doc_type: type, plan: null, patches: {} })
                  }
                >
                  <Icon size={15} />
                  {t(label)}
                </button>
              ))}
            </div>
            <label className="evidence-dropzone">
              <Upload size={28} />
              <strong>
                {text(
                  "Drop a receipt, PDF statement or CSV",
                  "拖入小票、PDF账单或CSV",
                )}
              </strong>
              <span>
                {text(
                  "or click to browse · PNG / JPEG / PDF / CSV",
                  "或点击选择文件 · PNG / JPEG / PDF / CSV",
                )}
              </span>
              <input
                type="file"
                aria-label={text("Choose evidence file", "选择凭证文件")}
                accept="image/png,image/jpeg,.csv,.pdf"
                disabled={busy}
                onChange={(e) => {
                  upload(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
            {demo && (
              <button
                type="button"
                className="sample-pill"
                onClick={() =>
                  update({
                    text: DEMO_EVIDENCE[model.doc_type],
                    image: null,
                    pdfText: false,
                    fileName: "",
                    plan: null,
                    patches: {},
                  })
                }
              >
                <Sparkles size={15} />
                {text("Load sample receipt / statement", "载入示例小票 / 流水")}
              </button>
            )}
            <details
              className="raw-evidence-entry"
              open={Boolean(model.text) || undefined}
            >
              <summary>
                {text(
                  "Or paste raw receipt / bank text (⌘V)",
                  "或粘贴小票 / 银行原始文本（⌘V）",
                )}
              </summary>
              <label htmlFor="local-command-input">
                {t(cloud ? "任务文本" : "本地任务文本")}
              </label>
              <textarea
                id="local-command-input"
                value={model.text}
                maxLength={20000}
                rows={4}
                placeholder={text(
                  "Paste the original receipt or statement text, including dates and amounts…",
                  "粘贴包含日期与金额的小票或流水原文…",
                )}
                onChange={(e) => update({ text: e.target.value })}
              />
            </details>
            {model.image && (
              <div className="composer-attachment">
                <img src={model.image} alt={t("待识别原图预览")} />
                <span>
                  <ImageIcon size={15} />
                  {model.fileName}
                </span>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t("移除附件")}
                  onClick={() =>
                    update({
                      image: null,
                      fileName: "",
                      pdfText: false,
                      plan: null,
                    })
                  }
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </>
        )}
        {model.mode !== "evidence" && (
          <>
            <div className="composer-input-heading">
              <label htmlFor="local-command-input">
                {model.mode === "analysis"
                  ? text("Ask a follow-up", "继续追问")
                  : t(cloud ? "任务文本" : "本地任务文本")}
              </label>
              {demo && model.mode === "command" && (
                <button
                  className="sample-pill"
                  type="button"
                  onClick={() =>
                    update({
                      text: `Harbor Coffee 18.50 AUD ${state.demo.date}`,
                    })
                  }
                >
                  <Sparkles size={14} />
                  {text("Load sample prompt", "载入示例指令")}
                </button>
              )}
            </div>
            <textarea
              id="local-command-input"
              value={model.text}
              onChange={(e) => update({ text: e.target.value })}
              maxLength={2000}
              rows={model.mode === "analysis" ? 1 : 2}
              required
              placeholder={
                model.mode === "analysis"
                  ? text(
                      `Ask about your ${period} ${currency} ledger — read-only…`,
                      `询问${period} ${currency}账本，仅作只读分析…`,
                    )
                  : text(
                      'e.g. "Harbor Coffee 18.5 AUD today" or "Find dining expenses"',
                      "例如：“今天咖啡18.5 AUD”或“查找餐饮支出”",
                    )
              }
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (!busy && model.text.trim()) generate();
                }
              }}
            />
            {model.mode === "command" && (
              <LocalDictation
                disabled={busy}
                onText={(value) => update({ text: value })}
              />
            )}
          </>
        )}
        {model.mode !== "analysis" && (
          <div className="composer-context">
            <label>
              <span>{t("批准的账户上下文")}</span>
              <select
                aria-label={t("文字任务账户")}
                value={model.account_id}
                onChange={(e) => {
                  const a = state.accounts.find((a) => a.id === e.target.value);
                  update({
                    account_id: a?.id || "",
                    currency: a?.currency || "",
                  });
                }}
              >
                <option value="">{t("逐条选择，不预设账户")}</option>
                {state.accounts
                  .filter((a) => !a.archived)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        )}
        <button
          type="submit"
          className="primary composer-submit"
          disabled={
            busy ||
            (model.mode === "analysis" && !state.consents.analysis) ||
            (!model.text.trim() && !(model.mode === "evidence" && model.image))
          }
        >
          <Send size={16} />
          {t(
            busy
              ? "正在处理…"
              : model.mode === "evidence"
                ? "提取候选"
                : model.mode === "analysis"
                  ? "分析"
                  : "生成任务预览",
          )}
        </button>
        {model.mode === "command" && (
          <div className="composer-quick-actions">
            <button type="button" className="text-button" onClick={onManual}>
              <FileText size={15} />
              {t("手工记账")}
            </button>
            {!state.accounts.some((a) => !a.archived) && (
              <button
                type="button"
                className="text-button"
                onClick={onAddAccount}
              >
                {t(cloud ? "添加账户" : "添加本地账户")}
              </button>
            )}
          </div>
        )}
      </form>
      {model.mode === "command" &&
        plan &&
        model.budgetQuestion &&
        state.consents.analysis &&
        state.planning.currency === currency && (
          <aside className="advisory-followup">
            <strong>
              {text(
                "Current approved budget · candidate not included",
                "当前已批准预算 · 尚未计入候选",
              )}
            </strong>
            {(state.risk?.budgets || []).map((b) => (
              <p key={b.category}>
                {b.category}: <Money value={b.actual} currency={currency} /> /{" "}
                <Money value={b.amount} currency={currency} />
                <progress
                  max="100"
                  value={Math.min(100, Number(b.used_percent) || 0)}
                />
              </p>
            ))}
          </aside>
        )}
      {analysis && (
        <section className="agent-analysis-reply" aria-live="polite">
          <h3>
            {t("分析结果")} · {analysis.status}
          </h3>
          <p className="terminal-note">
            {t(
              demo
                ? "分析解释是预设演示脚本，不调用AI模型。"
                : "当前是无需LLM的规则与模板基线；无云端传输或训练。",
            )}
          </p>
          <dl>
            {analysis.calculations.slice(0, 6).map((item) => (
              <div key={item.metric_id}>
                <dt>{t(item.label)}</dt>
                <dd>
                  {item.value === null
                    ? t("资料不足")
                    : `${item.value} ${item.unit === "months" ? t("个月") : item.unit}`}
                </dd>
              </div>
            ))}
          </dl>
          <ul>
            {analysis.actions.map((action, index) => (
              <li key={index}>{t(action)}</li>
            ))}
          </ul>
          <button
            type="button"
            className="secondary"
            onClick={() => onNavigate("assistant")}
          >
            {t("查看完整分析")}
          </button>
        </section>
      )}
      {model.pdfText && model.fileName && (
        <p className="terminal-note">
          <FileText size={14} /> {model.fileName} ·{" "}
          {t("PDF文本已在本机提取，请检查后生成候选。")}
        </p>
      )}
      {plan && model.mode === "evidence" && (
        <EvidenceWorkbench
          model={model}
          operations={shown}
          onInspect={openOperation}
        />
      )}
      {model.error && (
        <p className="notice error" role="alert">
          {t(model.error)}
          {!state.consents.ocr && model.mode === "evidence" && (
            <button
              className="text-button"
              onClick={() => onNavigate("privacy")}
            >
              {t("管理授权")}
            </button>
          )}
        </p>
      )}
      {plan && (
        <div className="command-results">
          <div className="command-results-heading">
            <strong>
              {t(
                {
                  READY: "候选已就绪，尚未入账",
                  NEEDS_CLARIFICATION: "补齐字段后继续",
                  DRAFT_CREATED: "草稿已保存，尚未入账",
                  APPLIED: plan.intent === "query" ? "匹配结果" : "操作已完成",
                  PARSED: "已解析候选",
                  CANCELLED: "任务已取消，未提交变更",
                }[plan.status] || "任务预览",
              )}
            </strong>
            <span>{t("{count} 个条目", { count: results.length })}</span>
          </div>
          {plan.query_total > results.length && (
            <p className="notice">
              {t("匹配{total}条，显示前{shown}条；请缩小筛选范围。", {
                total: plan.query_total,
                shown: results.length,
              })}
            </p>
          )}
          {!results.length && (
            <p className="empty compact-empty">
              {t("没有明确匹配。请提供金额、对象或打开对应编辑器。")}
            </p>
          )}
          {plan.query_summary?.length > 0 && (
            <div className="query-summaries">
              {plan.query_summary.map((s) => (
                <p key={s.currency}>
                  {t(
                    "已确认匹配：{count}笔 · 收入{income} · 费用{expenses} · {currency}",
                    s,
                  )}
                </p>
              ))}
              {plan.results.some((r) => r.resource_type === "draft") && (
                <small>{t("草稿单独列示，不计入上述金额。")}</small>
              )}
            </div>
          )}
          <div className="command-result-grid">
            {results
              .filter(() => plan.status !== "CANCELLED")
              .map((op) => (
                <CommandResultCard
                  key={op.op_id}
                  op={op}
                  accounts={state.accounts}
                  locked={locked}
                  onChange={(patch) => {
                    pending(op.op_id, patch);
                    setConfirming(null);
                  }}
                  onEdit={() =>
                    plan.intent === "query"
                      ? onOpenRecord(op)
                      : openOperation(op)
                  }
                  onOpen={
                    locked
                      ? () => {
                          const r =
                            plan.results.find((x) => x.op_id === op.op_id) ||
                            op;
                          onOpenRecord(r, true);
                        }
                      : undefined
                  }
                />
              ))}
          </div>
          {!confirming && !["APPLIED", "CANCELLED"].includes(plan.status) && (
            <div className="command-footer">
              {!locked && changed && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => work(saveFields)}
                >
                  <Save size={15} />
                  {t("保存澄清与选择")}
                </button>
              )}
              {!locked &&
                operations.every((o) => o.kind === "create_draft") && (
                  <button
                    className="secondary"
                    disabled={busy || (!changed && plan.status !== "READY")}
                    onClick={saveDrafts}
                  >
                    {text("Add to Review Queue", "加入审阅队列")}
                  </button>
                )}
              <button
                className="primary"
                disabled={
                  busy ||
                  (!changed &&
                    !["READY", "DRAFT_CREATED"].includes(plan.status))
                }
                onClick={preview}
              >
                <Check size={16} />
                {t("预览并确认选中操作")}
              </button>
            </div>
          )}
          {!["APPLIED", "CANCELLED"].includes(plan.status) && (
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                work(async () => {
                  update({
                    plan: await api(
                      `commands/${plan.command_id}/cancel`,
                      "POST",
                      { version: plan.version },
                    ),
                    patches: {},
                  });
                  setConfirming(null);
                })
              }
            >
              {t("取消此任务")}
            </button>
          )}
          {confirming && (
            <section
              className="command-confirmation"
              aria-label={t(cloud ? "任务确认" : "本地任务确认")}
            >
              <h3>{t("确认这些具体变更")}</h3>
              <p>
                {t(
                  "只提交所选条目。金额与资源版本已固定，变更后需要重新预览。",
                )}
              </p>
              <DuplicateReview
                reviews={confirming.challenge.preview.duplicate_review}
                resolutions={confirming.duplicate_resolutions}
                onChange={(duplicate_resolutions) =>
                  setConfirming({ ...confirming, duplicate_resolutions })
                }
                accounts={Object.fromEntries(
                  state.accounts.map((a) => [a.id, a]),
                )}
              />
              <div className="confirmation-changes">
                {confirming.challenge.preview.operations.map((o) => (
                  <div key={o.op_id}>
                    <strong>
                      {o.fields?.merchant || o.fields?.name || t(o.kind)}
                    </strong>
                    <span>
                      {o.previous?.amount &&
                        `${t("原金额")} ${o.previous.amount} → `}
                      {o.fields?.amount ||
                        o.fields?.market_value ||
                        o.investment_change?.valuation?.market_value}{" "}
                      {o.fields?.currency}
                    </span>
                    <small>
                      {t(
                        o.kind.startsWith("delete")
                          ? "从有效统计中移除，历史保留。"
                          : o.kind.startsWith("update")
                            ? "更正原记录，保留来源与历史。"
                            : cloud
                              ? "确认后才写入私人记录。"
                              : "确认后才写入本地记录。",
                      )}
                    </small>
                  </div>
                ))}
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() => setConfirming(null)}
                >
                  {t("返回核对")}
                </button>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !duplicateReviewComplete(
                      confirming.challenge.preview.duplicate_review,
                      confirming.duplicate_resolutions,
                    )
                  }
                  onClick={apply}
                >
                  {t(cloud ? "确认提交变更" : "确认提交本地变更")}
                </button>
              </div>
            </section>
          )}
        </div>
      )}
      {editing && (
        <EditorDrawer
          title={t("编辑任务候选")}
          onClose={() => setEditing(null)}
        >
          <RecordEditor
            value={editing.fields}
            onChange={(fields) => setEditing((old) => ({ ...old, fields }))}
            accounts={state.accounts}
            transactions={state.transactions}
            source={editing.source_span}
            resourceType={editing.resourceType}
            operationKind={editing.kind}
            onCancel={() => setEditing(null)}
            onSave={() => {
              pending(editing.op_id, {
                fields: Object.fromEntries(
                  Object.entries(editing.fields).filter(
                    ([key, value]) =>
                      JSON.stringify(value) !==
                      JSON.stringify(
                        plan.operations.find((o) => o.op_id === editing.op_id)
                          .fields[key],
                      ),
                  ),
                ),
              });
              setEditing(null);
              setConfirming(null);
            }}
            submitLabel={t("保留候选更正")}
          />
        </EditorDrawer>
      )}
    </section>
  );
}
