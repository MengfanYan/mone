import { minor } from "./demo/calculations.mjs";
const keys = ["date", "currency", "merchant", "account_id", "kind"];
const same = (a, b) =>
  keys.every((k) => a[k] === b[k]) &&
  minor(a.amount, a.currency) === minor(b.amount, b.currency);
export function duplicateReview(
  preview,
  purpose,
  resource,
  events,
  ledgerVersion,
) {
  const candidates =
    purpose === "confirm_draft"
      ? [[resource, preview]]
      : purpose === "confirm_draft_batch"
        ? preview.drafts.map((d) => [d.id, d.content])
        : purpose === "command_apply"
          ? preview.operations
              .filter((o) => o.kind === "create_draft")
              .map((o) => [o.op_id, o.fields])
          : [];
  if (!candidates.length) return preview;
  const reversed = new Set(events.map((e) => e.reverses).filter(Boolean));
  const prior = events.filter(
    (e) => !e.reverses && !reversed.has(e.id) && e.kind !== "opening",
  );
  const reviews = [];
  for (const [candidate_id, candidate] of candidates) {
    const matches = prior
      .filter((e) => same(e, candidate))
      .map((e) => ({
        id: e.id,
        ...Object.fromEntries(
          ["date", "amount", "currency", "merchant", "account_id", "kind"].map(
            (k) => [k, e[k]],
          ),
        ),
        source:
          e.evidence?.source ||
          (String(e.id).startsWith("candidate:")
            ? "selected_batch"
            : "confirmed_ledger"),
      }));
    if (matches.length)
      reviews.push({
        candidate_id,
        candidate,
        matches,
        reason_code: "SAME_DATE_AMOUNT_CURRENCY_MERCHANT_ACCOUNT_KIND",
      });
    prior.push({ ...candidate, id: `candidate:${candidate_id}` });
  }
  return reviews.length
    ? {
        ...preview,
        duplicate_review: reviews,
        duplicate_ledger_version: ledgerVersion,
      }
    : preview;
}
export function duplicateReviewComplete(reviews = [], resolutions = []) {
  return (
    Array.isArray(reviews) &&
    Array.isArray(resolutions) &&
    resolutions.every(
      (r) =>
        r &&
        typeof r.candidate_id === "string" &&
        Object.keys(r).sort().join(",") === "candidate_id,reason",
    ) &&
    reviews.length === resolutions.length &&
    new Set(resolutions.map((r) => r.candidate_id)).size === reviews.length &&
    reviews.every((r) =>
      resolutions.some(
        (x) =>
          x.candidate_id === r.candidate_id &&
          typeof x.reason === "string" &&
          x.reason.trim().length >= 5 &&
          x.reason.trim().length <= 500,
      ),
    )
  );
}
export const duplicateResolution = (data, candidate_id) => {
  const r = data.duplicate_resolutions?.find(
    (r) => r.candidate_id === candidate_id,
  );
  return r
    ? { reason: r.reason.trim(), decision: "KEEP_SEPARATE_TRANSACTION" }
    : null;
};
