"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  Check,
  Download,
  Eye,
  EyeOff,
  FileText,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ModalDialog } from "../record-editor";
import { inspectEncryptedBackup } from "@/lib/terminal/vault.mjs";
import { preparePdfRuntime } from "@/lib/statements/runtime.mjs";
import { useScreenPrivacy, useTerminalText } from "./context";

export async function readLocalDocument(file) {
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Use a file smaller than 5 MB.");
  if (/\.pdf$/i.test(file.name)) {
    const { renderer, worker } = await preparePdfRuntime();
    const task = renderer.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      worker,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    let document;
    try {
      document = await task.promise;
      if (document.numPages > 20)
        throw new Error("Use a PDF with at most 20 pages.");
      let text = "";
      for (let i = 1; i <= document.numPages; i++) {
        const page = await document.getPage(i);
        const content = await page.getTextContent();
        text +=
          content.items
            .map((item) => item.str + (item.hasEOL ? "\n" : " "))
            .join("") + "\n";
        if (text.length > 50000)
          throw new Error("Use at most 50,000 text characters.");
      }
      if (!text.trim())
        throw new Error(
          "This PDF has no selectable text. Use OCR in Transactions for scanned evidence.",
        );
      return text;
    } finally {
      await task.destroy();
    }
  }
  if (!/\.(txt|md)$/i.test(file.name))
    throw new Error("Use a TXT, Markdown or text PDF document.");
  const text = await file.text();
  if (!text.trim() || text.length > 50000)
    throw new Error("Use 1–50,000 text characters.");
  return text;
}

export function TerminalSettings({
  api,
  demo,
  cloud = false,
  authorized,
  onUpdated,
}) {
  const text = useTerminalText(),
    { density, changeDensity, masked } = useScreenPrivacy();
  const [settings, setSettings] = useState(null),
    [form, setForm] = useState(null),
    [message, setMessage] = useState(""),
    [error, setError] = useState(false),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState(""),
    [results, setResults] = useState(null),
    [preview, setPreview] = useState(null),
    [answer, setAnswer] = useState(null),
    [deleting, setDeleting] = useState(null);
  const active = useRef(true),
    requestEpoch = useRef(0),
    titleId = useId(),
    deleteId = useId();
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    api("terminal/settings")
      .then((value) => {
        if (current) {
          setSettings(value);
          setForm({
            model: value.model,
            max_tokens: value.max_tokens,
            temperature: value.temperature,
            top_k: value.top_k,
            threshold: value.threshold,
          });
        }
      })
      .catch((e) => {
        if (current) {
          setError(true);
          setMessage(e.message);
        }
      });
    return () => {
      current = false;
    };
  }, [api]);
  async function run(operation, success) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    const epoch = requestEpoch.current;
    try {
      const result = await operation();
      if (active.current) await onUpdated?.();
      if (active.current && requestEpoch.current === epoch) {
        setError(false);
        if (success) setMessage(success);
        return result;
      }
    } catch (e) {
      if (active.current && requestEpoch.current === epoch) {
        setError(true);
        setMessage(e.message);
      }
    } finally {
      if (active.current && requestEpoch.current === epoch) setBusy(false);
    }
  }
  const setValue = (key, value) => setForm({ ...form, [key]: value });
  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await run(
      async () => {
        const content = await readLocalDocument(file);
        const next = await api("terminal/documents", "POST", {
          name: file.name.slice(0, 100),
          text: content,
        });
        if (active.current) setSettings(next);
      },
      text("Document indexed locally.", "文档已在本机建立索引。"),
    );
  }
  if (!settings || !form)
    return (
      <div className="panel" role="status">
        {message || text("Loading system configuration…", "正在读取系统配置…")}
      </div>
    );
  return (
    <div className="terminal-settings-grid">
      {message && (
        <div
          className={`notice span-two ${error ? "error" : ""}`}
          role="status"
        >
          {message}
        </div>
      )}
      <details className="panel advanced-settings">
        <summary>{text("Advanced model settings", "高级模型设置")}</summary>
        <div className="terminal-section-header">
          <div>
            <span className="terminal-overline">01 / MODEL</span>
            <h2>{text("Model configuration", "模型配置")}</h2>
          </div>
          <span
            className={`terminal-state ${settings.key_configured ? "" : "offline"}`}
          >
            <i />
            {demo
              ? "PRESET"
              : settings.key_configured
                ? text("KEY PRESENT", "已配置密钥")
                : text("NOT CONFIGURED", "尚未配置")}
          </span>
        </div>
        <form
          className="terminal-form"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              async () => {
                const next = await api("terminal/settings", "PUT", form);
                if (active.current) setSettings(next);
              },
              text(
                "Configuration saved. No cloud request was made.",
                "配置已保存，尚未发起云端请求。",
              ),
            );
          }}
        >
          <label>
            {text("Provider", "服务商")}
            <input value="OpenAI · Responses API" readOnly />
          </label>
          <label>
            {text("Model identifier", "模型标识")}
            <input
              required
              maxLength={80}
              pattern="[a-zA-Z0-9._-]+"
              value={form.model}
              onChange={(e) => setValue("model", e.target.value)}
            />
          </label>
          <div className="form-grid two">
            <label>
              {text("Maximum output tokens", "最大输出令牌数")}
              <input
                required
                type="number"
                min="100"
                max="4000"
                value={form.max_tokens}
                onChange={(e) => setValue("max_tokens", Number(e.target.value))}
              />
            </label>
            <label>
              {text("Temperature · GPT-4 families", "温度 · GPT-4 系列")}
              <input
                required
                type="number"
                min="0"
                max="2"
                step=".1"
                value={form.temperature}
                onChange={(e) =>
                  setValue("temperature", Number(e.target.value))
                }
              />
            </label>
          </div>
          <div className="terminal-muted-box">
            <KeyRound size={15} />{" "}
            {text(
              cloud
                ? "Model providers are managed by the platform. Cloud AI is disabled until provider authorization and task budgets are configured."
                : "Keys stay in the server environment. Set OPENAI_API_KEY in .env.local and restart. The app never displays or stores the key in browser storage.",
              cloud
                ? "模型供应商由平台管理；完成供应商授权与任务预算配置前，云端AI保持关闭。"
                : "密钥仅由服务端环境变量读取。在 .env.local 设置 OPENAI_API_KEY 后重启。应用不会显示密钥或将其保存至浏览器。",
            )}
          </div>
          <button className="primary" disabled={busy}>
            {text("Save configuration", "保存配置")}
          </button>
        </form>
      </details>
      <section className="panel span-two workspace-preferences">
        <div className="terminal-section-header">
          <div>
            <span className="terminal-overline">02 / EXPERIENCE</span>
            <h2>{text("Workspace preferences", "工作台偏好")}</h2>
          </div>
          <ShieldCheck size={20} />
        </div>
        <div className="terminal-form">
          <label>
            {text("Content density", "内容密度")}
            <select
              value={density}
              onChange={(e) => changeDensity(e.target.value)}
            >
              <option value="comfortable">{text("Comfortable", "舒适")}</option>
              <option value="compact">{text("Compact", "紧凑")}</option>
            </select>
          </label>
          <p>
            {text(
              "Language and visual preferences use non-financial cookies on this device. Financial data is never included in these preferences.",
              "语言与视觉偏好仅使用本机的非财务 Cookie，不包含财务资料。",
            )}
          </p>
          <div className="terminal-health-grid">
            {[
              [
                text("Ledger service", "账本服务"),
                demo
                  ? text("Browser sandbox", "浏览器沙箱")
                  : text("Authenticated local API", "已认证本机API"),
              ],
              [
                text("Cloud requests", "云端请求"),
                text("Manual confirmation only", "仅手动确认后调用"),
              ],
              [
                text("Bank / trading API", "银行 / 交易接口"),
                text("Not connected", "未连接"),
              ],
              [
                text("Local retrieval", "本地检索"),
                cloud
                  ? text(
                      "Private workspace document search",
                      "私人空间资料搜索",
                    )
                  : text("On-device document search", "本机资料搜索"),
              ],
            ].map(([label, value]) => (
              <article className="terminal-health-card" key={label}>
                <Check size={16} />
                <h3>{label}</h3>
                <p>{value}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="panel span-two">
        <div className="terminal-section-header">
          <div>
            <span className="terminal-overline">03 / LOCAL KNOWLEDGE</span>
            <h2>{text("Your evidence library", "你的证据资料库")}</h2>
            <p>
              {text(
                cloud
                  ? "Search documents in your private workspace. External model requests remain disabled."
                  : "Search documents on this device. Cloud requests require a separate review.",
                cloud
                  ? "搜索私人空间内的资料。外部模型请求保持关闭。"
                  : "搜索本机资料。发送云端请求需要单独核对确认。",
              )}
            </p>
          </div>
          <span className="chip">{settings.documents.length} / 20</span>
        </div>
        <div className="terminal-split">
          <div className="terminal-form">
            <label className="attachment-button">
              <Upload size={16} />
              {text(
                "Import TXT, Markdown or text PDF",
                "导入TXT、Markdown或文本PDF",
              )}
              <input
                type="file"
                accept=".txt,.md,.pdf"
                disabled={
                  busy ||
                  !authorized ||
                  settings.documents.length >= 20 ||
                  masked
                }
                onChange={upload}
              />
            </label>
            <p>
              {text(
                "20 documents maximum · 50,000 characters each · 1,000-character chunks with 150-character overlap. Documents are stored with the local data and included in export/delete.",
                "最多20份文档，每份50,000字符。分块1000字符、重叠150字符。文档随本地数据保存，并纳入导出和删除范围。",
              )}
            </p>
            {masked ? (
              <p>{text("Document details hidden.", "文档详情已隐藏。")}</p>
            ) : (
              <div className="knowledge-documents">
                {settings.documents.map((doc) => (
                  <article key={doc.id}>
                    <FileText size={17} />
                    <div>
                      <b>{doc.name}</b>
                      <small>
                        {doc.text.length.toLocaleString()}{" "}
                        {text("characters", "字符")}
                      </small>
                    </div>
                    <button
                      className="terminal-icon"
                      disabled={busy}
                      aria-label={`${text("Delete document", "删除文档")} ${doc.name}`}
                      onClick={() => setDeleting(doc)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </article>
                ))}
              </div>
            )}
            <details className="advanced-retrieval">
              <summary>
                {text("Advanced retrieval settings", "高级检索设置")}
              </summary>{" "}
              <div className="form-grid two">
                <label>
                  Top K
                  <input
                    required
                    type="number"
                    min="1"
                    max="10"
                    value={form.top_k}
                    onChange={(e) => setValue("top_k", Number(e.target.value))}
                  />
                </label>
                <label>
                  {text("Similarity threshold", "相似度阈值")}
                  <input
                    required
                    type="number"
                    min="0"
                    max="1"
                    step=".05"
                    value={form.threshold}
                    onChange={(e) =>
                      setValue("threshold", Number(e.target.value))
                    }
                  />
                </label>
              </div>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    async () => {
                      const next = await api("terminal/settings", "PUT", form);
                      if (active.current) setSettings(next);
                    },
                    text("Retrieval settings saved.", "检索配置已保存。"),
                  )
                }
              >
                {text("Save retrieval settings", "保存检索配置")}
              </button>
            </details>{" "}
          </div>
          <div className="terminal-form">
            <label>
              {text("Try a question", "试着提出问题")}
              <textarea
                rows={4}
                maxLength={2000}
                value={masked ? "" : query}
                disabled={masked}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setAnswer(null);
                  setResults(null);
                }}
                placeholder={text(
                  "What do my planning notes say about emergency reserves?",
                  "规划说明中如何考虑应急储备？",
                )}
              />
            </label>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || !authorized || masked || !query.trim()}
                onClick={() =>
                  run(async () => {
                    const result = await api("terminal/search", "POST", {
                      query,
                    });
                    if (active.current) setResults(result);
                  })
                }
              >
                {text("Search locally", "本地检索")}
              </button>
              <button
                className="secondary"
                disabled={
                  busy ||
                  !authorized ||
                  masked ||
                  !query.trim() ||
                  (!demo && !settings.key_configured)
                }
                onClick={() =>
                  run(async () => {
                    const result = await api("terminal/model-preview", "POST", {
                      query,
                    });
                    if (active.current) setPreview(result);
                  })
                }
              >
                {demo
                  ? text("Preview demo explanation", "预览演示解释")
                  : text("Review cloud payload", "检查云端请求内容")}
              </button>
            </div>
            {!masked && results && (
              <div className="knowledge-results" role="status">
                {results.results.length ? (
                  results.results.map((r, i) => (
                    <article key={`${r.id}-${r.offset}`}>
                      <header>
                        <b>
                          [{i + 1}] {r.name}
                        </b>
                        <span>{(r.score * 100).toFixed(1)}%</span>
                      </header>
                      <p>{r.text}</p>
                      <small>
                        {text("Character offset", "字符位置")} {r.offset} ·{" "}
                        {text("local source", "本地来源")}
                      </small>
                    </article>
                  ))
                ) : (
                  <p>
                    {text(
                      "No source meets the similarity threshold. Try different keywords.",
                      "没有达到相似度阈值的资料，请尝试其他关键词。",
                    )}
                  </p>
                )}
              </div>
            )}
            {!masked && answer && (
              <article className="terminal-insight" role="status">
                <h3>{answer.source}</h3>
                <p style={{ whiteSpace: "pre-wrap" }}>{answer.text}</p>
              </article>
            )}
          </div>
        </div>
      </section>
      {preview && !masked && (
        <ModalDialog titleId={titleId} onClose={() => setPreview(null)}>
          <div className="terminal-form">
            <div className="terminal-section-header">
              <h2 id={titleId}>
                {demo
                  ? text("Review offline demo payload", "检查离线演示内容")
                  : text("Review before sending", "发送前检查")}
              </h2>
              <button
                className="terminal-icon"
                aria-label={text("Close", "关闭")}
                onClick={() => setPreview(null)}
              >
                <X size={17} />
              </button>
            </div>
            <b>{preview.destination}</b>
            {error && message && (
              <p className="terminal-error" role="alert">
                {message}
              </p>
            )}
            <p>
              {demo
                ? text(
                    "No network call is made. The result is a hand-written preset.",
                    "不会发起联网请求，结果为手动预设。",
                  )
                : text(
                    "Only the question and excerpts below leave this device. The ledger is not attached. Provider retention rules apply; store:false is not zero retention.",
                    "仅下面的问题与片段会离开本机，不附带账本。服务商的保留政策仍然适用；store:false 不等于零保留。",
                  )}
            </p>
            <pre className="payload-preview">
              {JSON.stringify(preview.payload, null, 2)}
            </pre>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const result = await api(
                    "terminal/model-explanation",
                    "POST",
                    { nonce: preview.nonce, confirmed: true },
                  );
                  if (active.current) {
                    setAnswer(result);
                    setPreview(null);
                  }
                })
              }
            >
              {demo
                ? text("Show preset explanation", "查看预设解释")
                : text("Send this exact payload", "确认发送上述内容")}
            </button>
          </div>
        </ModalDialog>
      )}
      {deleting && !masked && (
        <ModalDialog titleId={deleteId} onClose={() => setDeleting(null)}>
          <div className="terminal-form">
            <h2 id={deleteId}>
              {text("Delete this local document?", "删除这份本地文档？")}
            </h2>
            <p>{deleting.name}</p>
            {error && message && (
              <p className="terminal-error" role="alert">
                {message}
              </p>
            )}
            <p>
              {text(
                "The text and its search chunks will be removed from this app. Existing backups are unaffected.",
                "将移除应用中的文本及其检索分块，已有备份不受影响。",
              )}
            </p>
            <div className="button-row">
              <button className="secondary" onClick={() => setDeleting(null)}>
                {text("Cancel", "取消")}
              </button>
              <button
                className="danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const next = await api("terminal/documents", "DELETE", {
                      id: deleting.id,
                    });
                    if (active.current) {
                      setSettings(next);
                      setDeleting(null);
                      setResults(null);
                    }
                  })
                }
              >
                {text("Delete document", "删除文档")}
              </button>
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}

export function SecurityVault({
  api,
  demo,
  cloud = false,
  reauth,
  onReauth,
  onEncryptedExport,
  revision,
}) {
  const text = useTerminalText(),
    { masked, toggleMask } = useScreenPrivacy();
  const [audit, setAudit] = useState(null),
    [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [verifyFile, setVerifyFile] = useState(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    let current = true;
    api("terminal/audit")
      .then((value) => {
        if (current) setAudit(value);
      })
      .catch((e) => {
        if (current) setMessage(e.message);
      });
    return () => {
      current = false;
    };
  }, [api, revision]);
  const permissions = [
    [
      text("Read ledger & valuations", "读取账本与估值"),
      true,
      cloud
        ? text(
            "Verified cloud identity and private workspace",
            "已验证云端身份与私人空间",
          )
        : text("Authenticated local session", "已认证本机会话"),
    ],
    [
      cloud
        ? text("Private workspace analysis & retrieval", "私人空间分析与检索")
        : text("Local analysis & retrieval", "本地分析与检索"),
      true,
      text("Requires analysis consent", "需要分析用途授权"),
    ],
    [
      text("Import / change ledger", "导入 / 修改账本"),
      true,
      text("Preview + explicit confirmation", "预览 + 明确确认"),
    ],
    [
      text("Cloud explanation", "云端解释"),
      !cloud,
      text("Server key + per-request review", "服务端密钥 + 逐次检查"),
    ],
    [
      text("Execute trades / payments", "执行交易 / 支付"),
      false,
      text("No connector or execution capability", "未提供连接器或执行能力"),
    ],
  ];
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      if (verifyFile) {
        if (verifyFile.size > 50 * 1024 * 1024)
          throw new Error("Backup exceeds 50 MB.");
        const contents = await inspectEncryptedBackup(
          JSON.parse(await verifyFile.text()),
          password,
        );
        if (active.current)
          setMessage(
            text(
              "Backup authenticated and decrypted in memory. No ledger data was imported.",
              "备份已通过认证并在内存中解密，未导入账本数据。",
            ) + ` (${contents.schema_version || "v1"})`,
          );
      } else await onEncryptedExport(password);
    } catch {
      if (active.current)
        setMessage(
          text(
            "Could not complete the action. Check the password, file and access code.",
            "未能完成操作，请检查密码、文件和访问码。",
          ),
        );
    } finally {
      if (active.current) {
        setBusy(false);
        setPassword("");
      }
    }
  }
  return (
    <>
      <section className="panel vault-banner">
        <LockKeyhole size={38} />
        <div>
          <span className="terminal-overline">SECURITY / PRIVATE DATA</span>
          <h2>
            {text("Your data, your boundaries", "你的数据，由你设定边界")}
          </h2>
          <p>
            {text(
              cloud
                ? "Encrypted downloads are created in your browser. Cloud records use private server-side storage; infrastructure encryption and recovery require deployment validation. This is not end-to-end encryption."
                : "Encrypted downloads use AES-256-GCM. The working database is plaintext; use device disk encryption and a private OS account. This app does not claim zero-knowledge storage.",
              cloud
                ? "下载备份在浏览器中加密。云端记录使用私有服务端存储；基础设施加密与恢复需部署验收。这不是端到端加密。"
                : "下载备份使用 AES-256-GCM 加密。运行数据库为明文，请开启设备磁盘加密并使用独立系统账户。应用不宣称零知识存储。",
            )}
          </p>
        </div>
      </section>
      <div className="terminal-settings-grid">
        <section className="panel vault-mask">
          <header>
            <div>
              <span className="terminal-overline">VISUAL PRIVACY</span>
              <h2>{text("Screen privacy", "屏幕隐私")}</h2>
            </div>
            {masked ? <EyeOff size={24} /> : <Eye size={24} />}
          </header>
          <p>
            {text(
              "Hide financial views while presenting or sharing your screen. This is visual privacy, not encryption or session locking.",
              "演示或共享屏幕时隐藏财务视图。这是视觉隐私保护，不等于加密或锁定会话。",
            )}
          </p>
          <button
            className="secondary"
            aria-pressed={masked}
            onClick={toggleMask}
          >
            {masked
              ? text("Reveal financial content", "显示财务内容")
              : text("Hide financial content", "隐藏财务内容")}
          </button>
        </section>
        <section className="panel">
          <div className="terminal-section-header">
            <h2>{text("Encrypted backup", "加密备份")}</h2>
            <KeyRound size={20} />
          </div>
          <form className="terminal-form" onSubmit={submit}>
            <p>
              {text(
                "AES-256-GCM · PBKDF2-SHA256 · 600,000 iterations. Your password stays in memory and is never sent to the server. A lost password cannot be recovered.",
                "AES-256-GCM · PBKDF2-SHA256 · 600,000次迭代。密码仅保留在内存，不会发送到服务器；遗失后无法恢复。",
              )}
            </p>
            {!demo && (
              <label>
                {text("Current local access code", "当前本机访问码")}
                <input
                  type="password"
                  autoComplete="off"
                  value={reauth}
                  onChange={(e) => onReauth(e.target.value)}
                />
              </label>
            )}
            <label>
              {text(
                "Backup password (12–200 characters)",
                "备份密码（12至200字符）",
              )}
              <input
                required
                minLength={12}
                maxLength={200}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <label>
              {text(
                "Optional: verify an encrypted backup",
                "可选：验证已有加密备份",
              )}
              <input
                type="file"
                accept=".json"
                onChange={(e) => setVerifyFile(e.target.files?.[0] || null)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || masked || (!verifyFile && !demo && !reauth)}
            >
              {verifyFile ? <Check size={16} /> : <Download size={16} />}{" "}
              {verifyFile
                ? text("Verify password & file", "验证密码与文件")
                : text("Review encrypted export", "预览加密导出")}
            </button>
            {verifyFile && (
              <button
                type="button"
                className="text-button"
                onClick={() => setVerifyFile(null)}
              >
                {text("Switch to backup export", "切换为导出备份")}
              </button>
            )}
            {message && <p role="status">{message}</p>}
          </form>
        </section>
        <section className="panel">
          <div className="terminal-section-header">
            <h2>{text("Agent capability boundaries", "代理能力边界")}</h2>
            <ShieldCheck size={19} />
          </div>
          <div className="terminal-table-shell">
            <table>
              <thead>
                <tr>
                  <th>{text("Capability", "能力")}</th>
                  <th>{text("Available", "可用")}</th>
                  <th>{text("Control", "控制方式")}</th>
                </tr>
              </thead>
              <tbody>
                {permissions.map(([label, allow, control]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className={allow ? "allow" : "deny"}>
                      {allow
                        ? text("Scoped", "受限可用")
                        : text("Denied", "禁用")}
                    </td>
                    <td>{control}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="panel">
          <div className="terminal-section-header">
            <h2>{text("Audit trail", "审计记录")}</h2>
            <span className="chip">
              {audit?.verified
                ? text("Chain verified", "链校验通过")
                : demo
                  ? text("Demo browser log", "演示浏览器日志")
                  : audit
                    ? text("Verification failed", "校验失败")
                    : text("Loading", "读取中")}
            </span>
          </div>
          <p>
            {text(
              "Hash chaining detects changes within the current log. It is not external attestation and cannot prove a fully rewritten database is authentic.",
              "哈希链用于检测当前日志中的变更，不是外部认证，无法证明整份重写数据库的真实性。",
            )}
          </p>
          {audit && !audit.verified && !demo && (
            <p className="terminal-error" role="alert">
              {text(
                "The current audit chain did not verify. Review the local database and your trusted backups before relying on this history.",
                "当前审计链未通过校验。请核查本地数据库和可信备份后再依赖这份历史。",
              )}
            </p>
          )}
          <div className="terminal-audit">
            {masked ? (
              <p>{text("Event details hidden.", "事件详情已隐藏。")}</p>
            ) : (
              audit?.events?.map((e) => (
                <article key={e.id}>
                  <h3>{e.action}</h3>
                  <time>{e.at}</time>
                  <p>{e.resource_id}</p>
                  {e.hash && <code>SHA256 {e.hash.slice(0, 24)}…</code>}
                </article>
              ))
            )}
            {!masked && !audit?.events?.length && (
              <p>{text("No recorded events yet.", "暂无已记录的事件。")}</p>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
