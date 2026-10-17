// Illustrative statistical calculations, kept separate from exact ledger money.
export const DEFAULT_SCENARIO = {
  age: 35,
  retirementAge: 65,
  initial: 40000,
  monthly: 2500,
  goal: 2000000,
  annualReturn: 7,
  inflation: 2.5,
  volatility: 12,
  seed: 4819,
};
export function validateScenario(input) {
  const p = { ...DEFAULT_SCENARIO, ...input };
  const ranges = {
    age: [18, 80],
    retirementAge: [19, 100],
    initial: [0, 1e10],
    monthly: [0, 1e6],
    goal: [1, 1e11],
    annualReturn: [-20, 30],
    inflation: [-2, 15],
    volatility: [0, 60],
    seed: [1, 2147483647],
  };
  for (const [key, [lo, hi]] of Object.entries(ranges)) {
    p[key] = Number(p[key]);
    if (!Number.isFinite(p[key]) || p[key] < lo || p[key] > hi)
      throw new Error(`Invalid ${key}`);
  }
  if (
    !Number.isInteger(p.age) ||
    !Number.isInteger(p.retirementAge) ||
    p.retirementAge <= p.age ||
    p.retirementAge - p.age > 60 ||
    !Number.isInteger(p.seed)
  )
    throw new Error("Use a horizon of 1–60 whole years.");
  return p;
}
function random(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const quantile = (sorted, p) =>
  sorted[
    Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1))
  ];
export function simulatePlanning(input, paths = 1200) {
  const p = validateScenario(input);
  if (!Number.isInteger(paths) || paths < 100 || paths > 5000)
    throw new Error("Use 100–5000 paths.");
  const years = p.retirementAge - p.age,
    uniform = random(p.seed),
    byYear = Array.from({ length: years + 1 }, () => []),
    samples = [],
    required = [];
  const sigma = p.volatility / 100,
    drift =
      (Math.log1p(p.annualReturn / 100) -
        Math.log1p(p.inflation / 100) -
        (sigma * sigma) / 2) /
      12;
  let successes = 0;
  for (let path = 0; path < paths; path++) {
    let balance = p.initial,
      capital = p.initial,
      contributionFactor = 0;
    const sample = [balance];
    byYear[0].push(balance);
    for (let month = 1; month <= years * 12; month++) {
      const normal =
        Math.sqrt(-2 * Math.log(Math.max(uniform(), 1e-12))) *
        Math.cos(2 * Math.PI * uniform());
      const growth = Math.exp(drift + (sigma / Math.sqrt(12)) * normal);
      balance = balance * growth + p.monthly;
      capital *= growth;
      contributionFactor = contributionFactor * growth + 1;
      if (month % 12 === 0) {
        byYear[month / 12].push(balance);
        sample.push(balance);
      }
    }
    if (balance >= p.goal) successes++;
    required.push(Math.max(0, (p.goal - capital) / contributionFactor));
    if (path < 18) samples.push(sample);
  }
  const points = byYear.map((values, year) => {
    values.sort((a, b) => a - b);
    return {
      year,
      p05: quantile(values, 0.05),
      p10: quantile(values, 0.1),
      median: quantile(values, 0.5),
      p90: quantile(values, 0.9),
      p95: quantile(values, 0.95),
    };
  });
  required.sort((a, b) => a - b);
  const last = points.at(-1);
  return {
    parameters: p,
    paths,
    points,
    samples,
    probability: successes / paths,
    median: last.median,
    downside: last.p10,
    nominalMedian: last.median * (1 + p.inflation / 100) ** years,
    monthlyFor90: Math.ceil(quantile(required, 0.9) * 100) / 100,
    realTerms: true,
    method: "seeded-monthly-lognormal-v1",
    simulation: true,
  };
}
