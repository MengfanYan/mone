"use client";
import { useState } from "react";
import { useLocale, LanguageSwitch } from "./locale-provider";
export default function CloudRecovery() {
  const { locale, t } = useLocale(),
    text = (en, zh) => (locale === "zh" ? zh : en);
  const [password, setPassword] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="cloud-recovery-page">
      <section className="login-card">
        <LanguageSwitch />
        <h1>{text("Reset your password", "重置密码")}</h1>
        <p>
          {text(
            "Use a unique password of at least 12 characters. This recovery link is valid for five minutes after verification.",
            "请使用至少12个字符的独立密码。此恢复链接通过验证后五分钟内有效。",
          )}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage("");
            try {
              const r = await fetch("/api/auth/reset", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ password }),
                cache: "no-store",
              });
              const result = await r.json();
              if (!r.ok)
                throw new Error(result.error?.message || "Recovery failed");
              setPassword("");
              setMessage(
                "Password updated. Sign in again to open your workspace.",
              );
            } catch (error) {
              setMessage(error.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {text("New password", "新密码")}
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={200}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="primary wide" disabled={busy}>
            {text("Save new password", "保存新密码")}
          </button>
        </form>
        {message && <p role="status">{t(message)}</p>}
        <a href="/">{text("Return to sign in", "返回登录")}</a>
      </section>
    </main>
  );
}
