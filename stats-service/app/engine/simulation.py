from __future__ import annotations

import hashlib
import logging
import math
from statistics import NormalDist

import numpy as np

from ..schemas import (AggregatePolicyMetrics, PairedComparison, PolicyMetrics, SimulateAggregate,
                       SimulateParams, SimulateSkuInput, SkuAssumptions, SkuSimulation, SkuSweep,
                       SweepPoint, annual_holding_cost)
from .bootstrap import generate_paths
from .inventory import sample_lead_times

log = logging.getLogger("stats.simulation")
SWEEP_SERVICE_LEVELS = [round(float(x), 2) for x in np.arange(0.80, 0.99, 0.02)]


def _sku_seed_sequence(global_seed: int, sku_id: str, stream: str | int = 0) -> np.random.SeedSequence:
    sku_hash = int.from_bytes(hashlib.blake2b(sku_id.encode("utf-8"), digest_size=8).digest(), "big")
    if isinstance(stream, str):
        stream_hash = int.from_bytes(hashlib.blake2b(stream.encode("utf-8"), digest_size=8).digest(), "big")
    else:
        stream_hash = int(stream)
    return np.random.SeedSequence([int(global_seed), sku_hash, stream_hash])


def simulate_policy(
    demand: np.ndarray,
    rop: float,
    q: int,
    lead: int,
    start_inv: float,
    holding_daily: float,
    order_cost: float,
    penalty: float,
    lead_times: np.ndarray | None = None,
    warmup_days: int = 30,
) -> dict[str, np.ndarray]:
    n, horizon_total = demand.shape
    warmup = min(warmup_days, horizon_total - 1) if horizon_total > 1 else 0
    eval_days = max(1, horizon_total - warmup)

    on_hand = np.full(n, float(start_inv))
    on_order = np.zeros(n)
    max_lead = int(lead_times.max()) if lead_times is not None else lead
    # Arrival day is t + L + 1, so buffer must accommodate horizon_total + max_lead + 2
    arrivals = np.zeros((n, horizon_total + max_lead + 2))
    lost_total = np.zeros(n)
    stockout_days = np.zeros(n)
    inv_sum = np.zeros(n)
    eval_orders = np.zeros(n)
    first_stockout_day = np.full(n, -1, dtype=int)

    # In-flight order tracking for cycle service level (CSL):
    # An order counts as stocked-out only if lost sales occur on days (order_day, arrival_day] of that order.
    # cycle dict: {"order_day": int, "arrival_day": int, "has_stockout": bool, "in_eval": bool}
    in_flight: list[list[dict[str, Any]]] = [[] for _ in range(n)]
    eval_cycle_stockouts = np.zeros(n)

    for t in range(horizon_total):
        # 1. Received morning arrivals
        received = arrivals[:, t]
        on_hand += received
        on_order -= received

        # Settle cycles that arrived on or before day t
        for i in range(n):
            if in_flight[i]:
                remaining = []
                for cyc in in_flight[i]:
                    if cyc["arrival_day"] <= t:
                        if cyc["in_eval"] and cyc["has_stockout"]:
                            eval_cycle_stockouts[i] += 1
                    else:
                        remaining.append(cyc)
                in_flight[i] = remaining

        # 2. Daily demand
        d = demand[:, t]
        sold = np.minimum(on_hand, d)
        lost = d - sold
        on_hand -= sold

        # Track first stockout day across entire run (including warm-up)
        for i in range(n):
            if lost[i] > 0 and first_stockout_day[i] == -1:
                first_stockout_day[i] = t

        # Metrics discard the first warmup_days
        if t >= warmup:
            lost_total += lost
            stockout_days += (lost > 0)
            inv_sum += on_hand

        # 3. Check CSL exposure: lost sales on days (order_day, arrival_day]
        has_lost = lost > 0
        if has_lost.any():
            for i in np.where(has_lost)[0]:
                for cyc in in_flight[i]:
                    if cyc["order_day"] < t <= cyc["arrival_day"]:
                        cyc["has_stockout"] = True

        # 4. End-of-day order placement
        position = on_hand + on_order
        trigger = position <= rop
        batches = np.floor((rop - position) / q) + 1.0
        qty = np.where(trigger, batches * q, 0.0)
        in_eval = (t >= warmup)

        if trigger.any():
            trig_idx = np.where(trigger)[0]
            for idx in trig_idx:
                l_val = int(lead_times[idx, t]) if lead_times is not None else lead
                # Arrival day = t + L + 1 (order at end of day t; exposure to demand = L days)
                arr_day = t + l_val + 1
                if arr_day < arrivals.shape[1]:
                    arrivals[idx, arr_day] += qty[idx]
                in_flight[idx].append({
                    "order_day": t,
                    "arrival_day": arr_day,
                    "has_stockout": False,
                    "in_eval": in_eval,
                })
                if in_eval:
                    eval_orders[idx] += 1

        on_order += qty

    # Settle any cycles still in-flight at end of horizon
    for i in range(n):
        for cyc in in_flight[i]:
            if cyc["in_eval"] and cyc["has_stockout"]:
                eval_cycle_stockouts[i] += 1

    # Log day-0 on-hand and first stockout day per run
    valid_so = [d for d in first_stockout_day if d >= 0]
    first_so_str = f"min={min(valid_so)}, median={int(np.median(valid_so))}" if valid_so else "none"
    log.info("Policy simulation run: day-0 on-hand=%.1f, first stockout day: %s", start_inv, first_so_str)

    # Discard warm-up from demand metrics
    total_eval_demand = demand[:, warmup:].sum(axis=1) if horizon_total > warmup else demand.sum(axis=1)
    safe_demand = np.where(total_eval_demand > 0, total_eval_demand, 1.0)
    service = np.where(total_eval_demand > 0, 1.0 - lost_total / safe_demand, 1.0)
    csl = np.where(
        eval_orders > 0,
        np.maximum(0.0, 1.0 - eval_cycle_stockouts / eval_orders),
        np.where(lost_total > 0, 0.0, 1.0),
    )
    ordering = eval_orders * order_cost
    holding = inv_sum * holding_daily
    shortage = lost_total * penalty
    stockout_rate = stockout_days / float(eval_days)
    tot_cost = ordering + holding + shortage

    return {
        "total_cost": tot_cost,
        "ordering_cost": ordering,
        "holding_cost": holding,
        "shortage_cost": shortage,
        "avg_inventory": inv_sum / float(eval_days),
        "stockout_units": lost_total,
        "stockout_days": stockout_days,
        "stockout_rate": stockout_rate,
        "stockout_day_rate": stockout_rate,
        "service_level": service,
        "fill_rate": service,
        "csl": csl,
        "CSL": csl,
        "order_count": eval_orders,
    }


def _metrics(r: dict[str, np.ndarray], ltd_calibration: float | None = None) -> PolicyMetrics:
    tc = r["total_cost"]
    fill_rate_val = float(r["fill_rate"].mean())
    csl_val = float(r["csl"].mean())
    stockout_day_rate_val = float(r["stockout_day_rate"].mean())
    total_cost_val = float(tc.mean())

    return PolicyMetrics(
        total_cost_mean=total_cost_val,
        total_cost_std=float(tc.std(ddof=1)) if tc.size > 1 else 0.0,
        total_cost_p05=float(np.percentile(tc, 5)),
        total_cost_p95=float(np.percentile(tc, 95)),
        ordering_cost_mean=float(r["ordering_cost"].mean()),
        holding_cost_mean=float(r["holding_cost"].mean()),
        shortage_cost_mean=float(r["shortage_cost"].mean()),
        avg_inventory_mean=float(r["avg_inventory"].mean()),
        stockout_units_mean=float(r["stockout_units"].mean()),
        stockout_rate_mean=stockout_day_rate_val,
        service_level_mean=fill_rate_val,
        service_level_p05=float(np.percentile(r["service_level"], 5)),
        order_count_mean=float(r["order_count"].mean()),
        fill_rate=fill_rate_val,
        csl=csl_val,
        csl_mean=csl_val,
        CSL=csl_val,
        stockout_day_rate=stockout_day_rate_val,
        total_cost=total_cost_val,
        ltd_calibration=ltd_calibration,
    )


def compute_sku_sweep(
    sku: SimulateSkuInput,
    p: SimulateParams,
    a: SkuAssumptions,
    demand: np.ndarray,
    lead_times: np.ndarray | None,
) -> SkuSweep:
    lead = max(1, int(round(a.lead_time_mean)))
    mean = np.asarray(sku.forecast_mean, dtype=float)
    avg_daily = float(mean.mean())
    blocks = np.asarray(sku.residual_blocks, dtype=float)

    mu_l = float(mean[:lead].sum())
    sigma_d = (
        float(sku.residual_std)
        if getattr(sku, "residual_std", None) is not None
        else float(np.std(blocks.ravel(), ddof=1))
    )
    sigma_sq = lead * (sigma_d ** 2) + (avg_daily ** 2) * (a.lead_time_std ** 2)
    sigma_l = math.sqrt(max(0.0, sigma_sq))

    boot_rng = np.random.default_rng(_sku_seed_sequence(p.seed, sku.sku_id, "sweep_bootstrap"))
    boot_paths = generate_paths(mean, blocks, p.n_scenarios, mean.shape[0], p.block_size, boot_rng)
    boot_lead_times = sample_lead_times(a.lead_time_mean, a.lead_time_std, p.n_scenarios, boot_rng)
    path_len = boot_paths.shape[1]
    if np.any(boot_lead_times > path_len):
        boot_lead_times = np.clip(boot_lead_times, 1, path_len)

    cum_paths = np.cumsum(boot_paths, axis=1)
    d_l = cum_paths[np.arange(p.n_scenarios), boot_lead_times - 1]
    p10_h = np.percentile(boot_paths, 10, axis=0)
    p90_h = np.percentile(boot_paths, 90, axis=0)
    p50_h = np.percentile(boot_paths, 50, axis=0)
    sigma_d_quant = float(np.mean((p90_h - p10_h) / (2.0 * 1.2816)))
    d_p50 = float(np.mean(p50_h))
    sigma_ltd_q = math.sqrt(float(a.lead_time_mean) * (sigma_d_quant ** 2) + (avg_daily ** 2) * (a.lead_time_std ** 2))

    h_annual = annual_holding_cost(a)
    holding_daily = h_annual / 365.0
    order_cost = a.order_cost
    penalty = a.shortage_cost

    init_stock = getattr(a, "initial_stock", None)
    if init_stock is None:
        init_stock = getattr(sku, "initial_stock", None)

    det_points: list[SweepPoint] = []
    emp_points: list[SweepPoint] = []
    qua_points: list[SweepPoint] = []

    for sl in SWEEP_SERVICE_LEVELS:
        z = NormalDist().inv_cdf(sl)
        rop_det = max(0, int(math.ceil(mu_l + z * sigma_l - 1e-9)))
        rop_emp = max(0, int(math.ceil(float(np.quantile(d_l, sl, method="higher")) - 1e-9)))
        rop_qua = max(0, int(math.ceil(d_p50 * float(a.lead_time_mean) + z * sigma_ltd_q - 1e-9)))

        start_det = float(init_stock) if init_stock is not None else float(rop_det + sku.eoq)
        start_emp = float(init_stock) if init_stock is not None else float(rop_emp + sku.eoq)
        start_qua = float(init_stock) if init_stock is not None else float(rop_qua + sku.eoq)

        det_sim = simulate_policy(
            demand, rop_det, sku.eoq, lead, start_det,
            holding_daily, order_cost, penalty, lead_times=lead_times, warmup_days=30,
        )
        emp_sim = simulate_policy(
            demand, rop_emp, sku.eoq, lead, start_emp,
            holding_daily, order_cost, penalty, lead_times=lead_times, warmup_days=30,
        )
        qua_sim = simulate_policy(
            demand, rop_qua, sku.eoq, lead, start_qua,
            holding_daily, order_cost, penalty, lead_times=lead_times, warmup_days=30,
        )

        det_points.append(SweepPoint(
            service_level=float(sl),
            total_cost=float(det_sim["total_cost"].mean()),
            fill_rate=float(det_sim["service_level"].mean()),
            avg_inventory=float(det_sim["avg_inventory"].mean()),
            rop=rop_det,
        ))
        emp_points.append(SweepPoint(
            service_level=float(sl),
            total_cost=float(emp_sim["total_cost"].mean()),
            fill_rate=float(emp_sim["service_level"].mean()),
            avg_inventory=float(emp_sim["avg_inventory"].mean()),
            rop=rop_emp,
        ))
        qua_points.append(SweepPoint(
            service_level=float(sl),
            total_cost=float(qua_sim["total_cost"].mean()),
            fill_rate=float(qua_sim["service_level"].mean()),
            avg_inventory=float(qua_sim["avg_inventory"].mean()),
            rop=rop_qua,
        ))

    return SkuSweep(
        sku_id=sku.sku_id,
        deterministic=det_points,
        uncertainty_aware=emp_points,
        quantile=qua_points,
    )


def simulate_sku(sku: SimulateSkuInput, p: SimulateParams, a: SkuAssumptions) -> SkuSimulation:
    blocks = np.asarray(sku.residual_blocks, dtype=float)
    rng = np.random.default_rng(_sku_seed_sequence(p.seed, sku.sku_id, "simulation_scenarios"))
    # Warm-up: simulate horizon + 30 days and discard the first 30 from all metrics
    horizon_sim = p.horizon_days + 30
    paths = generate_paths(np.asarray(sku.forecast_mean, dtype=float), blocks, p.n_scenarios, horizon_sim, p.block_size, rng)
    demand = np.rint(paths)
    rop_det = sku.s_det if getattr(sku, "s_det", None) is not None else sku.rop_deterministic
    rop_emp = sku.s_emp if getattr(sku, "s_emp", None) is not None else sku.rop_uncertainty_aware
    rop_q = (
        sku.s_quant
        if getattr(sku, "s_quant", None) is not None
        else (sku.rop_quantile if sku.rop_quantile is not None else rop_emp)
    )

    init_stock = getattr(a, "initial_stock", None)
    if init_stock is None:
        init_stock = getattr(sku, "initial_stock", None)

    start_det = float(init_stock) if init_stock is not None else float(rop_det + sku.eoq)
    start_emp = float(init_stock) if init_stock is not None else float(rop_emp + sku.eoq)
    start_qua = float(init_stock) if init_stock is not None else float(rop_q + sku.eoq)
    start_inv_reported = int(init_stock) if init_stock is not None else int(rop_emp + sku.eoq)

    lead = max(1, int(round(a.lead_time_mean)))
    h_annual = annual_holding_cost(a)
    holding_daily = h_annual / 365.0
    order_cost = a.order_cost
    penalty = a.shortage_cost

    lead_times = (
        sample_lead_times(a.lead_time_mean, a.lead_time_std, (p.n_scenarios, horizon_sim), rng)
        if a.lead_time_std > 0
        else None
    )

    det = simulate_policy(
        demand, rop_det, sku.eoq, lead, start_det,
        holding_daily, order_cost, penalty, lead_times=lead_times, warmup_days=30,
    )
    emp = simulate_policy(
        demand, rop_emp, sku.eoq, lead, start_emp,
        holding_daily, order_cost, penalty, lead_times=lead_times, warmup_days=30,
    )
    qua = simulate_policy(
        demand, rop_q, sku.eoq, lead, start_qua,
        holding_daily, order_cost, penalty, lead_times=lead_times, warmup_days=30,
    )

    # Fresh-path calibration: ltd_calibration = share of fresh-path scenarios with lead-time demand <= s
    cal_rng = np.random.default_rng(_sku_seed_sequence(p.seed, sku.sku_id, "ltd_calibration"))
    max_l = max(1, int(round(a.lead_time_mean + 4.0 * a.lead_time_std)))
    cal_paths = generate_paths(np.asarray(sku.forecast_mean, dtype=float), blocks, p.n_scenarios, max_l, p.block_size, cal_rng)
    cal_lead_times = sample_lead_times(a.lead_time_mean, a.lead_time_std, p.n_scenarios, cal_rng)
    cal_lead_times = np.clip(cal_lead_times, 1, max_l)
    cum_cal = np.cumsum(cal_paths, axis=1)
    ltd_fresh = cum_cal[np.arange(p.n_scenarios), cal_lead_times - 1]
    cal_det = float(np.mean(ltd_fresh <= rop_det))
    cal_emp = float(np.mean(ltd_fresh <= rop_emp))
    cal_qua = float(np.mean(ltd_fresh <= rop_q))

    diff = emp["total_cost"] - det["total_cost"]
    mean_diff = float(diff.mean())
    n_scen = len(diff)
    se_diff = float(diff.std(ddof=1) / math.sqrt(n_scen)) if n_scen > 1 else 0.0
    paired = PairedComparison(
        mean_total_cost_diff=mean_diff,
        share_scenarios_uncertainty_aware_cheaper=float(np.mean(diff < -1e-9)),
        share_scenarios_equal=float(np.mean(np.abs(diff) <= 1e-9)),
        ci_95_lower=float(mean_diff - 1.96 * se_diff),
        ci_95_upper=float(mean_diff + 1.96 * se_diff),
    )
    sweep = compute_sku_sweep(sku, p, a, demand, lead_times)
    m_det = _metrics(det, ltd_calibration=cal_det)
    m_emp = _metrics(emp, ltd_calibration=cal_emp)
    m_qua = _metrics(qua, ltd_calibration=cal_qua)

    return SkuSimulation(
        sku_id=sku.sku_id, start_inventory=start_inv_reported, mean_total_demand=float(demand[:, 30:].sum(axis=1).mean() if demand.shape[1] > 30 else demand.sum(axis=1).mean()),
        deterministic=m_det, uncertainty_aware=m_emp, quantile=m_qua,
        s_det=m_det, s_quant=m_qua, s_emp=m_emp,
        paired=paired,
        sweep=sweep,
    )


def _aggregate_policy(results: list[SkuSimulation], policy: str) -> AggregatePolicyMetrics:
    ms = [getattr(r, policy) for r in results if getattr(r, policy, None) is not None]
    if not ms:
        return AggregatePolicyMetrics(
            total_cost=0.0, ordering_cost=0.0, holding_cost=0.0, shortage_cost=0.0,
            avg_inventory=0.0, stockout_units=0.0, stockout_rate_mean=0.0, service_level=1.0,
            order_count=0.0, fill_rate=1.0, csl=1.0, CSL=1.0, stockout_day_rate=0.0,
            ltd_calibration=None,
        )
    demand = sum(r.mean_total_demand for r in results)
    stockout = sum(m.stockout_units_mean for m in ms)
    sl = (1.0 - stockout / demand) if demand > 0 else 1.0
    csl_vals = [m.csl for m in ms if m.csl is not None]
    csl_mean = float(np.mean(csl_vals)) if csl_vals else 1.0
    stk_rate = float(np.mean([m.stockout_rate_mean for m in ms]))
    ltd_cal_vals = [m.ltd_calibration for m in ms if m.ltd_calibration is not None]
    ltd_cal_mean = float(np.mean(ltd_cal_vals)) if ltd_cal_vals else None

    return AggregatePolicyMetrics(
        total_cost=sum(m.total_cost_mean for m in ms),
        ordering_cost=sum(m.ordering_cost_mean for m in ms),
        holding_cost=sum(m.holding_cost_mean for m in ms),
        shortage_cost=sum(m.shortage_cost_mean for m in ms),
        avg_inventory=sum(m.avg_inventory_mean for m in ms),
        stockout_units=stockout,
        stockout_rate_mean=stk_rate,
        service_level=sl,
        order_count=sum(m.order_count_mean for m in ms),
        fill_rate=sl,
        csl=csl_mean,
        CSL=csl_mean,
        stockout_day_rate=stk_rate,
        ltd_calibration=ltd_cal_mean,
    )


def aggregate(results: list[SkuSimulation]) -> SimulateAggregate:
    has_qua = all(r.quantile is not None for r in results) and len(results) > 0
    agg_det = _aggregate_policy(results, "deterministic")
    agg_emp = _aggregate_policy(results, "uncertainty_aware")
    agg_qua = _aggregate_policy(results, "quantile") if has_qua else None
    return SimulateAggregate(
        deterministic=agg_det,
        uncertainty_aware=agg_emp,
        quantile=agg_qua,
        s_det=agg_det,
        s_quant=agg_qua,
        s_emp=agg_emp,
        mean_total_cost_diff_sum=sum(r.paired.mean_total_cost_diff for r in results),
    )
