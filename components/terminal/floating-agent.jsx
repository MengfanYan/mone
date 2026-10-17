"use client";

import { useEffect, useRef } from "react";
import { Bot, Minus } from "lucide-react";
import CommandComposer from "../command-composer";
import { useTerminalText } from "./context";

export default function FloatingAgent({ open, onOpenChange, ...props }) {
  const text = useTerminalText();
  const launcher = useRef(null);
  const panel = useRef(null);
  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector("textarea")?.focus();
    const escape = (event) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        onOpenChange(false);
        launcher.current?.focus();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, onOpenChange]);
  return (
    <div className="floating-agent">
      <section
        ref={panel}
        id="floating-agent-panel"
        className="floating-agent-panel"
        role="dialog"
        aria-labelledby="floating-agent-title"
        hidden={!open}
      >
        <header className="floating-agent-header">
          <span className="floating-agent-avatar">
            <Bot size={22} />
          </span>
          <div>
            <h2 id="floating-agent-title">
              {text("Task workspace", "任务工作台")}
            </h2>
            <p>
              {text(
                props.demo
                  ? "Demo task assistant"
                  : props.cloud
                    ? "Private workspace assistant"
                    : "Local task assistant",
                props.demo
                  ? "演示任务助手"
                  : props.cloud
                    ? "私人空间助手"
                    : "本地任务助手",
              )}
            </p>
          </div>
          <button
            type="button"
            className="terminal-icon"
            aria-label={text("Minimize agent", "收起助手")}
            onClick={() => {
              onOpenChange(false);
              launcher.current?.focus();
            }}
          >
            <Minus size={20} />
          </button>
        </header>
        <div className="floating-agent-body">
          <p className="floating-agent-intro">
            {text(
              props.cloud
                ? "I can look up your records, prepare changes and run deterministic analysis in your private workspace. Financial changes require review. External models, bank connections and payments are off."
                : "Tell me what you need. I can look up records, prepare changes and run local analysis. Saved changes refresh your workspace; financial changes need your review.",
              props.cloud
                ? "我可以查询本人记录、准备修改，并在私人空间运行确定性分析。财务变更需要复核；外部模型、银行连接与支付关闭。"
                : "告诉我你想执行的任务。我可以查询记录、准备修改或运行本地分析。保存后页面自动更新；财务变更需你复核确认。",
            )}
          </p>
          {open && <CommandComposer {...props} />}
        </div>
      </section>
      <button
        ref={launcher}
        type="button"
        className="floating-agent-launcher"
        aria-label={text(
          open ? "Minimize agent" : "Open agent",
          open ? "收起助手" : "打开助手",
        )}
        aria-expanded={open}
        aria-controls="floating-agent-panel"
        onClick={() => onOpenChange(!open)}
      >
        <Bot size={26} aria-hidden="true" />
      </button>
    </div>
  );
}
