// Presentation only: group exact decimal strings without converting amounts to floats.
export function displayMoney(value) {
  if (value === null || value === undefined) return "—";
  const text = String(value);
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [whole, fraction] = text.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}
