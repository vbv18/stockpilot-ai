#!/usr/bin/env python3
"""
Policy validation across 3 synthetic regimes:
  1. Poisson
  2. Lognormal-skewed
  3. Lumpy
Evaluates s_det, s_quant, s_emp against target alpha = 0.95 on fresh true-generator paths.
Outputs validation.csv to experiments/results/validation.csv.
"""

from __future__ import annotations

import math
from pathlib import Path
from statistics import NormalDist
import sys

import numpy as np
import pandas as pd

# Ensure stats-service is in sys.path
ROOT_DIR = Path(__file__).resolve().parent.parent if Path(__file__).resolve().parent.name == "experiments" else Path(__file__).resolve().parent
STATS_DIR = ROOT_DIR / "stats-service"
if str(STATS_DIR) not in sys.path:
    sys.path.insert(0, str(STATS_DIR))

from app.engine.inventory import sample_lead_times
from app.engine.simulation import simulate_policy


def generate_regime_demand(
    regime: str,
    n_paths: int,
    horizon: int,
    rng: np.random.Generator,
) -> np.ndarray:
    if regime == "poisson":
        return rng.poisson(lam=12.0, size=(n_paths, horizon)).astype(float)
    elif regime == "lognormal-skewed":
        raw = rng.lognormal(mean=2.2, sigma=0.85, size=(n_paths, horizon))
        return np.rint(raw).astype(float)
    elif regime == "lumpy":
        # Intermittent zero-inflated arrivals with skewed burst sizes
        arrivals = rng.binomial(1, 0.35, size=(n_paths, horizon))
        sizes = rng.lognormal(mean=3.2, sigma=0.6, size=(n_paths, horizon))
        return np.rint(arrivals * sizes).astype(float)
    else:
        raise ValueError(f"Unknown regime: {regime}")


def run_validation(seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    alpha = 0.95
    z = NormalDist().inv_cdf(alpha)
    horizon = 365
    n_scenarios = 500
    l_mean = 7.0
    l_std = 2.0
    holding_daily = 0.25 * 20.0 / 365.0
    order_cost = 50.0
    penalty = 60.0

    regimes = ["poisson", "lognormal-skewed", "lumpy"]
    rows = []

    for regime in regimes:
        # 1. Generate training demand
        train_path = generate_regime_demand(regime, 1, horizon, rng)[0]
        mu_d = float(np.mean(train_path))
        sigma_d = float(np.std(train_path, ddof=1)) if len(train_path) > 1 else 1.0

        # Sample bootstrap paths for quantile and empirical ROP estimation
        n_boot = 500
        boot_paths = rng.choice(train_path, size=(n_boot, int(l_mean + 4 * l_std)), replace=True)
        boot_lead_times = sample_lead_times(l_mean, l_std, n_boot, rng)
        boot_lead_times = np.clip(boot_lead_times, 1, boot_paths.shape[1])
        cum_boot = np.cumsum(boot_paths, axis=1)
        ltd_boot = cum_boot[np.arange(n_boot), boot_lead_times - 1]

        # s_det
        sigma_l_sq = l_mean * (sigma_d ** 2) + (mu_d ** 2) * (l_std ** 2)
        sigma_l = math.sqrt(max(0.0, sigma_l_sq))
        s_det = max(0, int(math.ceil(l_mean * mu_d + z * sigma_l - 1e-9)))

        # s_emp
        s_emp = max(0, int(math.ceil(float(np.quantile(ltd_boot, alpha, method="higher")) - 1e-9)))

        # s_quant
        p10 = np.percentile(train_path, 10)
        p90 = np.percentile(train_path, 90)
        p50 = np.percentile(train_path, 50)
        sigma_dq = float((p90 - p10) / (2.0 * 1.2816))
        sigma_ltd_q = math.sqrt(l_mean * (sigma_dq ** 2) + (mu_d ** 2) * (l_std ** 2))
        s_quant = max(0, int(math.ceil(p50 * l_mean + z * sigma_ltd_q - 1e-9)))

        # EOQ
        annual_d = mu_d * 365.0
        eoq = max(1, int(math.ceil(math.sqrt(2.0 * annual_d * order_cost / (holding_daily * 365.0)))))

        # 2. Simulate on fresh true-generator paths (warm-up 30 days, total 395)
        fresh_rng = np.random.default_rng(seed + 1000 + len(rows))
        fresh_paths = generate_regime_demand(regime, n_scenarios, horizon + 30, fresh_rng)
        fresh_lead_times = sample_lead_times(l_mean, l_std, (n_scenarios, horizon + 30), fresh_rng)

        policies = [
            ("s_det", s_det),
            ("s_quant", s_quant),
            ("s_emp", s_emp),
        ]

        for p_name, rop in policies:
            sim = simulate_policy(
                fresh_paths,
                rop=rop,
                q=eoq,
                lead=int(round(l_mean)),
                start_inv=float(rop + eoq),
                holding_daily=holding_daily,
                order_cost=order_cost,
                penalty=penalty,
                lead_times=fresh_lead_times,
                warmup_days=30,
            )

            achieved_csl = float(np.mean(sim["csl"]))
            achieved_fill = float(np.mean(sim["fill_rate"]))
            tot_cost = float(np.mean(sim["total_cost"]))

            rows.append({
                "regime": regime,
                "policy": p_name,
                "target_csl": alpha,
                "achieved_csl": round(achieved_csl, 4),
                "csl_gap": round(achieved_csl - alpha, 4),
                "achieved_fill_rate": round(achieved_fill, 4),
                "rop": rop,
                "eoq": eoq,
                "mean_total_cost": round(tot_cost, 2),
            })

    df = pd.DataFrame(rows)
    return df


def main():
    df = run_validation(seed=42)
    out_dir = Path("experiments/results")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_file = out_dir / "validation.csv"
    df.to_csv(out_file, index=False)
    print("\nPolicy Validation Results (Target CSL = 0.95):")
    print(df.to_string(index=False))
    print(f"\nSaved validation results -> {out_file}\n")


if __name__ == "__main__":
    main()
