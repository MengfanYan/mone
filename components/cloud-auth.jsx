"use client";
import { useState } from "react";
import { useLocale } from "./locale-provider";

export default function CloudAuth({ api, onSignedIn, pending = false }) {
  const { locale, t } = useLocale(),
    text = (en, zh) => (locale === "zh" ? zh : en);
  const [mode, setMode] = useState("login"),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(null),
    [factors, setFactors] = useState([]),
    [factor, setFactor] = useState(""),
    [code, setCode] = useState("");
  return (
    <div className="cloud-auth">
      <p>
        {text(
          "Sign in to your private cloud workspace. The public Demo uses separate synthetic data.",
          "登录你的独立云端工作空间。公开演示使用独立的合成数据。",
        )}
      </p>
      {factors.length > 0 ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage(null);
            try {
              await api("auth/mfa/verify", "POST", { factor_id: factor, code });
              setCode("");
              await onSignedIn();
            } catch (error) {
              setMessage({ error: true, text: error.message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {text("Authenticator", "身份验证器")}
            <select value={factor} onChange={(e) => setFactor(e.target.value)}>
              {factors.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {text("Six-digit authenticator code", "六位身份验证码")}
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              pattern="[0-9]{6}"
              maxLength={6}
              inputMode="numeric"
              autoComplete="one-time-code"
              required
            />
          </label>
          <button className="primary wide" disabled={busy}>
            {text("Verify and sign in", "验证并登录")}
          </button>
        </form>
      ) : (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage(null);
            try {
              const result = await api(
                mode === "login"
                  ? "session"
                  : mode === "signup"
                    ? "auth/sign-up"
                    : "auth/recover",
                "POST",
                { email, ...(mode !== "recover" && { password }) },
              );
              setPassword("");
              if (mode === "login" && result.needs_mfa) {
                setFactors(result.factors);
                setFactor(result.factors[0]?.id || "");
              } else if (mode === "login") await onSignedIn();
              else setMessage({ text: result.message });
            } catch (error) {
              setMessage({ error: true, text: error.message });
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            {text("Email", "邮箱")}
            <input
              name="email"
              disabled={busy || pending}
              autoComplete="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={254}
              required
            />
          </label>
          {mode !== "recover" && (
            <label>
              {text("Password", "密码")}
              <input
                name="password"
                disabled={busy || pending}
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === "signup" ? 12 : 1}
                maxLength={200}
                required
              />
            </label>
          )}
          <button className="primary wide" disabled={busy || pending}>
            {busy || pending
              ? text("Please wait…", "请稍候…")
              : mode === "login"
                ? text("Sign in", "登录")
                : mode === "signup"
                  ? text("Create account", "创建账号")
                  : text("Send recovery email", "发送恢复邮件")}
          </button>
        </form>
      )}
      {message && (
        <p
          className={`notice ${message.error ? "error" : ""}`}
          role={message.error ? "alert" : "status"}
        >
          {t(message.text)}
        </p>
      )}
      <div className="button-row">
        {[
          ["login", "Sign in", "登录"],
          ["signup", "Create account", "创建账号"],
          ["recover", "Forgot password?", "忘记密码？"],
        ]
          .filter(([key]) => key !== mode)
          .map(([key, en, zh]) => (
            <button
              key={key}
              className="text-button"
              onClick={() => {
                setMode(key);
                setPassword("");
                setMessage(null);
              }}
            >
              {text(en, zh)}
            </button>
          ))}
      </div>
      <a className="secondary wide demo-login-reset" href="/demo">
        {text("Explore the synthetic Demo", "查看合成数据演示")}
      </a>
    </div>
  );
}
