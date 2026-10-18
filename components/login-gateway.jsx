"use client";

import { useState } from "react";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Cloud,
  Copy,
  Eye,
  LockKeyhole,
  Play,
  ShieldCheck,
  Terminal,
  Wallet,
} from "lucide-react";
import { LanguageSwitch, useLocale } from "./locale-provider";

/** Presentation only: the deployment's existing authentication owns the form. */
export default function LoginGateway({ cloud, demo, children }) {
  const { locale, t } = useLocale();
  const text = (en, zh) => (locale === "zh" ? zh : en);
  const current = cloud ? "cloud" : "local";
  const [view, setView] = useState(current);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const mode = demo ? "DEMO" : cloud ? "CLOUD" : "LOCAL";
  return (
    <main className="auth-gateway">
      <section className="auth-story" aria-labelledby="auth-story-title">
        <header className="auth-brand-row">
          <div className="auth-brand">
            <span className="auth-brand-icon">
              <Wallet size={22} />
            </span>
            <div>
              <div className="auth-brand-name">
                Mone <span>{mode}</span>
              </div>
              <p>
                {text("EVERY DOLLAR, ACCOUNTED FOR", "每一分钱，皆有迹可循")}
              </p>
            </div>
          </div>
          <span className="auth-trust">
            <i />
            {text("You stay in control", "始终由你掌控")}
          </span>
        </header>
        <div className="auth-story-content">
          <span className="auth-eyebrow">
            <ShieldCheck size={14} />
            {text(
              "MONE · EVERY DOLLAR TRACED. EVERY STEP PLANNED.",
              "MONE · 每一笔清晰可溯，每一步从容规划。",
            )}
          </span>
          <h1 id="auth-story-title">
            {text("Know where your money goes.", "每一笔，有据可查。")}
            <br />
            {text("Plan what comes next.", "每一步，心中有数。")}
          </h1>
          <p className="auth-intro">
            {text(
              "Your accounts, spending, and future goals in one clear workspace. Trace every amount to its source. You review what enters your ledger.",
              "在同一个工作台看清账户、收支与未来目标。每个金额都有来源，每一笔入账都由你审核。",
            )}
          </p>
          <figure className="auth-preview">
            <figcaption>
              {text(
                "WORKSPACE PREVIEW · SYNTHETIC EXAMPLE DATA",
                "工作台预览 · 虚构示例数据",
              )}
            </figcaption>
            <div className="auth-ledger">
              <div className="auth-ledger-top">
                <div>
                  <span className="auth-micro">
                    {text(
                      "Example recorded assets · AUD",
                      "示例已记录资产 · AUD",
                    )}
                  </span>
                  <div className="auth-asset-number">
                    $142,850.40 <span>+2.9%</span>
                  </div>
                </div>
                <div className="auth-remaining">
                  <span className="auth-micro">
                    {text("EXAMPLE SAFE TO SPEND", "示例安全可支配")}
                  </span>
                  <strong>$3,420.00</strong>
                </div>
              </div>
              <div className="auth-budget">
                <span>
                  <i />
                  {text("Fixed & operating costs", "固定与日常支出")}
                </span>
                <span>
                  $2,180 <em>/ $2,500</em>
                </span>
              </div>
              <div className="auth-budget-bar" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <div className="auth-ledger-cells">
                <div>
                  <span>{text("Checking · 4092", "日常账户 · 4092")}</span>
                  <strong>$18,420.00</strong>
                </div>
                <div>
                  <span>{text("Savings goal (Q4)", "储蓄目标（Q4）")}</span>
                  <strong>{text("92% funded", "已完成 92%")}</strong>
                </div>
                <div>
                  <span>{text("Review status", "审核状态")}</span>
                  <strong>✓ {text("Confirmed", "已确认")}</strong>
                </div>
              </div>
            </div>
            <div className="auth-proof">
              <CheckCircle2 size={22} />
              <div>
                <strong>
                  {text("Every amount has a source", "每个金额都有据可查")}
                </strong>
                <span>
                  {text(
                    "Clear calculations · You confirm",
                    "计算清晰 · 由你确认",
                  )}
                </span>
              </div>
            </div>
          </figure>
        </div>
        <footer className="auth-story-footer">
          <div>
            <span>
              <LockKeyhole size={14} />
              {text("Controlled access", "受控访问")}
            </span>
            <span>
              <CheckCircle2 size={14} />
              {text("Verifiable amounts", "金额可复算")}
            </span>
            <span>
              <Eye size={14} />
              {text("Read-only analysis", "只读分析")}
            </span>
          </div>
          <small>
            {text("No payments or securities trading", "无支付或证券交易")}
          </small>
        </footer>
      </section>
      <section className="auth-access" aria-labelledby="auth-login-title">
        <div className="auth-toolbar">
          <span className="auth-mode">
            <i />
            {text(
              demo
                ? "Product demo"
                : cloud
                  ? "Cloud workspace"
                  : "Local workspace",
              demo ? "产品演示" : cloud ? "云端工作台" : "本地工作台",
            )}
          </span>
          <LanguageSwitch />
        </div>
        <div className="login-card">
          <h2 id="auth-login-title">
            {t(demo ? "打开产品演示" : "打开你的工作台")}
          </h2>
          <p className="auth-welcome">
            {text(
              "Every dollar traced. Every step planned.",
              "每一笔清晰可溯，每一步从容规划。",
            )}
          </p>
          {!demo && (
            <div
              className="auth-modes"
              aria-label={text("Access options", "访问方式")}
            >
              {[
                ["cloud", Cloud, "Cloud workspace", "云端工作台"],
                ["local", Terminal, "Local access code", "本地访问码"],
              ].map(([key, Icon, en, zh]) => (
                <button
                  type="button"
                  key={key}
                  aria-pressed={view === key}
                  onClick={() => setView(key)}
                >
                  <Icon size={15} />
                  {text(en, zh)}
                </button>
              ))}
            </div>
          )}
          {!demo && view !== current && (
            <div className="auth-mode-help" role="status">
              <Cloud size={20} />
              <h3>
                {text(
                  cloud
                    ? "Local access runs on your device"
                    : "This is your local workspace",
                  cloud ? "本地访问在你的设备上运行" : "当前是你的本地工作台",
                )}
              </h3>
              <p>
                {text(
                  cloud
                    ? "A local access code belongs to a separately running local workspace. Use your email and password to sign in here."
                    : "This address uses a local access code. Cloud accounts are available on a separately configured cloud deployment.",
                  cloud
                    ? "本地访问码用于独立运行的本地工作台。请使用邮箱和密码登录当前云端工作台。"
                    : "当前地址使用本地访问码。云端账号需要在单独配置的云端站点登录。",
                )}
              </p>
              <button
                type="button"
                className="secondary wide"
                onClick={() => setView(current)}
              >
                {text("Back to sign in", "返回登录")}
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div hidden={!demo && view !== current} className="auth-active-form">
            {!cloud && !demo && (
              <div className="auth-terminal">
                <div>
                  <Terminal size={15} />
                  <strong>
                    {text("Self-hosted / local access", "自托管 / 本地访问")}
                  </strong>
                </div>
                <p>
                  {text(
                    "Start the local service, then enter the access code shown in your terminal. No cloud account needed.",
                    "启动本地服务后，输入终端显示的访问码。无需云端账号。",
                  )}
                </p>
                <div className="auth-command">
                  <code>
                    <span>$</span> npm run dev
                  </code>
                  <button
                    type="button"
                    aria-label={text("Copy startup command", "复制启动命令")}
                    onClick={async () => {
                      try {
                        await window.navigator.clipboard.writeText(
                          "npm run dev",
                        );
                        setCopied(true);
                        setCopyError(false);
                      } catch {
                        setCopyError(true);
                      }
                    }}
                  >
                    {copied ? <Check size={15} /> : <Copy size={15} />}
                  </button>
                </div>
                <span className="auth-copy-status" role="status">
                  {copyError
                    ? text(
                        "Select the command above to copy it.",
                        "请选择上方命令进行复制。",
                      )
                    : copied
                      ? text("Command copied", "命令已复制")
                      : ""}
                </span>
              </div>
            )}
            {children}
          </div>
          {!demo && (
            <a className="auth-demo" href="/demo">
              <span className="auth-demo-icon">
                <Play size={17} />
              </span>
              <span>
                <strong>
                  {text(
                    "Explore interactive product demo",
                    "探索交互式产品演示",
                  )}
                </strong>
                <small>
                  {text(
                    "Sample accounts, budgets & goals. No sign-in.",
                    "示例账户、预算与目标，无需登录。",
                  )}
                </small>
              </span>
              <ArrowRight size={17} />
            </a>
          )}
        </div>
        <footer className="auth-access-footer">
          <span>© {new Date().getFullYear()} Mone Finance</span>
          <span>
            <ShieldCheck size={13} />
            {text(
              "Every dollar traced. Every step planned.",
              "每一笔清晰可溯，每一步从容规划。",
            )}
          </span>
        </footer>
      </section>
    </main>
  );
}
