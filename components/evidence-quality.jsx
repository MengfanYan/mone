"use client";
import { useTerminalText } from "./terminal/context";
export default function EvidenceQuality({ evidence = {} }) {
  const text = useTerminalText();
  const scores = (evidence.word_boxes || evidence.boxes || [])
    .map((b) => Number(b.raw_score))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 100);
  const preset =
    evidence.quality === "DEMO_PRESET" ||
    /demo|preset/i.test(evidence.source || "");
  const label = preset
    ? text("Preset example · review required", "预设样例 · 需人工复核")
    : scores.length
      ? text(
          `OCR raw score ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}/100 · uncalibrated`,
          `OCR原始分数 ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)}/100 · 未校准`,
        )
      : text("Rule extraction · review required", "规则提取 · 需人工复核");
  return (
    <span
      className="evidence-quality"
      title={text(
        "Extraction scores are not probabilities of financial correctness.",
        "识别分数不是财务正确率。",
      )}
    >
      {label}
    </span>
  );
}
