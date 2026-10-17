const tabs = new Set([
  "overview",
  "ledger",
  "planning",
  "portfolio",
  "reports",
  "assistant",
  "privacy",
  "settings",
]);
const currencies = new Set([
  "AUD",
  "CNY",
  "USD",
  "EUR",
  "GBP",
  "NZD",
  "CAD",
  "HKD",
  "SGD",
  "JPY",
  "KRW",
  "KWD",
  "BHD",
]);
export function readWorkspaceLocation(search) {
  const q = new URLSearchParams(search),
    result = {};
  if (tabs.has(q.get("tab"))) result.tab = q.get("tab");
  if (
    /^\d{4}-(0[1-9]|1[0-2])$/.test(q.get("period") || "") &&
    Number(q.get("period").slice(0, 4)) >= 1900 &&
    Number(q.get("period").slice(0, 4)) <= 2100
  )
    result.period = q.get("period");
  if (currencies.has(q.get("currency"))) result.currency = q.get("currency");
  return result;
}
export function workspaceSearch({ tab, period, currency }) {
  const q = new URLSearchParams();
  if (tabs.has(tab)) q.set("tab", tab);
  if (readWorkspaceLocation(`period=${period}`).period) q.set("period", period);
  if (currencies.has(currency)) q.set("currency", currency);
  return `?${q}`;
}
