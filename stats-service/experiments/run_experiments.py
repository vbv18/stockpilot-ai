#!/usr/bin/env python3
"""
StockPilot AI - Evaluation and Experimentation CLI
Runs full-pipeline numerical experiments across historical daily series:
  (1) Per-SKU model comparison from P4 (SeasonalNaive vs AutoETS vs CrostonSBA)
  (2) Policy comparison (deterministic vs uncertainty-aware vs quantile) on simulated and actual held-out demand
  (3) Service-level sweep (0.80 - 0.98) across replenishment policies
  (4) Constrained vs unconstrained portfolio cost optimization

Outputs CSVs to experiments/results/ (or specified --output-dir).
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import os
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Ensure stats-service root is in sys.path
STATS_DIR = Path(__file__).resolve().parent.parent
if str(STATS_DIR) not in sys.path:
    sys.path.insert(0, str(STATS_DIR))

import numpy as np
import pandas as pd

from app.engine.classification import classify_demand
from app.engine.evaluation import evaluate_series
from app.engine.forecasting import fit_sku
from app.engine.inventory import optimize_sku
from app.engine.replay import replay_sku
from app.engine.simulation import simulate_policy, simulate_sku
from app.portfolio import solve_portfolio
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
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("stockpilot.experiments")


def load_daily_sales_csv(csv_path: str | Path) -> List[SkuSeries]:
    """
    Loads daily sales CSV and constructs contiguous daily SkuSeries.
    Expected columns (case-insensitive):
      - SKU: 'sku_id', 'sku', 'item_id', 'item', 'product_id'
      - Date: 'date', 'ds', 'timestamp', 'day'
      - Quantity: 'quantity', 'qty', 'sales', 'units', 'demand', 'y', 'volume'
    """
    csv_file = Path(csv_path)
    if not csv_file.is_file():
        raise FileNotFoundError(f"Daily sales CSV not found: {csv_file}")

    df = pd.read_csv(csv_file)
    col_map = {str(c).lower().strip(): c for c in df.columns}

    sku_candidates = ["sku_id", "sku", "item_id", "item", "product_id"]
    date_candidates = ["date", "ds", "timestamp", "day"]
    qty_candidates = ["quantity", "qty", "sales", "units", "demand", "y", "volume"]

    sku_col = next((col_map[c] for c in sku_candidates if c in col_map), None)
    date_col = next((col_map[c] for c in date_candidates if c in col_map), None)
    qty_col = next((col_map[c] for c in qty_candidates if c in col_map), None)

    if not sku_col or not date_col or not qty_col:
        raise ValueError(
            f"CSV must contain SKU, date, and quantity columns. "
            f"Found columns: {list(df.columns)}. "
            f"Resolved: sku='{sku_col}', date='{date_col}', quantity='{qty_col}'"
        )

    df[sku_col] = df[sku_col].astype(str).str.strip()
    df[date_col] = pd.to_datetime(df[date_col], errors="coerce")
    df = df.dropna(subset=[date_col])
    df[qty_col] = pd.to_numeric(df[qty_col], errors="coerce").fillna(0.0)
    df[qty_col] = np.clip(df[qty_col].to_numpy(dtype=float), 0.0, None)

    # Group daily
    grouped = (
        df.groupby([sku_col, df[date_col].dt.normalize()])[qty_col]
        .sum()
        .reset_index()
    )

    series_list: List[SkuSeries] = []
    unique_skus = sorted(grouped[sku_col].unique())

    for sku_id in unique_skus:
        sku_df = grouped[grouped[sku_col] == sku_id].sort_values(by=date_col)
        if sku_df.empty:
            continue

        min_date = sku_df[date_col].min()
        max_date = sku_df[date_col].max()
        full_idx = pd.date_range(start=min_date, end=max_date, freq="D")

        sku_series = (
            sku_df.set_index(date_col)[qty_col]
            .reindex(full_idx, fill_value=0.0)
        )
        values = sku_series.to_numpy(dtype=float).tolist()

        series_list.append(
            SkuSeries(
                sku_id=sku_id,
                start_date=min_date.date(),
                values=values,
            )
        )

    log.info("Loaded %d SKU series from %s", len(series_list), csv_file)
    return series_list


def load_assumptions_json(
    json_path: str | Path,
) -> Tuple[Dict[str, SkuAssumptions], Optional[float], Optional[float]]:
    """
    Loads per-SKU assumptions JSON. Supports both direct mapping and wrapped format:
      { "sku_id": { ... } }
      or
      { "skus": { "sku_id": { ... } }, "budget": 50000, "capacity": 2000 }
    """
    assump_file = Path(json_path)
    if not assump_file.is_file():
        raise FileNotFoundError(f"Assumptions JSON not found: {assump_file}")

    with open(assump_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    budget: Optional[float] = None
    capacity: Optional[float] = None

    if isinstance(data, dict) and "skus" in data and isinstance(data["skus"], dict):
        raw_skus = data["skus"]
        if "budget" in data and data["budget"] is not None:
            budget = float(data["budget"])
        if "capacity" in data and data["capacity"] is not None:
            capacity = float(data["capacity"])
    elif isinstance(data, dict):
        raw_skus = data
    else:
        raise ValueError("Assumptions file must be a JSON object mapping SKU IDs to assumptions.")

    assumptions: Dict[str, SkuAssumptions] = {}
    for sku_id, fields in raw_skus.items():
        if not isinstance(fields, dict):
            continue
        # Ensure lead_time_std default
        payload = dict(fields)
        if "lead_time_std" not in payload:
            payload["lead_time_std"] = 0.0
        assumptions[str(sku_id)] = SkuAssumptions.model_validate(payload)

    log.info("Loaded assumptions for %d SKUs from %s", len(assumptions), assump_file)
    return assumptions, budget, capacity


def run_model_comparison(
    series_list: List[SkuSeries],
    fc_params: ForecastParams,
) -> pd.DataFrame:
    """
    (1) per-SKU model comparison from P4:
    Evaluates SeasonalNaive, AutoETS, and CrostonSBA (for intermittent/lumpy) across rolling origins.
    """
    log.info("Running (1) per-SKU model comparison from P4...")
    rows = []
    for s in series_list:
        y = np.asarray(s.values, dtype=float)
        d_class, adi, cv2 = classify_demand(y)
        ev = evaluate_series(s.sku_id, s.start_date, y, fc_params)

        sn_m = ev.seasonal_naive
        ets_m = ev.autoets
        croston_m = ev.croston_sba

        rows.append({
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
        })

    return pd.DataFrame(rows)


def run_pipeline(
    series_list: List[SkuSeries],
    assumptions: Dict[str, SkuAssumptions],
    seed: int,
    budget_arg: Optional[float] = None,
    capacity_arg: Optional[float] = None,
    default_budget: Optional[float] = None,
    default_capacity: Optional[float] = None,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """
    Executes:
      1. Model comparison
      2. Optimization + Simulation + Holdout Replay (Policy Comparison)
      3. Service-level sweep
      4. Portfolio cost optimization (unconstrained vs constrained)
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

    # 1. Model comparison
    df_model_comp = run_model_comparison(series_list, fc_params)

    # 2. Fit forecast, optimize, simulate, replay
    log.info("Running optimization, simulation, and holdout replay...")
    opt_params = OptimizeParams(
        n_bootstrap=500,
        block_size=7,
        bootstrap_seed=seed,
    )
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
        holding_daily = a.holding_cost_annual / 365.0
        order_cost = a.ordering_cost
        penalty = a.shortage_penalty

        act_det_sim = simulate_policy(
            demand_act, rop=float(rop_det), q=eoq, lead=lead, start_inv=float(rop_det),
            holding_daily=holding_daily, order_cost=order_cost, penalty=penalty,
        )
        act_unc_sim = simulate_policy(
            demand_act, rop=float(rop_unc), q=eoq, lead=lead, start_inv=float(rop_unc),
            holding_daily=holding_daily, order_cost=order_cost, penalty=penalty,
        )
        act_qua_sim = simulate_policy(
            demand_act, rop=float(rop_qua), q=eoq, lead=lead, start_inv=float(rop_qua),
            holding_daily=holding_daily, order_cost=order_cost, penalty=penalty,
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
                "sim_holding_cost": round(float(sim_m.holding_cost_mean), 2) if sim_m else None,
                "sim_ordering_cost": round(float(sim_m.ordering_cost_mean), 2) if sim_m else None,
                "sim_shortage_cost": round(float(sim_m.shortage_cost_mean), 2) if sim_m else None,
                "sim_avg_inventory": round(float(sim_m.avg_inventory_mean), 2) if sim_m else None,
                "sim_stockout_units": round(float(sim_m.stockout_units_mean), 2) if sim_m else None,
                "actual_total_cost": round(float(act_m["total_cost"][0]), 2) if act_m is not None else (round(float(rep_m.total_cost), 2) if rep_m else None),
                "actual_service_level": round(float(act_m["service_level"][0]), 4) if act_m is not None else (round(float(rep_m.fill_rate), 4) if rep_m else None),
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
        df_portfolio = pd.DataFrame()
        return df_model_comp, df_policy_comp, df_sweep, df_portfolio

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
    return df_model_comp, df_policy_comp, df_sweep, df_portfolio


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
        required=True,
        help="Path to per-SKU JSON file defining cost and lead-time assumptions.",
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

    # Load data
    series_list = load_daily_sales_csv(args.csv)
    assumptions, default_budget, default_capacity = load_assumptions_json(args.assumptions)

    # Run experiments
    df_model, df_policy, df_sweep, df_portfolio = run_pipeline(
        series_list=series_list,
        assumptions=assumptions,
        seed=args.seed,
        budget_arg=args.budget,
        capacity_arg=args.capacity,
        default_budget=default_budget,
        default_capacity=default_capacity,
    )

    # Write output CSVs
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    p1 = out_dir / "model_comparison.csv"
    p2 = out_dir / "policy_comparison.csv"
    p3 = out_dir / "service_level_sweep.csv"
    p4 = out_dir / "portfolio_cost.csv"

    df_model.to_csv(p1, index=False)
    log.info("Saved (1) per-SKU model comparison -> %s (%d rows)", p1, len(df_model))

    df_policy.to_csv(p2, index=False)
    log.info("Saved (2) policy comparison -> %s (%d rows)", p2, len(df_policy))

    df_sweep.to_csv(p3, index=False)
    log.info("Saved (3) service-level sweep -> %s (%d rows)", p3, len(df_sweep))

    df_portfolio.to_csv(p4, index=False)
    log.info("Saved (4) portfolio cost -> %s (%d rows)", p4, len(df_portfolio))

    log.info("All experiments completed successfully.")


if __name__ == "__main__":
    main()
