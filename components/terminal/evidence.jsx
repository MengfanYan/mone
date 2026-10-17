"use client";
import EvidenceQuality from "../evidence-quality";
import { useState } from "react";
import { useTerminalText } from "./context";
import { Money } from "../financial-values";

export default function EvidenceWorkbench({ model, operations, onInspect }) {
  const text = useTerminalText(),
    [selected, setSelected] = useState(null),
    [size, setSize] = useState({ width: 1, height: 1 });
  const evidence = model.plan?.evidence || operations[0]?.evidence;
  if (!evidence?.raw_text) return null;
  const boxes = evidence.word_boxes || [],
    selectedOp = operations.find((x) => x.op_id === selected);
  const match = (box) =>
    selectedOp &&
    Object.values(selectedOp.fields).some(
      (v) =>
        typeof v === "string" &&
        v.length > 1 &&
        v.toLowerCase().includes(box.text?.toLowerCase()),
    );
  return (
    <section className="panel evidence-workbench">
      <div className="terminal-section-header">
        <div>
          <span className="terminal-overline">
            SOURCE / EXTRACTION / REVIEW
          </span>
          <h2>{text("Evidence workspace", "凭证复核工作台")}</h2>
        </div>
        <span className="chip">{evidence.source}</span>
      </div>
      <div className="terminal-split">
        <div>
          <h3>{text("Original source", "原始来源")}</h3>
          {model.image ? (
            <div className="source-preview">
              <div className="evidence-toolbar">
                <b>{model.fileName}</b>
                <span>
                  {boxes.length} {text("word regions", "文字区域")}
                </span>
              </div>
              <div className="source-wrapper">
                <img
                  src={model.image}
                  alt={text("Uploaded evidence source", "已上传凭证原图")}
                  onLoad={(e) =>
                    setSize({
                      width: e.currentTarget.naturalWidth,
                      height: e.currentTarget.naturalHeight,
                    })
                  }
                />
                {boxes.map((box, i) => (
                  <span
                    key={i}
                    className={`source-box ${match(box) ? "active" : ""}`}
                    title={box.text}
                    style={{
                      left: `${(box.x / size.width) * 100}%`,
                      top: `${(box.y / size.height) * 100}%`,
                      width: `${(box.width / size.width) * 100}%`,
                      height: `${(box.height / size.height) * 100}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="source-preview">
              <div className="evidence-toolbar">
                {model.fileName ||
                  text("Pasted / preset source", "粘贴 / 预设来源")}
              </div>
              <pre className="source-details">
                {evidence.raw_text.split(/(\n)/).map((line, i) => (
                  <span key={i}>
                    {selectedOp?.source_span?.includes(line.trim()) &&
                    line.trim() ? (
                      <mark>{line}</mark>
                    ) : (
                      line
                    )}
                  </span>
                ))}
              </pre>
            </div>
          )}
          <p className="terminal-note">
            {text(
              "Green: detected words. Purple: text matching the selected candidate. Matching is visual guidance, not calibrated confidence.",
              "绿色：检测到的文字。紫色：与选中候选字段匹配的文字。匹配仅用于辅助定位，不是经过校准的置信度。",
            )}
          </p>
        </div>
        <div>
          <h3>{text("Extracted candidates", "提取的候选")}</h3>
          {operations.map((op, i) => (
            <article
              className={`evidence-result-card ${selected === op.op_id ? "selected" : ""}`}
              key={op.op_id}
              onMouseEnter={() => setSelected(op.op_id)}
            >
              <header>
                <b>
                  {String(i + 1).padStart(2, "0")} ·{" "}
                  {op.fields.merchant || op.fields.name || op.kind}
                </b>
                <button
                  className="text-button"
                  aria-pressed={selected === op.op_id}
                  onClick={() => setSelected(op.op_id)}
                >
                  {text("Locate", "定位")}
                </button>
              </header>
              <p>
                {op.fields.date || op.fields.observed_at || "—"} ·{" "}
                {op.fields.currency || "—"}
              </p>
              {op.fields.amount && (
                <Money value={op.fields.amount} currency={op.fields.currency} />
              )}
              <p>{op.fields.category || op.kind}</p>
              <EvidenceQuality evidence={op.evidence || evidence} />
              <button className="secondary" onClick={() => onInspect(op)}>
                {text("Inspect fields", "检查字段")}
              </button>
            </article>
          ))}
          <div className="terminal-muted-box">
            {text(
              "Candidates do not change your ledger. Review the fields, account, currency and source, then use the confirmation controls below.",
              "候选不会直接更改账本。检查字段、账户、币种和来源后，再使用下方确认操作。",
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
