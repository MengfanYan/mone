"""Explicit, read-only statistical scenario calculation; never ledger money."""
import math
import random

from .domain import require

RANGES = {"age": (18, 80), "retirementAge": (19, 100), "initial": (0, 1e10),
          "monthly": (0, 1e6), "goal": (1, 1e11), "annualReturn": (-20, 30),
          "inflation": (-2, 15), "volatility": (0, 60), "seed": (1, 2147483647)}


def simulate(data):
    require(isinstance(data, dict) and set(data) == {"parameters", "paths"}, "INVALID_SCENARIO", "Provide all scenario parameters and a path count.")
    p, paths = data["parameters"], data["paths"]
    require(isinstance(p, dict) and set(p) == set(RANGES), "INVALID_SCENARIO", "All scenario assumptions are required; no financial defaults are supplied.")
    for key, (lo, hi) in RANGES.items():
        value = p[key]
        require(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and lo <= value <= hi,
                "INVALID_SCENARIO", f"Invalid scenario parameter: {key}.")
    require(all(int(p[key]) == p[key] for key in ("age", "retirementAge", "seed")) and 1 <= p["retirementAge"]-p["age"] <= 60,
            "INVALID_SCENARIO", "Use a horizon of 1–60 whole years.")
    require(isinstance(paths, int) and not isinstance(paths, bool) and 100 <= paths <= 2400,
            "INVALID_SCENARIO", "Use 100–2400 simulation paths.")
    years = int(p["retirementAge"]-p["age"])
    rng = random.Random(p["seed"])
    by_year, samples, required = [[] for _ in range(years+1)], [], []
    sigma = p["volatility"]/100
    drift = (math.log1p(p["annualReturn"]/100)-math.log1p(p["inflation"]/100)-sigma*sigma/2)/12
    successes = 0
    for path in range(paths):
        balance = capital = p["initial"]
        factor = 0
        sample = [balance]
        by_year[0].append(balance)
        for month in range(1, years*12+1):
            normal = math.sqrt(-2*math.log(max(rng.random(), 1e-12)))*math.cos(2*math.pi*rng.random())
            growth = math.exp(drift+sigma/math.sqrt(12)*normal)
            balance, capital, factor = balance*growth+p["monthly"], capital*growth, factor*growth+1
            if month % 12 == 0:
                by_year[month//12].append(balance)
                sample.append(balance)
        successes += balance >= p["goal"]
        required.append(max(0, (p["goal"]-capital)/factor))
        if path < 18:
            samples.append(sample)
    def quantile(values, probability):
        return values[max(0, math.ceil(probability*len(values))-1)]
    points = []
    for year, values in enumerate(by_year):
        values.sort()
        points.append({"year": year, **{key: quantile(values, q) for key, q in
                      (("p05", .05), ("p10", .1), ("median", .5), ("p90", .9), ("p95", .95))}})
    required.sort()
    return {"parameters": p, "paths": paths, "points": points, "samples": samples,
            "probability": successes/paths, "median": points[-1]["median"], "downside": points[-1]["p10"],
            "nominalMedian": points[-1]["median"]*(1+p["inflation"]/100)**years,
            "monthlyFor90": math.ceil(quantile(required, .9)*100)/100, "realTerms": True,
            "method": "seeded-monthly-lognormal-python-v1", "simulation": True, "source": "LOCAL_API"}
