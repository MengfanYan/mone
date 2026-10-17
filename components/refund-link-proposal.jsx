"use client";
import { useTerminalText } from "./terminal/context";
import { refundCandidates } from "@/lib/terminal/advisory.mjs";
export default function RefundLinkProposal({ state, draft, onChoose }) {
  const text = useTerminalText(),
    matches = refundCandidates(state, draft);
  if (!matches.length) return null;
  return (
    <aside className="refund-link-proposal">
      <strong>{text("Possible linked refund", "可能的关联退款")}</strong>
      <p>
        {text(
          "Same merchant, currency and account, with enough unrefunded expense. Verify the original before linking.",
          "同商户、币种及账户，且原消费剩余可退金额足够；请先核对原记录。",
        )}
      </p>
      {matches.map((e) => (
        <button
          type="button"
          className="text-button"
          key={e.id}
          onClick={() => onChoose(e)}
        >
          {text("Review link to", "检查关联至")} {e.merchant} · {e.date} ·{" "}
          {e.amount} {e.currency}
        </button>
      ))}
    </aside>
  );
}
