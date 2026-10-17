import catalog from "@/locales/catalog.json";

const reverse = new Map(
  Object.entries(catalog).map(([key, value]) => [value, key]),
);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(catalog)
  .filter(([key]) => /\{\w+\}/.test(key))
  .flatMap(([key, english]) => {
    return [key, english].map((source) => {
      const names = [];
      const pieces = source.split(/(\{\w+\})/g).map((piece) => {
        if (/^\{\w+\}$/.test(piece)) {
          names.push(piece.slice(1, -1));
          return "([\\s\\S]*?)";
        }
        return escape(piece);
      });
      return { key, names, pattern: new RegExp(`^${pieces.join("")}$`) };
    });
  });

export function readLocale() {
  if (typeof document === "undefined") return "en";
  return /(?:^|;\s*)wallet_language=zh(?:;|$)/.test(document.cookie)
    ? "zh"
    : "en";
}

export function translate(text, locale = "en", variables = {}) {
  if (typeof text !== "string") return text;
  let key = Object.hasOwn(catalog, text) ? text : reverse.get(text);
  let values = variables;
  if (!key) {
    for (const entry of patterns) {
      const match = text.match(entry.pattern);
      if (match) {
        key = entry.key;
        values = {
          ...Object.fromEntries(
            entry.names.map((name, index) => [name, match[index + 1]]),
          ),
          ...variables,
        };
        break;
      }
    }
  }
  const output = locale === "zh" ? key || text : catalog[key] || text;
  return output.replace(/\{(\w+)\}/g, (match, name) =>
    values[name] === undefined ? match : String(values[name]),
  );
}
