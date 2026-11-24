#!/usr/bin/env python3
"""
StockPilot AI - Evaluation and Experimentation CLI
Runs full-pipeline numerical experiments across historical daily series:
  (1) Per-SKU model comparison from P4 (SeasonalNaive vs AutoETS vs CrostonSBA vs GlobalLGBM vs Naive)
  (2) Baseline improvement (MAE, RMSE, WAPE % reduction over Naive, coverage minus nominal 80%)
  (3) Policy comparison (deterministic vs uncertainty-aware vs quantile) on simulated and actual held-out demand
  (4) Service-level sweep (0.80 - 0.98) across replenishment policies
  (5) Constrained vs unconstrained portfolio cost optimization
  (6) Portfolio budget sweep (6 budgets from 40% to 100% of unconstrained investment, greedy vs exact)
  (7) Demand co-movement and dependency pairs (|rho| >= 0.3)

Outputs CSVs to experiments/results/, figures to experiments/results/figures/, and results_summary.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import lightgbm

# Ensure stats-service root is in sys.path
STATS_DIR = Path(__file__).resolve().parent.parent
if str(STATS_DIR) not in sys.path:
    sys.path.insert(0, str(STATS_DIR))

import numpy as np
import pandas as pd

from app.engine.classification import classify_demand
from app.engine.dependency import compute_dependency
from app.engine.evaluation import evaluate_series
from app.engine.forecasting import fit_sku
from app.engine.inventory import optimize_sku
from app.engine.replay import replay_sku
from app.engine.simulation import simulate_policy, simulate_sku
from app.portfolio import solve_exact, solve_portfolio
from app.schemas import (
    ForecastParams,
    OptimizeParams,
    OptimizeSkuInput,
    PortfolioCurvePoint,
    PortfolioRequest,
    PortfolioSkuInput,
    ReplayParams,
    SimulateParams,
    SimulateSkuInput,
    SkuAssumptions,
    SkuSeries,
    annual_holding_cost,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("stockpilot.experiments")


def load_daily_sales_csv(csv_path: str | Path) -> Tuple[List[SkuSeries], Dict[str, float]]:
    """
    Loads daily sales CSV and constructs contiguous daily SkuSeries.
    Input data is filtered to the last 365 days of daily rows.
    SKUs are selected by active days (>= 60), then ranked by volume.
    Extracts median UnitPrice per SKU if present.
    """
    csv_file = Path(csv_path)
    if not csv_file.is_file():
        raise FileNotFoundError(f"Daily sales CSV not found: {csv_file}")

    try:
        df = pd.read_csv(csv_file, encoding="utf-8")
    except UnicodeDecodeError:
        df = pd.read_csv(csv_file, encoding="latin1")
    col_map = {str(c).lower().strip(): c for c in df.columns}

    sku_candidates = ["sku_id", "sku", "item_id", "item", "product_id", "stockcode", "stock_code"]
    date_candidates = ["date", "ds", "timestamp", "day", "invoicedate", "invoice_date", "invoicedt", "invoice_dt"]
    qty_candidates = ["quantity", "qty", "sales", "units", "demand", "y", "volume"]
    price_candidates = ["unitprice", "unit_price", "price", "cost"]

    sku_col = next((col_map[c] for c in sku_candidates if c in col_map), None)
    date_col = next((col_map[c] for c in date_candidates if c in col_map), None)
    qty_col = next((col_map[c] for c in qty_candidates if c in col_map), None)
    price_col = next((col_map[c] for c in price_candidates if c in col_map), None)

    if not sku_col or not date_col or not qty_col:
        raise ValueError(
            f"CSV must contain SKU, date, and quantity columns. "
            f"Found columns: {list(df.columns)}. "
            f"Resolved: sku='{sku_col}', date='{date_col}', quantity='{qty_col}'"
        )

    df[sku_col] = df[sku_col].astype(str).str.strip()
    df[date_col] = pd.to_datetime(df[date_col], dayfirst=True, errors="coerce")
    df = df.dropna(subset=[date_col])
    df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0.0)
    df[qty_col] = np.clip(df[qty_col].to_numpy(dtype=float), 0.0, None)

    # Input data is the last 365 days of daily rows
    max_date = df[date_col].max()
    cutoff_date = max_date - pd.Timedelta(days=364)
    df = df[df[date_col] >= cutoff_date]

    # Median unit price per SKU if present
    median_prices: Dict[str, float] = {}
    if price_col:
        df[price_col] = pd.to_numeric(df[price_col], errors="coerce").fillna(0.0)
        pos_prices = df[df[price_col] > 0]
        if not pos_prices.empty:
            median_prices = pos_prices.groupby(sku_col)[price_col].median().to_dict()

    # Group daily
    grouped = (
        df.groupby([sku_col, df[date_col].dt.normalize()])[qty_col]
        .sum()
        .reset_index()
    )

    full_idx = pd.date_range(start=cutoff_date.normalize(), end=max_date.normalize(), freq="D")
    sku_stats: list[tuple[str, int, float, list[float]]] = []

    for sku_id in grouped[sku_col].unique():
        sku_df = grouped[grouped[sku_col] == sku_id].sort_values(by=date_col)
        sku_series = sku_df.set_index(date_col)[qty_col].reindex(full_idx, fill_value=0.0)
        vals = sku_series.to_numpy(dtype=float)
        active_days = int((vals > 0).sum())
        total_vol = float(vals.sum())
        if active_days >= 60:
            sku_stats.append((sku_id, active_days, total_vol, vals.tolist()))

    # Rank by active days (>= 60), then volume descending
    sku_stats.sort(key=lambda x: (x[1], x[2]), reverse=True)
    sku_stats = sku_stats[:25]

    series_list: List[SkuSeries] = []
    for sku_id, _, _, vals in sku_stats:
        series_list.append(
            SkuSeries(
                sku_id=str(sku_id),
                start_date=cutoff_date.date(),
                values=vals,
            )
        )

    log.info("Loaded %d eligible SKU series (active days >= 60) from %s", len(series_list), csv_file)
    return series_list, median_prices


def generate_distinct_assumptions(
    series_list: List[SkuSeries],
    median_prices: Dict[str, float],
) -> Dict[str, SkuAssumptions]:
    """Generates distinct per-SKU assumptions with no identical copies."""
    assumptions: Dict[str, SkuAssumptions] = {}
    lead_times = [5, 7, 8, 10, 12, 14, 15]
    lead_stds = [1.0, 1.2, 1.5, 1.8, 2.0, 2.2, 2.5]
    order_costs = [35.0, 42.0, 50.0, 60.0, 68.0, 75.0, 85.0]
    holding_rates = [0.18, 0.20, 0.22, 0.24, 0.25, 0.28, 0.30]

    for idx, s in enumerate(series_list):
        sku_id = s.sku_id
        u_cost = float(median_prices.get(sku_id, 0.0))
        if u_cost <= 0.0:
            hash_val = int(hashlib.md5(sku_id.encode("utf-8")).hexdigest()[:6], 16)
            u_cost = round(8.5 + (hash_val % 450) / 10.0, 2)
        else:
            u_cost = round(u_cost, 2)

        lt_mean = int(lead_times[idx % len(lead_times)])
        lt_std = lead_stds[idx % len(lead_stds)]
        h_rate = holding_rates[idx % len(holding_rates)]
        o_cost = order_costs[idx % len(order_costs)]
        s_cost = round(max(20.0, u_cost * 2.0 + (idx % 7) * 3.0), 2)

        assumptions[sku_id] = SkuAssumptions(
            sku_id=sku_id,
            lead_time_mean=lt_mean,
            lead_time_std=lt_std,
            unit_cost=u_cost,
            holding_rate=h_rate,
            order_cost=o_cost,
            shortage_cost=s_cost,
            target_service_level=0.95,
            service_level=0.95,
        )
    return assumptions


def load_assumptions_json(
    json_path: str | Path,
) -> Tuple[Dict[str, SkuAssumptions], Optional[float], Optional[float]]:
    """
    Loads per-SKU assumptions JSON. Accepts:
      - Array of per-SKU assumption objects: [ { "sku_id": ..., ... }, ... ]
      - Wrapped format with optional constraints: { "skus": [ ... ], "budget": ..., "capacity": ... }
      - Dictionary mapping SKU IDs: { "sku_id": { ... } }
    """
    assump_file = Path(json_path)
    if not assump_file.is_file():
        raise FileNotFoundError(f"Assumptions JSON not found: {assump_file}")

    with open(assump_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    budget: Optional[float] = None
    capacity: Optional[float] = None
    assumptions: Dict[str, SkuAssumptions] = {}

    if isinstance(data, list):
        for item in data:
            if not isinstance(item, dict) or "sku_id" not in item:
                continue
            payload = dict(item)
            assumptions[str(payload["sku_id"])] = SkuAssumptions.model_validate(payload)
    elif isinstance(data, dict):
        if "budget" in data and data["budget"] is not None:
            budget = float(data["budget"])
        if "capacity" in data and data["capacity"] is not None:
            capacity = float(data["capacity"])

        if "skus" in data and isinstance(data["skus"], list):
            for item in data["skus"]:
                if not isinstance(item, dict) or "sku_id" not in item:
                    continue
                payload = dict(item)
                assumptions[str(payload["sku_id"])] = SkuAssumptions.model_validate(payload)
        elif "skus" in data and isinstance(data["skus"], dict):
            for sku_id, fields in data["skus"].items():
                if not isinstance(fields, dict):
                    continue
                payload = dict(fields)
                payload.setdefault("sku_id", str(sku_id))
                assumptions[str(sku_id)] = SkuAssumptions.model_validate(payload)
        else:
            for sku_id, fields in data.items():
                if not isinstance(fields, dict):
                    continue
                payload = dict(fields)
                payload.setdefault("sku_id", str(sku_id))
                assumptions[str(sku_id)] = SkuAssumptions.model_validate(payload)
    else:
        raise ValueError("Assumptions file must be an array of per-SKU objects or a JSON object.")

    log.info("Loaded assumptions for %d SKUs from %s", len(assumptions), assump_file)
    return assumptions, budget, capacity


def run_model_comparison(
    series_list: List[SkuSeries],
    fc_params: ForecastParams,
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    """
    (1) per-SKU model comparison from P4:
    Evaluates SeasonalNaive, AutoETS, Naive, GlobalLGBM, and CrostonSBA across rolling origins.
    Also extracts baseline improvement metrics relative to Naive.
    """
    log.info("Running (1) per-SKU model comparison from P4...")
    panel_rows = []
    for s in series_list:
        s_dates = pd.date_range(start=pd.to_datetime(s.start_date), periods=len(s.values), freq="D")
        for dt, val in zip(s_dates, s.values):
            panel_rows.append({"sku_id": s.sku_id, "date": dt, "y": float(val)})
    global_panel = pd.DataFrame(panel_rows) if panel_rows else None

    model_rows = []
    baseline_rows = []

    for s in series_list:
        y = np.asarray(s.values, dtype=float)
        d_class, adi, cv2 = classify_demand(y)
        ev = evaluate_series(s.sku_id, s.start_date, y, fc_params, global_panel)

        sn_m = ev.seasonal_naive
        ets_m = ev.autoets
        croston_m = ev.croston_sba
        naive_m = ev.naive
        lgbm_m = ev.global_lgbm

        model_rows.append({
            "sku_id": s.sku_id,
            "demand_class": d_class,
            "adi": round(float(adi), 4),
            "cv2": round(float(cv2), 4),
            "chosen_model": ev.chosen_model or "SeasonalNaive",
            "mase_improvement": round(float(ev.mase_improvement), 4) if ev.mase_improvement is not None else 0.0,
            "seasonal_naive_mae": round(float(sn_m.mae), 4) if sn_m else None,
            "seasonal_naive_rmse": round(float(sn_m.rmse), 4) if sn_m else None,
            "seasonal_naive_wape": round(float(sn_m.wape), 4) if sn_m and sn_m.wape is not None else None,
            "seasonal_naive_mase": round(float(sn_m.mase), 4) if sn_m and sn_m.mase is not None else None,
            "seasonal_naive_coverage": round(float(sn_m.coverage), 4) if sn_m and sn_m.coverage is not None else None,
            "autoets_mae": round(float(ets_m.mae), 4) if ets_m else None,
            "autoets_rmse": round(float(ets_m.rmse), 4) if ets_m else None,
            "autoets_wape": round(float(ets_m.wape), 4) if ets_m and ets_m.wape is not None else None,
            "autoets_mase": round(float(ets_m.mase), 4) if ets_m and ets_m.mase is not None else None,
            "autoets_coverage": round(float(ets_m.coverage), 4) if ets_m and ets_m.coverage is not None else None,
            "croston_sba_mae": round(float(croston_m.mae), 4) if croston_m else None,
            "croston_sba_rmse": round(float(croston_m.rmse), 4) if croston_m else None,
            "croston_sba_wape": round(float(croston_m.wape), 4) if croston_m and croston_m.wape is not None else None,
            "croston_sba_mase": round(float(croston_m.mase), 4) if croston_m and croston_m.mase is not None else None,
            "croston_sba_coverage": round(float(croston_m.coverage), 4) if croston_m and croston_m.coverage is not None else None,
            "naive_mae": round(float(naive_m.mae), 4) if naive_m else None,
            "naive_rmse": round(float(naive_m.rmse), 4) if naive_m else None,
            "naive_wape": round(float(naive_m.wape), 4) if naive_m and naive_m.wape is not None else None,
            "naive_mase": round(float(naive_m.mase), 4) if naive_m and naive_m.mase is not None else None,
            "naive_coverage": round(float(naive_m.coverage), 4) if naive_m and naive_m.coverage is not None else None,
            "global_lgbm_mae": round(float(lgbm_m.mae), 4) if lgbm_m else None,
            "global_lgbm_rmse": round(float(lgbm_m.rmse), 4) if lgbm_m else None,
            "global_lgbm_wape": round(float(lgbm_m.wape), 4) if lgbm_m and lgbm_m.wape is not None else None,
            "global_lgbm_mase": round(float(lgbm_m.mase), 4) if lgbm_m and lgbm_m.mase is not None else None,
            "global_lgbm_coverage": round(float(lgbm_m.coverage), 4) if lgbm_m and lgbm_m.coverage is not None else None,
        })

        bi = ev.baseline_improvement
        baseline_rows.append({
            "sku_id": s.sku_id,
            "chosen_model": ev.chosen_model or "SeasonalNaive",
            "mae_pct": round(float(bi.mae_pct), 4) if bi else 0.0,
            "rmse_pct": round(float(bi.rmse_pct), 4) if bi else 0.0,
            "wape_pct": round(float(bi.wape_pct), 4) if bi else 0.0,
            "coverage_minus_nominal": round(float(bi.coverage_minus_nominal), 4) if bi else 0.0,
        })

    # Summary row for OVERALL baseline improvement
    if baseline_rows:
        baseline_rows.append({
            "sku_id": "OVERALL",
            "chosen_model": "N/A",
            "mae_pct": round(float(np.mean([r["mae_pct"] for r in baseline_rows])), 4),
            "rmse_pct": round(float(np.mean([r["rmse_pct"] for r in baseline_rows])), 4),
            "wape_pct": round(float(np.mean([r["wape_pct"] for r in baseline_rows])), 4),
            "coverage_minus_nominal": round(float(np.mean([r["coverage_minus_nominal"] for r in baseline_rows])), 4),
        })

    return pd.DataFrame(model_rows), pd.DataFrame(baseline_rows)


def run_pipeline(
    series_list: List[SkuSeries],
    assumptions: Dict[str, SkuAssumptions],
    seed: int,
    budget_arg: Optional[float] = None,
    capacity_arg: Optional[float] = None,
    default_budget: Optional[float] = None,
    default_capacity: Optional[float] = None,
) -> Tuple[
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    pd.DataFrame,
    Dict[str, Any],
]:
    """
    Executes full pipeline:
      1. Model comparison & baseline improvement
      2. Optimization + Simulation + Holdout Replay (Policy Comparison)
      3. Service-level sweep
      4. Portfolio cost optimization (unconstrained vs constrained)
      5. Portfolio budget sweep (6 budgets: 40% - 100%)
      6. Demand co-movement and dependency pairs
    """
    fc_params = ForecastParams(
        horizon=28,
        season_length=7,
        n_bootstrap=500,
        block_size=7,
        min_history=56,
        origin_step=7,
        min_residual_blocks=8,
        seed=seed,
    )

    # 1. Model comparison & baseline improvement
    df_model_comp, df_baseline_imp = run_model_comparison(series_list, fc_params)

    # 2. Fit forecast, optimize, simulate, replay
    log.info("Running optimization, simulation, and holdout replay...")
    opt_params = OptimizeParams(
        n_bootstrap=500,
        block_size=7,
        bootstrap_seed=seed,
    )

    # Demand co-movement and dependency
    fc_error_stds = {}
    for s in series_list:
        a = assumptions.get(s.sku_id)
        if a:
            fc_error_stds[s.sku_id] = float(np.std(s.values, ddof=1)) if len(s.values) > 1 else 1.0
    dep_results = compute_dependency(series_list, fc_error_stds)
    log.info(
        "Demand co-movement: pooling_ratio=%.4f across %d SKUs, identified %d pairs with |rho| >= 0.3",
        dep_results["pooling_ratio"],
        len(dep_results["sku_order"]),
        len(dep_results["pairs"]),
    )

    # Format dependency pairs dataframe
    pair_rows = []
    for p in dep_results.get("pairs", []):
        pair_rows.append({
            "sku_i": str(p["sku_i"]),
            "sku_j": str(p["sku_j"]),
            "rho": round(float(p["rho"]), 4),
            "relation": str(p["relation"]),
        })
    df_dep_pairs = pd.DataFrame(pair_rows, columns=["sku_i", "sku_j", "rho", "relation"])

    sim_params = SimulateParams(
        n_scenarios=500,
        horizon_days=90,
        block_size=7,
        seed=seed,
    )
    replay_params = ReplayParams(
        seed=seed,
        holdout_days=28,
        season_length=7,
        n_bootstrap=500,
        block_size=7,
        min_history=56,
        origin_step=7,
        min_residual_blocks=8,
    )

    policy_comp_rows = []
    sweep_rows = []
    portfolio_inputs: List[PortfolioSkuInput] = []

    for s in series_list:
        sku_id = s.sku_id
        if sku_id not in assumptions:
            log.warning("No assumptions found for %s; skipping downstream policies", sku_id)
            continue
        a = assumptions[sku_id]
        y = np.asarray(s.values, dtype=float)

        # Fit forecast
        fit = fit_sku(sku_id, y, fc_params)
        if fit.status != "ok" or fit.autoets_mean is None or fit.residual_blocks is None:
            log.warning("Forecast fit failed for %s (status=%s)", sku_id, fit.status)
            continue

        resid_std = (
            fit.residual_std
            if fit.residual_std is not None
            else float(np.std(fit.residual_blocks.ravel(), ddof=1))
        )
        opt_in = OptimizeSkuInput(
            sku_id=sku_id,
            forecast_mean=fit.autoets_mean.tolist(),
            residual_blocks=fit.residual_blocks.tolist(),
            residual_std=resid_std,
        )

        # Optimize
        opt = optimize_sku(opt_in, opt_params, a)
        if (
            opt.status != "ok"
            or opt.eoq is None
            or opt.rop_deterministic is None
            or opt.rop_uncertainty_aware is None
        ):
            log.warning("Optimization failed for %s (status=%s)", sku_id, opt.status)
            continue

        eoq = opt.eoq
        rop_det = opt.rop_deterministic
        rop_unc = opt.rop_uncertainty_aware
        rop_qua = opt.rop_quantile if opt.rop_quantile is not None else rop_unc

        # Simulate on synthetic bootstrap scenarios
        sim_in = SimulateSkuInput(
            sku_id=sku_id,
            forecast_mean=fit.autoets_mean.tolist(),
            residual_blocks=fit.residual_blocks.tolist(),
            residual_std=resid_std,
            eoq=eoq,
            rop_deterministic=rop_det,
            rop_uncertainty_aware=rop_unc,
            rop_quantile=rop_qua,
        )
        sim_res = simulate_sku(sim_in, sim_params, a)

        # Replay on actual held-out 28 days
        rep_res = replay_sku(s, replay_params, a)

        # Also get detailed actual replay cost components directly from simulate_policy
        holdout_days = 28
        y_actual = y[-holdout_days:]
        demand_act = y_actual.reshape(1, -1)
        lead = max(1, int(round(a.lead_time_mean)))
        h_annual = annual_holding_cost(a)
        holding_daily = h_annual / 365.0
        order_cost = a.order_cost
        penalty = a.shortage_cost
        start_det = float(a.initial_stock) if a.initial_stock is not None else float(rop_det + eoq)
        start_unc = float(a.initial_stock) if a.initial_stock is not None else float(rop_unc + eoq)
        start_qua = float(a.initial_stock) if a.initial_stock is not None else float(rop_qua + eoq)

        act_det_sim = simulate_policy(
            demand_act, rop=float(rop_det), q=eoq, lead=lead, start_inv=start_det,
            holding_daily=holding_daily, order_cost=order_cost, penalty=penalty, warmup_days=0,
        )
        act_unc_sim = simulate_policy(
            demand_act, rop=float(rop_unc), q=eoq, lead=lead, start_inv=start_unc,
            holding_daily=holding_daily, order_cost=order_cost, penalty=penalty, warmup_days=0,
        )
        act_qua_sim = simulate_policy(
            demand_act, rop=float(rop_qua), q=eoq, lead=lead, start_inv=start_qua,
            holding_daily=holding_daily, order_cost=order_cost, penalty=penalty, warmup_days=0,
        )

        # (2) Policy comparison rows
        policies = [
            ("deterministic", rop_det, sim_res.deterministic, rep_res.deterministic, act_det_sim),
            ("uncertainty_aware", rop_unc, sim_res.uncertainty_aware, rep_res.uncertainty_aware, act_unc_sim),
            ("quantile", rop_qua, sim_res.quantile, rep_res.quantile, act_qua_sim),
        ]

        for pol_name, rop_val, sim_m, rep_m, act_m in policies:
            policy_comp_rows.append({
                "sku_id": sku_id,
                "policy": pol_name,
                "eoq": eoq,
                "rop": rop_val,
                "sim_total_cost": round(float(sim_m.total_cost_mean), 2) if sim_m else None,
                "sim_service_level": round(float(sim_m.service_level_mean), 4) if sim_m else None,
                "sim_csl": round(float(sim_m.csl), 4) if sim_m and sim_m.csl is not None else None,
                "ltd_calibration": round(float(sim_m.ltd_calibration), 4) if sim_m and sim_m.ltd_calibration is not None else None,
                "sim_holding_cost": round(float(sim_m.holding_cost_mean), 2) if sim_m else None,
                "sim_ordering_cost": round(float(sim_m.ordering_cost_mean), 2) if sim_m else None,
                "sim_shortage_cost": round(float(sim_m.shortage_cost_mean), 2) if sim_m else None,
                "sim_avg_inventory": round(float(sim_m.avg_inventory_mean), 2) if sim_m else None,
                "sim_stockout_units": round(float(sim_m.stockout_units_mean), 2) if sim_m else None,
                "actual_total_cost": round(float(act_m["total_cost"][0]), 2) if act_m is not None else (round(float(rep_m.total_cost), 2) if rep_m else None),
                "actual_service_level": round(float(act_m["service_level"][0]), 4) if act_m is not None else (round(float(rep_m.fill_rate), 4) if rep_m else None),
                "actual_csl": round(float(act_m["csl"][0]), 4) if act_m is not None else (round(float(rep_m.csl), 4) if rep_m else None),
                "actual_holding_cost": round(float(act_m["holding_cost"][0]), 2) if act_m is not None else None,
                "actual_ordering_cost": round(float(act_m["ordering_cost"][0]), 2) if act_m is not None else None,
                "actual_shortage_cost": round(float(act_m["shortage_cost"][0]), 2) if act_m is not None else None,
                "actual_avg_inventory": round(float(act_m["avg_inventory"][0]), 2) if act_m is not None else None,
                "actual_stockout_days": int(act_m["stockout_days"][0]) if act_m is not None else (int(rep_m.stockout_days) if rep_m else None),
                "actual_stockout_units": round(float(act_m["stockout_units"][0]), 2) if act_m is not None else None,
            })

        # (3) Service-level sweep rows
        if sim_res.sweep:
            for pt in sim_res.sweep.deterministic:
                sweep_rows.append({
                    "sku_id": sku_id,
                    "target_service_level": round(float(pt.service_level), 2),
                    "policy": "deterministic",
                    "rop": int(pt.rop) if pt.rop is not None else None,
                    "total_cost": round(float(pt.total_cost), 2),
                    "achieved_fill_rate": round(float(pt.fill_rate), 4),
                    "avg_inventory": round(float(pt.avg_inventory), 2) if pt.avg_inventory is not None else None,
                })
            for pt in sim_res.sweep.uncertainty_aware:
                sweep_rows.append({
                    "sku_id": sku_id,
                    "target_service_level": round(float(pt.service_level), 2),
                    "policy": "uncertainty_aware",
                    "rop": int(pt.rop) if pt.rop is not None else None,
                    "total_cost": round(float(pt.total_cost), 2),
                    "achieved_fill_rate": round(float(pt.fill_rate), 4),
                    "avg_inventory": round(float(pt.avg_inventory), 2) if pt.avg_inventory is not None else None,
                })
            if sim_res.sweep.quantile:
                for pt in sim_res.sweep.quantile:
                    sweep_rows.append({
                        "sku_id": sku_id,
                        "target_service_level": round(float(pt.service_level), 2),
                        "policy": "quantile",
                        "rop": int(pt.rop) if pt.rop is not None else None,
                        "total_cost": round(float(pt.total_cost), 2),
                        "achieved_fill_rate": round(float(pt.fill_rate), 4),
                        "avg_inventory": round(float(pt.avg_inventory), 2) if pt.avg_inventory is not None else None,
                    })

            # Prepare portfolio input curve (prefer uncertainty_aware)
            sweep_points = sim_res.sweep.uncertainty_aware or sim_res.sweep.deterministic
            curve_points: List[PortfolioCurvePoint] = []
            for p_sweep in sweep_points:
                avg_inv = (
                    p_sweep.avg_inventory
                    if p_sweep.avg_inventory is not None
                    else max(0.0, float(p_sweep.rop or 0) - (a.lead_time_mean * (opt.avg_daily_forecast or 1.0)) + eoq / 2.0)
                )
                curve_points.append(
                    PortfolioCurvePoint(
                        service_level=float(p_sweep.service_level),
                        rop=int(p_sweep.rop or 0),
                        total_cost=float(p_sweep.total_cost),
                        avg_inventory=float(avg_inv),
                        fill_rate=float(p_sweep.fill_rate),
                    )
                )

            annual_d = float(opt.annual_demand or ((opt.avg_daily_forecast or 0.0) * 365.0))
            portfolio_inputs.append(
                PortfolioSkuInput(
                    sku_id=sku_id,
                    unit_cost=float(a.unit_cost),
                    annual_demand=annual_d,
                    curve=curve_points,
                )
            )

    df_policy_comp = pd.DataFrame(policy_comp_rows)
    df_sweep = pd.DataFrame(sweep_rows)

    # 4. Constrained vs unconstrained portfolio cost
    log.info("Running (4) constrained vs unconstrained portfolio cost...")
    if not portfolio_inputs:
        log.warning("No valid SKU curves available for portfolio optimization")
        return (
            df_model_comp,
            df_baseline_imp,
            df_policy_comp,
            df_sweep,
            pd.DataFrame(),
            pd.DataFrame(),
            df_dep_pairs,
            dep_results,
        )

    # Determine budget and capacity constraints
    budget = budget_arg if budget_arg is not None else default_budget
    capacity = capacity_arg if capacity_arg is not None else default_capacity

    # Initial unconstrained check to set default binding budget if none specified
    temp_req = PortfolioRequest(skus=portfolio_inputs, budget=1e12, capacity=1e12)
    temp_res = solve_portfolio(temp_req)
    unconstrained_invest = temp_res.unconstrained_plan.total_inventory_investment

    if budget is None and capacity is None:
        # Default to a binding budget of 85% unconstrained investment
        budget = round(unconstrained_invest * 0.85, 2)
        log.info("No budget or capacity passed; applying 85%% budget constraint: %s", budget)

    port_req = PortfolioRequest(
        skus=portfolio_inputs,
        budget=budget,
        capacity=capacity,
    )
    port_res = solve_portfolio(port_req)

    unc_plan = port_res.unconstrained_plan
    con_plan = port_res.constrained_plan

    unc_map = {s.sku_id: s for s in unc_plan.skus}
    con_map = {s.sku_id: s for s in con_plan.skus}

    portfolio_rows = []
    for s_in in portfolio_inputs:
        s_id = s_in.sku_id
        u = unc_map.get(s_id)
        c = con_map.get(s_id)
        if not u or not c:
            continue
        portfolio_rows.append({
            "sku_id": s_id,
            "unconstrained_service_level": round(float(u.service_level), 4),
            "constrained_service_level": round(float(c.service_level), 4),
            "unconstrained_rop": int(u.rop),
            "constrained_rop": int(c.rop),
            "unconstrained_avg_inventory": round(float(u.avg_inventory), 2),
            "constrained_avg_inventory": round(float(c.avg_inventory), 2),
            "unconstrained_inventory_investment": round(float(u.inventory_investment), 2),
            "constrained_inventory_investment": round(float(c.inventory_investment), 2),
            "unconstrained_total_cost": round(float(u.total_cost), 2),
            "constrained_total_cost": round(float(c.total_cost), 2),
            "cost_delta": round(float(c.total_cost - u.total_cost), 2),
            "unconstrained_turnover": round(float(u.turnover), 4),
            "constrained_turnover": round(float(c.turnover), 4),
            "budget": round(float(budget), 2) if budget is not None else None,
            "capacity": round(float(capacity), 2) if capacity is not None else None,
            "budget_shadow_price": None,
            "binding_constraints": None,
        })

    # Summary row for PORTFOLIO_TOTAL
    portfolio_rows.append({
        "sku_id": "PORTFOLIO_TOTAL",
        "unconstrained_service_level": round(float(unc_plan.avg_service_level), 4),
        "constrained_service_level": round(float(con_plan.avg_service_level), 4),
        "unconstrained_rop": sum(int(u.rop) for u in unc_plan.skus),
        "constrained_rop": sum(int(c.rop) for c in con_plan.skus),
        "unconstrained_avg_inventory": round(float(unc_plan.total_units), 2),
        "constrained_avg_inventory": round(float(con_plan.total_units), 2),
        "unconstrained_inventory_investment": round(float(unc_plan.total_inventory_investment), 2),
        "constrained_inventory_investment": round(float(con_plan.total_inventory_investment), 2),
        "unconstrained_total_cost": round(float(unc_plan.total_cost), 2),
        "constrained_total_cost": round(float(con_plan.total_cost), 2),
        "cost_delta": round(float(port_res.total_cost_delta), 2),
        "unconstrained_turnover": round(float(unc_plan.turnover), 4),
        "constrained_turnover": round(float(con_plan.turnover), 4),
        "budget": round(float(budget), 2) if budget is not None else None,
        "capacity": round(float(capacity), 2) if capacity is not None else None,
        "budget_shadow_price": round(float(port_res.budget_shadow_price), 4),
        "binding_constraints": ";".join(port_res.binding_constraints) if port_res.binding_constraints else "none",
    })

    df_portfolio = pd.DataFrame(portfolio_rows)

    # 5. Portfolio budget sweep: 6 evenly spaced budgets from minimum feasible to unconstrained investment
    log.info("Running (5) portfolio budget sweep (6 budgets from min feasible to unconstrained, greedy vs exact)...")
    min_feasible_budget = sum(
        min(pt.avg_inventory * s_in.unit_cost for pt in s_in.curve)
        for s_in in portfolio_inputs
    )
    min_feasible_budget = math.ceil(min_feasible_budget * 100.0) / 100.0
    budgets = np.linspace(min_feasible_budget, unconstrained_invest, 6)
    budget_sweep_rows = []

    for b_raw in budgets:
        b_val = round(float(b_raw), 2)
        pct = round(float(b_val / unconstrained_invest), 4) if unconstrained_invest > 0 else 1.0
        b_req = PortfolioRequest(
            skus=portfolio_inputs,
            budget=b_val,
            capacity=capacity,
        )
        b_res = solve_portfolio(b_req)

        g_cost = round(float(b_res.greedy_cost), 2) if b_res.greedy_cost is not None else None
        e_cost = round(float(b_res.exact_cost), 2) if b_res.exact_cost is not None else None
        gap_pct = round(float(b_res.optimality_gap_pct), 4) if b_res.optimality_gap_pct is not None else None
        g_sl = round(float(b_res.greedy_plan.avg_service_level), 4) if b_res.greedy_plan is not None else None
        e_sl = round(float(b_res.constrained_plan.avg_service_level), 4) if b_res.constrained_plan is not None else None
        g_inv = round(float(b_res.greedy_plan.total_inventory_investment), 2) if b_res.greedy_plan is not None else None
        e_inv = round(float(b_res.constrained_plan.total_inventory_investment), 2) if b_res.constrained_plan is not None else None
        shadow_p = round(float(b_res.budget_shadow_price), 4) if b_res.budget_shadow_price is not None else 0.0

        budget_sweep_rows.append({
            "budget_pct": round(float(pct), 2),
            "budget": round(float(b_val), 2),
            "status": b_res.status,
            "greedy_cost": g_cost,
            "exact_cost": e_cost,
            "optimality_gap_pct": gap_pct,
            "greedy_avg_service_level": g_sl,
            "exact_avg_service_level": e_sl,
            "greedy_inventory_investment": g_inv,
            "exact_inventory_investment": e_inv,
            "budget_shadow_price": shadow_p,
            "binding_constraints": ";".join(b_res.binding_constraints) if b_res.binding_constraints else "none",
        })

    df_budget_sweep = pd.DataFrame(budget_sweep_rows)

    return (
        df_model_comp,
        df_baseline_imp,
        df_policy_comp,
        df_sweep,
        df_portfolio,
        df_budget_sweep,
        df_dep_pairs,
        dep_results,
    )


def df_to_markdown_table(df: pd.DataFrame) -> str:
    """Converts a pandas DataFrame to a clean markdown table string without external dependencies."""
    if df.empty:
        return "*No data available*\n"
    headers = [str(c) for c in df.columns]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for _, row in df.iterrows():
        vals = [str(v) if pd.notna(v) else "" for v in row]
        lines.append("| " + " | ".join(vals) + " |")
    return "\n".join(lines)


def generate_results_summary(
    csv_dict: Dict[str, pd.DataFrame],
    summary_path: Path,
) -> None:
    """Writes results_summary.md containing only auto-generated markdown tables of the CSV results."""
    lines = ["# Experiment Results Summary\n"]
    for title, df in csv_dict.items():
        lines.append(f"## {title}\n")
        lines.append(df_to_markdown_table(df))
        lines.append("\n")
    with open(summary_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    log.info("Saved auto-generated markdown summary -> %s", summary_path)


def save_figures(
    fig_dir: Path,
    series_list: List[SkuSeries],
    assumptions: Dict[str, SkuAssumptions],
    df_model: pd.DataFrame,
    df_policy: pd.DataFrame,
    df_sweep: pd.DataFrame,
    df_budget_sweep: pd.DataFrame,
    dep_results: Dict[str, Any],
    fc_params: ForecastParams,
) -> None:
    """
    Saves 6 matplotlib PNG figures (150 dpi) to experiments/results/figures:
      1. forecast fan chart (one smooth, one intermittent SKU)
      2. per-SKU MASE by model
      3. policy fill-rate vs cost (3 policies)
      4. service-level cost curves
      5. portfolio frontier
      6. correlation heatmap
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig_dir.mkdir(parents=True, exist_ok=True)
    log.info("Generating matplotlib PNG figures (150 dpi) in %s...", fig_dir)

    # 1. Forecast fan chart (one smooth, one intermittent SKU)
    try:
        smooth_sku = None
        intermittent_sku = None

        for s in series_list:
            y = np.asarray(s.values, dtype=float)
            d_class, _, _ = classify_demand(y)
            if d_class == "smooth" and smooth_sku is None:
                smooth_sku = s
            elif d_class in ("intermittent", "lumpy") and intermittent_sku is None:
                intermittent_sku = s

        # Fallbacks if strict classification didn't match both
        if smooth_sku is None and len(series_list) > 0:
            smooth_sku = series_list[0]
        if intermittent_sku is None and len(series_list) > 1:
            intermittent_sku = series_list[-1]

        target_skus = [("Smooth", smooth_sku), ("Intermittent", intermittent_sku)]
        fig, axes = plt.subplots(1, 2, figsize=(14, 5), dpi=150)

        for ax, (cls_name, sku_obj) in zip(axes, target_skus):
            if sku_obj is None:
                continue
            y = np.asarray(sku_obj.values, dtype=float)
            fit = fit_sku(sku_obj.sku_id, y, fc_params)
            h = fc_params.horizon

            hist_len = min(60, len(y))
            hist_y = y[-hist_len:]
            x_hist = np.arange(-hist_len + 1, 1)
            x_fc = np.arange(1, h + 1)

            ax.plot(x_hist, hist_y, color="#334155", linewidth=1.5, label="Observed Demand")

            if fit.status == "ok" and fit.autoets_mean is not None:
                p50 = fit.autoets_mean[:h]
                std = fit.residual_std if fit.residual_std is not None else float(np.std(y))
                p10 = np.maximum(0.0, p50 - 1.2816 * std)
                p90 = np.maximum(0.0, p50 + 1.2816 * std)

                ax.plot(x_fc, p50, color="#6366f1", linewidth=2.0, label="Forecast (P50)")
                ax.fill_between(
                    x_fc,
                    p10,
                    p90,
                    color="#6366f1",
                    alpha=0.25,
                    label="80% Prediction Band (P10-P90)",
                )

            ax.axvline(0, color="#94a3b8", linestyle="--", linewidth=1.0, label="Forecast Origin")
            ax.set_title(f"{cls_name} SKU: {sku_obj.sku_id}", fontsize=11, fontweight="bold")
            ax.set_xlabel("Days Relative to Forecast Origin", fontsize=9)
            ax.set_ylabel("Daily Demand (Units)", fontsize=9)
            ax.grid(True, linestyle=":", alpha=0.6)
            ax.legend(fontsize=8, loc="upper left")

        plt.tight_layout()
        p_fan = fig_dir / "forecast_fan_chart.png"
        fig.savefig(p_fan, dpi=150)
        plt.close(fig)
        log.info("Saved figure 1 -> %s", p_fan)
    except Exception as e:
        log.warning("Failed to generate forecast fan chart: %s", e)

    # 2. Per-SKU MASE by model
    try:
        candidate_cols = [
            ("SeasonalNaive", "seasonal_naive_mase", "#64748b"),
            ("AutoETS", "autoets_mase", "#3b82f6"),
            ("Naive", "naive_mase", "#94a3b8"),
            ("CrostonSBA", "croston_sba_mase", "#f59e0b"),
            ("GlobalLGBM", "global_lgbm_mase", "#8b5cf6"),
        ]
        active_cols = [
            (label, col, c) for label, col, c in candidate_cols
            if col in df_model.columns and df_model[col].notna().any()
        ]

        skus = df_model["sku_id"].tolist()
        n_skus = len(skus)
        x_indices = np.arange(n_skus)
        n_bars = len(active_cols)
        total_bar_width = 0.8
        bar_width = total_bar_width / max(1, n_bars)

        fig, ax = plt.subplots(figsize=(max(10, n_skus * 0.7), 5.5), dpi=150)
        for i, (label, col, c) in enumerate(active_cols):
            vals = df_model[col].fillna(0.0).to_numpy(dtype=float)
            offsets = x_indices - (total_bar_width / 2.0) + (i + 0.5) * bar_width
            ax.bar(offsets, vals, width=bar_width, label=label, color=c, alpha=0.85)

        ax.axhline(1.0, color="#ef4444", linestyle="--", linewidth=1.2, label="MASE = 1.0 (Baseline)")
        ax.set_xticks(x_indices)
        ax.set_xticklabels(skus, rotation=45, ha="right", fontsize=9)
        ax.set_ylabel("Rolling-Origin MASE", fontsize=10)
        ax.set_title("Per-SKU Rolling Origin MASE by Model", fontsize=12, fontweight="bold")
        ax.grid(True, linestyle=":", alpha=0.5, axis="y")
        ax.legend(fontsize=9, loc="upper right")

        plt.tight_layout()
        p_mase = fig_dir / "mase_by_model.png"
        fig.savefig(p_mase, dpi=150)
        plt.close(fig)
        log.info("Saved figure 2 -> %s", p_mase)
    except Exception as e:
        log.warning("Failed to generate MASE by model figure: %s", e)

    # 3. Policy fill-rate vs cost (3 policies)
    try:
        policy_styles = [
            ("deterministic", "Deterministic (s_det)", "#ef4444", "o"),
            ("uncertainty_aware", "Uncertainty-Aware (s_emp)", "#3b82f6", "s"),
            ("quantile", "Quantile (s_quant)", "#10b981", "^"),
        ]

        fig, ax = plt.subplots(figsize=(8.5, 6), dpi=150)
        for pol_key, pol_label, color, marker in policy_styles:
            sub = df_policy[df_policy["policy"] == pol_key]
            if sub.empty:
                continue
            x_vals = sub["sim_service_level"].to_numpy(dtype=float)
            y_vals = sub["sim_total_cost"].to_numpy(dtype=float)

            ax.scatter(x_vals, y_vals, color=color, marker=marker, s=55, alpha=0.5, label=pol_label)

            mean_x = float(np.mean(x_vals))
            mean_y = float(np.mean(y_vals))
            ax.scatter(
                [mean_x],
                [mean_y],
                color=color,
                marker=marker,
                s=180,
                edgecolors="black",
                linewidth=1.8,
                label=f"{pol_label} Mean",
            )

        ax.set_xlabel("Simulated Achieved Fill Rate", fontsize=10)
        ax.set_ylabel("Simulated Total Operational Cost (₹)", fontsize=10)
        ax.set_title("Replenishment Policy Trade-off: Fill Rate vs Total Cost", fontsize=12, fontweight="bold")
        ax.grid(True, linestyle=":", alpha=0.6)
        ax.legend(fontsize=9, loc="upper left")

        plt.tight_layout()
        p_pol = fig_dir / "policy_fill_rate_vs_cost.png"
        fig.savefig(p_pol, dpi=150)
        plt.close(fig)
        log.info("Saved figure 3 -> %s", p_pol)
    except Exception as e:
        log.warning("Failed to generate policy fill-rate vs cost figure: %s", e)

    # 4. Service-level cost curves
    try:
        fig, ax = plt.subplots(figsize=(8.5, 5.5), dpi=150)
        colors = {"deterministic": "#ef4444", "uncertainty_aware": "#3b82f6", "quantile": "#10b981"}
        labels = {"deterministic": "Deterministic", "uncertainty_aware": "Uncertainty-Aware", "quantile": "Quantile"}

        for pol in ["deterministic", "uncertainty_aware", "quantile"]:
            sub = df_sweep[df_sweep["policy"] == pol]
            if sub.empty:
                continue
            grouped = sub.groupby("target_service_level")["total_cost"].mean().reset_index()
            grouped = grouped.sort_values(by="target_service_level")

            ax.plot(
                grouped["target_service_level"],
                grouped["total_cost"],
                marker="o",
                linewidth=2.0,
                color=colors.get(pol, "#64748b"),
                label=labels.get(pol, pol),
            )

        ax.set_xlabel("Target Cycle Service Level (α)", fontsize=10)
        ax.set_ylabel("Mean Total Operational Cost (₹)", fontsize=10)
        ax.set_title("Service-Level vs Cost Trade-off Curves (α = 0.80 - 0.98)", fontsize=12, fontweight="bold")
        ax.grid(True, linestyle=":", alpha=0.6)
        ax.legend(fontsize=9, loc="upper left")

        plt.tight_layout()
        p_curves = fig_dir / "service_level_cost_curves.png"
        fig.savefig(p_curves, dpi=150)
        plt.close(fig)
        log.info("Saved figure 4 -> %s", p_curves)
    except Exception as e:
        log.warning("Failed to generate service-level cost curves: %s", e)

    # 5. Portfolio frontier (Greedy vs Exact MILP)
    try:
        fig, ax = plt.subplots(figsize=(8.5, 5.5), dpi=150)
        sub = df_budget_sweep.sort_values(by="budget")
        b_vals = sub["budget"].to_numpy(dtype=float)
        g_costs = sub["greedy_cost"].to_numpy(dtype=float)
        e_costs = sub["exact_cost"].to_numpy(dtype=float)

        ax.plot(b_vals, g_costs, "o--", color="#f97316", linewidth=2.0, label="Greedy Heuristic Cost")
        ax.plot(b_vals, e_costs, "s-", color="#6366f1", linewidth=2.2, label="Exact MILP Cost")
        ax.fill_between(b_vals, e_costs, g_costs, color="#6366f1", alpha=0.15, label="MILP Optimality Gap")

        for _, row in sub.iterrows():
            if pd.notna(row["optimality_gap_pct"]):
                ax.annotate(
                    f"{row['optimality_gap_pct']:.2f}% gap",
                    (row["budget"], row["exact_cost"]),
                    textcoords="offset points",
                    xytext=(0, -14),
                    ha="center",
                    fontsize=8,
                    color="#4f46e5",
                )

        ax.set_xlabel("Inventory Budget Limit (₹)", fontsize=10)
        ax.set_ylabel("Total Expected Portfolio Cost (₹)", fontsize=10)
        ax.set_title("Multi-SKU Portfolio Resource Allocation: Greedy vs Exact MILP", fontsize=12, fontweight="bold")
        ax.grid(True, linestyle=":", alpha=0.6)
        ax.legend(fontsize=9, loc="upper right")

        plt.tight_layout()
        p_front = fig_dir / "portfolio_frontier.png"
        fig.savefig(p_front, dpi=150)
        plt.close(fig)
        log.info("Saved figure 5 -> %s", p_front)
    except Exception as e:
        log.warning("Failed to generate portfolio frontier: %s", e)

    # 6. Correlation heatmap
    try:
        mat = np.array(dep_results.get("correlation_matrix", []))
        skus = dep_results.get("sku_order", [])
        n_skus = len(skus)

        fig, ax = plt.subplots(figsize=(max(8, n_skus * 0.55), max(7, n_skus * 0.5)), dpi=150)
        cax = ax.imshow(mat, cmap="RdBu_r", vmin=-1.0, vmax=1.0)
        cbar = fig.colorbar(cax, ax=ax, fraction=0.046, pad=0.04)
        cbar.set_label("Weekly Demand Pearson Correlation (ρ)", fontsize=9)

        ax.set_xticks(np.arange(n_skus))
        ax.set_yticks(np.arange(n_skus))
        ax.set_xticklabels(skus, rotation=45, ha="right", fontsize=8)
        ax.set_yticklabels(skus, fontsize=8)

        if n_skus <= 18:
            for i in range(n_skus):
                for j in range(n_skus):
                    val = mat[i, j]
                    color = "white" if abs(val) > 0.45 else "#1e293b"
                    ax.text(j, i, f"{val:.2f}", ha="center", va="center", color=color, fontsize=7)

        pool_ratio = dep_results.get("pooling_ratio", 1.0)
        ax.set_title(
            f"Weekly Demand Correlation Heatmap (Risk Pooling Ratio: {pool_ratio:.4f})",
            fontsize=11,
            fontweight="bold",
        )

        plt.tight_layout()
        p_corr = fig_dir / "correlation_heatmap.png"
        fig.savefig(p_corr, dpi=150)
        plt.close(fig)
        log.info("Saved figure 6 -> %s", p_corr)
    except Exception as e:
        log.warning("Failed to generate correlation heatmap: %s", e)


def main():
    parser = argparse.ArgumentParser(
        description="Run StockPilot AI numerical experiments across SKU series."
    )
    parser.add_argument(
        "--csv",
        type=str,
        required=True,
        help="Path to daily sales CSV containing SKU demand series.",
    )
    parser.add_argument(
        "--assumptions",
        type=str,
        required=False,
        default=None,
        help="Path to per-SKU JSON file defining cost and lead-time assumptions.",
    )
    parser.add_argument(
        "--tag",
        type=str,
        default=None,
        help="Tag to save results in experiments/results/<tag>/",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="experiments/results",
        help="Directory where experiment CSV results are saved (default: experiments/results).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Fixed random seed for bootstrap scenarios and optimization (default: 42).",
    )
    parser.add_argument(
        "--budget",
        type=float,
        default=None,
        help="Optional portfolio budget constraint. Overrides assumptions file if specified.",
    )
    parser.add_argument(
        "--capacity",
        type=float,
        default=None,
        help="Optional portfolio unit capacity constraint. Overrides assumptions file if specified.",
    )

    args = parser.parse_args()

    # Destination directory
    if args.tag:
        out_dir = Path("experiments/results") / args.tag
    else:
        out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    # Load data
    series_list, median_prices = load_daily_sales_csv(args.csv)

    # Load or generate distinct assumptions
    default_budget, default_capacity = None, None
    if args.assumptions and Path(args.assumptions).is_file():
        assumptions, default_budget, default_capacity = load_assumptions_json(args.assumptions)
        # Check if all series have assumptions; generate distinct if missing
        missing_skus = [s for s in series_list if s.sku_id not in assumptions]
        if missing_skus:
            gen_assump = generate_distinct_assumptions(series_list, median_prices)
            assumptions.update(gen_assump)
    else:
        assump_path = Path(args.assumptions) if args.assumptions else (out_dir / "assumptions.json")
        assumptions = generate_distinct_assumptions(series_list, median_prices)
        assump_path.parent.mkdir(parents=True, exist_ok=True)
        with open(assump_path, "w", encoding="utf-8") as f:
            json.dump([a.model_dump() for a in assumptions.values()], f, indent=2)
        log.info("Saved distinct assumptions JSON -> %s", assump_path)

    # Run experiments with fixed seed 42
    (
        df_model,
        df_baseline_imp,
        df_policy,
        df_sweep,
        df_portfolio,
        df_budget_sweep,
        df_dep_pairs,
        dep_results,
    ) = run_pipeline(
        series_list=series_list,
        assumptions=assumptions,
        seed=args.seed,
        budget_arg=args.budget,
        capacity_arg=args.capacity,
        default_budget=default_budget,
        default_capacity=default_capacity,
    )

    # 1-4. Existing CSVs
    p1 = out_dir / "model_comparison.csv"
    p2 = out_dir / "policy_comparison.csv"
    p3 = out_dir / "service_level_sweep.csv"
    p4 = out_dir / "portfolio_cost.csv"

    # 5-7. New CSVs
    p5 = out_dir / "baseline_improvement.csv"
    p6 = out_dir / "dependency_pairs.csv"
    p7 = out_dir / "portfolio_budget_sweep.csv"

    df_model.to_csv(p1, index=False)
    log.info("Saved (1) per-SKU model comparison -> %s (%d rows)", p1, len(df_model))

    df_policy.to_csv(p2, index=False)
    log.info("Saved (2) policy comparison -> %s (%d rows)", p2, len(df_policy))

    df_sweep.to_csv(p3, index=False)
    log.info("Saved (3) service-level sweep -> %s (%d rows)", p3, len(df_sweep))

    df_portfolio.to_csv(p4, index=False)
    log.info("Saved (4) portfolio cost -> %s (%d rows)", p4, len(df_portfolio))

    df_baseline_imp.to_csv(p5, index=False)
    log.info("Saved (5) baseline improvement -> %s (%d rows)", p5, len(df_baseline_imp))

    df_dep_pairs.to_csv(p6, index=False)
    log.info("Saved (6) dependency pairs -> %s (%d rows)", p6, len(df_dep_pairs))

    df_budget_sweep.to_csv(p7, index=False)
    log.info("Saved (7) portfolio budget sweep -> %s (%d rows)", p7, len(df_budget_sweep))

    # Save matplotlib figures (150 dpi) in out_dir / "figures"
    fig_dir = out_dir / "figures"
    fc_params = ForecastParams(
        horizon=28,
        season_length=7,
        n_bootstrap=500,
        block_size=7,
        min_history=56,
        origin_step=28,
        min_residual_blocks=8,
        seed=args.seed,
    )
    save_figures(
        fig_dir=fig_dir,
        series_list=series_list,
        assumptions=assumptions,
        df_model=df_model,
        df_policy=df_policy,
        df_sweep=df_sweep,
        df_budget_sweep=df_budget_sweep,
        dep_results=dep_results,
        fc_params=fc_params,
    )

    # Write results_summary.md containing only auto-generated markdown tables of the CSV results
    csv_dict = {
        "Model Comparison": df_model,
        "Baseline Improvement": df_baseline_imp,
        "Policy Comparison": df_policy,
        "Service-Level Sweep": df_sweep,
        "Portfolio Cost Allocation": df_portfolio,
        "Portfolio Budget Sweep": df_budget_sweep,
        "Demand Dependency Pairs": df_dep_pairs,
    }
    summary_path = out_dir / "results_summary.md"
    generate_results_summary(csv_dict, summary_path)
    root_summary_path = STATS_DIR.parent / "experiments" / "results_summary.md"
    if summary_path.resolve() != root_summary_path.resolve():
        try:
            generate_results_summary(csv_dict, root_summary_path)
        except Exception:
            pass

    log.info("All experiments and figure generation completed successfully.")

    # 9. Print required summary
    n_eligible = len(series_list)
    model_df = df_model[df_model["sku_id"] != "OVERALL"] if not df_model.empty else df_model
    model_counts = model_df["chosen_model"].value_counts().to_dict() if not model_df.empty else {}
    lgbm_count = model_counts.get("GlobalLGBM", 0)
    lgbm_pct = (lgbm_count / n_eligible * 100.0) if n_eligible > 0 else 0.0

    # ltd_calibration per policy
    det_ltd = df_policy[df_policy["policy"] == "deterministic"]["ltd_calibration"].dropna().mean() if not df_policy.empty else 0.0
    unc_ltd = df_policy[df_policy["policy"] == "uncertainty_aware"]["ltd_calibration"].dropna().mean() if not df_policy.empty else 0.0
    qua_ltd = df_policy[df_policy["policy"] == "quantile"]["ltd_calibration"].dropna().mean() if not df_policy.empty else 0.0

    # greedy gap at 100% budget
    row_100 = df_budget_sweep[df_budget_sweep["budget_pct"] == 1.0] if not df_budget_sweep.empty else pd.DataFrame()
    if row_100.empty and not df_budget_sweep.empty:
        row_100 = df_budget_sweep.iloc[[-1]]
    greedy_gap_100 = float(row_100["optimality_gap_pct"].values[0]) if not row_100.empty and pd.notna(row_100["optimality_gap_pct"].values[0]) else 0.0

    # feasible sweep points
    feasible_pts = int((df_budget_sweep["status"] == "optimal").sum()) if not df_budget_sweep.empty else 0
    total_sweep_pts = len(df_budget_sweep)

    print("\n" + "=" * 50)
    print("EXPERIMENT RUN SUMMARY")
    print(f"Eligible SKU count: {n_eligible}")
    print(f"Selected-model counts: {model_counts}")
    print(f"GlobalLGBM participation: {lgbm_count}/{n_eligible} ({lgbm_pct:.1f}%)")
    print(f"ltd_calibration per policy: deterministic={det_ltd:.4f}, uncertainty_aware={unc_ltd:.4f}, quantile={qua_ltd:.4f}")
    print(f"Greedy gap at 100% budget: {greedy_gap_100:.4f}%")
    print(f"Feasible sweep points: {feasible_pts}/{total_sweep_pts}")
    print("=" * 50 + "\n")


if __name__ == "__main__":
    main()
