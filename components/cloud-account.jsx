"use client";
import { useEffect, useId, useState } from "react";
import { useLocale } from "./locale-provider";
import { ModalDialog } from "./record-editor";

export default function CloudAccount({ api, onUpdated }) {
  const { locale } = useLocale(),
    text = (en, zh) => (locale === "zh" ? zh : en);
  const [account, setAccount] = useState(null),
    [message, setMessage] = useState(null),
    [busy, setBusy] = useState(false),
    [rule, setRule] = useState({
      merchant: "",
      category: "",
      currency: "AUD",
      confirmed: false,
    }),
    [feedback, setFeedback] = useState({ kind: "classification", comment: "" }),
    [migration, setMigration] = useState(null),
    [archive, setArchive] = useState(null),
    [password, setPassword] = useState(""),
    [owned, setOwned] = useState(false),
    [documents, setDocuments] = useState([]),
    [remove, setRemove] = useState(null),
    [factors, setFactors] = useState(null),
    [enrolling, setEnrolling] = useState(null),
    [mfaCode, setMfaCode] = useState("");
  const titleId = useId();
  async function reload() {
    const [next, files] = await Promise.all([api("account"), api("documents")]);
    setAccount(next);
    setDocuments(files);
  }
  useEffect(() => {
    let active = true;
    Promise.all([api("account"), api("documents")])
      .then(([a, d]) => {
        if (active) {
          setAccount(a);
          setDocuments(d);
        }
      })
      .catch((e) => {
        if (active) setMessage({ error: true, text: e.message });
      });
    return () => {
      active = false;
    };
  }, [api]);
  async function work(fn) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setMessage({ error: true, text: e.message });
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  return (
    <div className="cloud-account-grid">
      <section className="panel">
        <h2>{text("Account & subscription", "账号与订阅")}</h2>
        <p>
          {text(
            "Your private workspace is separate from the public Demo. Billing is off; prices and quotas have not been approved.",
            "你的私人空间与公开演示分开。收费关闭；价格和额度尚未确定。",
          )}
        </p>
        <p className="chip">
          {text(
            "Free development access · no payment collected",
            "免费开发验证 · 不收取费用",
          )}
        </p>
        <button className="secondary" disabled>
          {text("Paid plans are not available", "付费套餐暂未开放")}
        </button>
        <h3>{text("Device sessions", "设备会话")}</h3>
        {account?.sessions.map((s) => (
          <div className="cloud-device-row" key={s.id}>
            <div>
              <strong>
                {s.current
                  ? text("This device", "当前设备")
                  : text("Another session", "其他会话")}
              </strong>
              <small>
                {s.created_at} ·{" "}
                {s.revoked
                  ? text("Revoked", "已撤销")
                  : text("Active until expiry", "有效期内")}
              </small>
            </div>
            <button
              className="secondary"
              disabled={busy || s.revoked}
              onClick={() =>
                work(async () => {
                  await api("account/sessions/revoke", "POST", {
                    session_id: s.id,
                  });
                  if (s.current) window.location.assign("/");
                  else await reload();
                })
              }
            >
              {text("Sign out device", "退出该设备")}
            </button>
          </div>
        ))}
        <details className="cloud-account-details">
          <summary>
            {text("Authenticator protection", "身份验证器保护")}
          </summary>
          <p>
            {text(
              "Use an authenticator app for an additional sign-in factor. Never share its secret or one-time codes.",
              "使用身份验证器增加登录保护。不要分享密钥或一次性验证码。",
            )}
          </p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              work(async () =>
                setFactors(await api("auth/mfa/list", "POST", {})),
              )
            }
          >
            {text("Check authenticators", "查看身份验证器")}
          </button>
          {factors?.factors.map((f) => (
            <div className="cloud-device-row" key={f.id}>
              <span>
                {f.name} · {f.status}
              </span>
              <button
                className="secondary"
                onClick={() => {
                  setEnrolling({ id: f.id, existing: true });
                  setMfaCode("");
                }}
              >
                {text("Verify this device", "验证当前设备")}
              </button>
            </div>
          ))}
          {!enrolling && (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                work(async () =>
                  setEnrolling(await api("auth/mfa/enroll", "POST", {})),
                )
              }
            >
              {text("Set up authenticator", "设置身份验证器")}
            </button>
          )}
          {enrolling && (
            <form
              className="cloud-form"
              onSubmit={(e) => {
                e.preventDefault();
                work(async () => {
                  await api("auth/mfa/verify", "POST", {
                    factor_id: enrolling.id,
                    code: mfaCode,
                  });
                  setEnrolling(null);
                  setMfaCode("");
                  setMessage({
                    text: text(
                      "Authenticator verified for this device.",
                      "当前设备已通过身份验证器验证。",
                    ),
                  });
                });
              }}
            >
              {enrolling.secret && (
                <label>
                  {text(
                    "Add this secret to your authenticator",
                    "将此密钥加入身份验证器",
                  )}
                  <input readOnly value={enrolling.secret} autoComplete="off" />
                </label>
              )}
              <label>
                {text("Six-digit authenticator code", "六位身份验证码")}
                <input
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  required
                />
              </label>
              <button className="primary" disabled={busy}>
                {text("Verify authenticator", "验证身份验证器")}
              </button>
            </form>
          )}
        </details>
      </section>
      <section className="panel">
        <h2>{text("Personal classification rules", "个人分类规则")}</h2>
        <p>
          {text(
            "Rules apply only to future uncategorized drafts in your workspace. Existing records and reviewed Agent operations stay unchanged. This is not model training.",
            "规则仅用于本人空间中新产生的未分类草稿，不修改已有记录和已审核的 Agent 操作。这不是模型训练。",
          )}
        </p>
        <form
          className="cloud-form"
          onSubmit={(e) => {
            e.preventDefault();
            work(async () => {
              await api("personal-rules", "POST", rule);
              setRule({
                merchant: "",
                category: "",
                currency: "AUD",
                confirmed: false,
              });
              await reload();
              await onUpdated();
            });
          }}
        >
          <label>
            {text("Exact merchant name", "精确商户名称")}
            <input
              required
              maxLength={120}
              value={rule.merchant}
              onChange={(e) => setRule({ ...rule, merchant: e.target.value })}
            />
          </label>
          <label>
            {text("Suggested category", "建议类别")}
            <input
              required
              maxLength={40}
              value={rule.category}
              onChange={(e) => setRule({ ...rule, category: e.target.value })}
            />
          </label>
          <label>
            {text("Rule currency", "规则币种")}
            <select
              value={rule.currency}
              onChange={(e) => setRule({ ...rule, currency: e.target.value })}
            >
              {[
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
              ].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="inline-choice">
            <input
              type="checkbox"
              checked={rule.confirmed}
              onChange={(e) =>
                setRule({ ...rule, confirmed: e.target.checked })
              }
            />
            {text("Save for my future drafts only", "仅保存用于本人未来草稿")}
          </label>
          <button className="primary" disabled={busy || !rule.confirmed}>
            {text("Save personal rule", "保存个人规则")}
          </button>
        </form>
        {account?.rules
          .filter((r) => r.active)
          .map((r) => (
            <div className="cloud-device-row" key={r.id}>
              <span>
                {r.merchant} → {r.category} · {r.currency}
              </span>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  work(async () => {
                    await api(`personal-rules/${r.id}`, "DELETE", {
                      version: r.version,
                    });
                    await reload();
                  })
                }
              >
                {text("Revoke rule", "撤销规则")}
              </button>
            </div>
          ))}
      </section>
      <section className="panel">
        <h2>{text("Report an error", "提交错误反馈")}</h2>
        <p>
          {text(
            "Feedback stays in your workspace and is excluded from global training. Correct financial records through their review workflow.",
            "反馈保存在本人空间，不进入全局训练。财务记录请通过审核更正流程修改。",
          )}
        </p>
        <form
          className="cloud-form"
          onSubmit={(e) => {
            e.preventDefault();
            work(async () => {
              await api("feedback", "POST", feedback);
              setFeedback({ ...feedback, comment: "" });
              setMessage({
                text: text("Feedback recorded privately.", "反馈已私密保存。"),
              });
            });
          }}
        >
          <label>
            {text("Error type", "错误类型")}
            <select
              value={feedback.kind}
              onChange={(e) =>
                setFeedback({ ...feedback, kind: e.target.value })
              }
            >
              {[
                ["recognition", "Recognition", "识别"],
                ["classification", "Classification", "分类"],
                ["explanation", "Explanation", "解释"],
                ["other", "Other", "其他"],
              ].map(([key, en, zh]) => (
                <option key={key} value={key}>
                  {text(en, zh)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text("Describe the error", "描述错误")}
            <textarea
              value={feedback.comment}
              onChange={(e) =>
                setFeedback({ ...feedback, comment: e.target.value })
              }
              maxLength={1000}
              required
            />
          </label>
          <button className="primary" disabled={busy}>
            {text("Save feedback", "保存反馈")}
          </button>
        </form>
      </section>
      <details className="panel cloud-account-details">
        <summary>
          {text(
            "Private files & local archive import",
            "私有文件与本地账本导入",
          )}
        </summary>
        <h3>{text("Private file intake", "私有文件接收")}</h3>
        <p>
          {text(
            "Uploads are quarantined. OCR and file analysis remain unavailable until an isolated worker is configured; no extraction result is invented.",
            "上传文件先进入隔离区。配置隔离处理器前，OCR 与文件分析不可用；不会生成预设识别结果。",
          )}
        </p>
        <input
          type="file"
          aria-label={text("Upload a private file", "上传私有文件")}
          accept="image/png,image/jpeg,application/pdf,text/plain"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files[0];
            e.target.value = "";
            if (!file) return;
            work(async () => {
              if (file.size > 5 * 1024 * 1024)
                throw new Error(text("File exceeds 5 MB", "文件超过5MB"));
              const base64 = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve(String(reader.result).split(",")[1]);
                reader.onerror = reject;
                reader.readAsDataURL(file);
              });
              await api("documents", "POST", {
                base64,
                mime_type: file.type,
                purpose: "receipt",
              });
              await reload();
            });
          }}
        />
        {documents.map((d) => (
          <div className="cloud-device-row" key={d.id}>
            <span>
              {d.mime_type} · {d.size_bytes} {text("bytes", "字节")} ·{" "}
              {{
                quarantined: text("Quarantined", "隔离待核查"),
                clean: text("Validated", "已核查"),
                deleted: text("Deleted", "已删除"),
                rejected: text("Rejected", "已拒绝"),
              }[d.status] || d.status}
            </span>
            {d.status === "clean" && (
              <a href={`/api/documents/${d.id}/download`}>
                {text("Download", "下载")}
              </a>
            )}
            {d.status !== "deleted" && (
              <button className="danger-text" onClick={() => setRemove(d.id)}>
                {text("Remove file", "移除文件")}
              </button>
            )}
          </div>
        ))}
        <h3>{text("Import your local JSON archive", "导入本地 JSON 归档")}</h3>
        <p>
          {text(
            "Use a new, empty cloud workspace. Financial event IDs are preserved; local sessions, confirmation tokens and processing permissions are reset. No identity is inferred from the file.",
            "使用新的空云端空间。保留财务事件ID；重置本地会话、确认令牌和处理授权。系统不根据文件推断身份。",
          )}
        </p>
        <input
          type="file"
          accept="application/json,.json"
          aria-label={text("Local export archive", "本地导出归档")}
          onChange={(e) => {
            const file = e.target.files[0];
            setMigration(null);
            setArchive(null);
            setOwned(false);
            if (file)
              work(async () => {
                if (file.size > 6 * 1024 * 1024)
                  throw new Error("Archive exceeds 6 MB");
                setArchive(JSON.parse(await file.text()));
              });
          }}
        />
        <button
          className="secondary"
          disabled={busy || !archive}
          onClick={() =>
            work(async () =>
              setMigration(await api("migration/preview", "POST", { archive })),
            )
          }
        >
          {text("Review archive import", "核对归档导入")}
        </button>
        {migration && (
          <div className="cloud-form">
            <p>
              {text("Accounts", "账户")}: {migration.manifest.counts.accounts} ·{" "}
              {text("Events", "事件")}: {migration.manifest.counts.events}
            </p>
            <p>
              {text(
                "Processing consents will be off. Preview expires in two minutes.",
                "处理授权将重置为关闭。预览两分钟后失效。",
              )}
            </p>
            <label className="inline-choice">
              <input
                type="checkbox"
                checked={owned}
                onChange={(e) => setOwned(e.target.checked)}
              />
              {text(
                "This is my archive; I reviewed the import scope",
                "这是本人的归档，且已核对导入范围",
              )}
            </label>
            <label>
              {text("Re-enter account password", "再次输入账号密码")}
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={busy || !owned || !password}
              onClick={() =>
                work(async () => {
                  await api("migration/commit", "POST", {
                    nonce: migration.nonce,
                    content_hash: migration.content_hash,
                    access_code: password,
                  });
                  setArchive(null);
                  setMigration(null);
                  await reload();
                  await onUpdated();
                  setMessage({
                    text: text(
                      "Archive imported and reconciled. Review processing permissions before using analysis.",
                      "归档已导入并完成对账。使用分析前请重新核对处理授权。",
                    ),
                  });
                })
              }
            >
              {text("Confirm import into my workspace", "确认导入本人空间")}
            </button>
          </div>
        )}
      </details>
      {message && (
        <p
          className={`notice ${message.error ? "error" : ""}`}
          role={message.error ? "alert" : "status"}
        >
          {message.text}
        </p>
      )}
      {remove && (
        <ModalDialog titleId={titleId} onClose={() => setRemove(null)}>
          <h2 id={titleId}>
            {text("Remove this private file?", "移除此私有文件？")}
          </h2>
          <p>
            {text(
              "The original file will be removed. Existing ledger records and extracted text are separate; use data deletion to clear all application records.",
              "原始文件将被移除。已有账本记录与提取文字相互独立；全部清理请使用数据删除功能。",
            )}
          </p>
          <div className="button-row">
            <button className="secondary" onClick={() => setRemove(null)}>
              {text("Cancel", "取消")}
            </button>
            <button
              className="danger"
              disabled={busy}
              onClick={() =>
                work(async () => {
                  await api(`documents/${remove}`, "DELETE", {
                    confirmed: true,
                  });
                  setRemove(null);
                  await reload();
                })
              }
            >
              {text("Confirm file removal", "确认移除文件")}
            </button>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}
