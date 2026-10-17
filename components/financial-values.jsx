"use client";
import { displayMoney } from "@/lib/money-format.mjs";
import { useScreenPrivacy, useTerminalText } from "./terminal/context";

export function Amount({ value }) {
  const { masked } = useScreenPrivacy();
  const text = useTerminalText();
  if (masked)
    return <span aria-label={text("Hidden amount", "金额已隐藏")}>••••••</span>;
  const [whole, fraction] = displayMoney(value).split(".");
  return (
    <span className="amount-number">
      <span className="amount-major">{whole}</span>
      {fraction !== undefined && (
        <span className="amount-minor">.{fraction}</span>
      )}
    </span>
  );
}

export function Money({ value, currency, muted = false }) {
  return (
    <span className={muted ? "money muted" : "money"}>
      <Amount value={value} /> <small>{currency}</small>
    </span>
  );
}

export function Metric({ label, value, unit, icon: Icon, note }) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        {Icon && <Icon size={18} />}
      </div>
      <div className="metric-value">
        <Amount value={value} />
        <small>{unit}</small>
      </div>
      <p>{note}</p>
    </div>
  );
}
