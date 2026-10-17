// Deterministic lexical vectors, not neural embeddings. Works entirely offline.
export function lexicalVector(text) {
  const words =
    String(text)
      .toLowerCase()
      .match(/[a-z0-9]{2,}|[\u3400-\u9fff]/g) || [];
  const tokens = [...words];
  for (let i = 1; i < words.length; i++)
    if (
      /^[\u3400-\u9fff]$/.test(words[i - 1]) &&
      /^[\u3400-\u9fff]$/.test(words[i])
    )
      tokens.push(words[i - 1] + words[i]);
  const vector = new Array(384).fill(0);
  for (const token of tokens) {
    let h = 2166136261;
    for (const char of token)
      h = Math.imul(h ^ char.charCodeAt(0), 16777619) >>> 0;
    vector[h % 384]++;
  }
  const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0));
  return norm ? vector.map((x) => x / norm) : vector;
}
export function searchKnowledge(documents, query, topK = 3, threshold = 0.1) {
  const q = lexicalVector(query),
    results = [];
  for (const doc of documents)
    for (let i = 0; i < doc.text.length; i += 850) {
      const text = doc.text.slice(i, i + 1000),
        vector = lexicalVector(text),
        score = vector.reduce((s, x, j) => s + x * q[j], 0);
      if (score >= threshold && score > 0)
        results.push({ id: doc.id, name: doc.name, offset: i, text, score });
    }
  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.name.localeCompare(b.name) ||
        a.offset - b.offset,
    )
    .slice(0, topK);
}
export const DEFAULT_TERMINAL_SETTINGS = {
  model: "gpt-4o",
  max_tokens: 600,
  temperature: 0.3,
  top_k: 3,
  threshold: 0.1,
  documents: [],
};
