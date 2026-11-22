from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np

from ..schemas import (AggregatePolicyMetrics, PairedComparison, PolicyMetrics, SimulateAggregate,
                       SimulateParams, SimulateSkuInput, SkuAssumptions, SkuSimulation, SkuSweep,
                       SweepPoint)
from .bootstrap import generate_paths
from .inventory import sample_lead_times
from .seeds import derive_seed

SWEEP_SERVICE_LEVELS = [round(float(x), 2) for x in np.arange(0.80, 0.99, 0.02)]


def simulate_policy(demand: np.ndarray, rop: float, q: int, lead: int, start_inv: float,
                    holding_daily: float, order_cost: float, penalty: float,
                    lead_times: np.ndarray | None = None) -> dict[str, np.ndarray]:
    n, horizon = demand.shape
    on_hand = np.full(n, float(start_inv))
    on_order = np.zeros(n)
    max_lead = int(lead_times.max()) if lead_times is not None else lead
    arrivals = np.zeros((n, horizon + max_lead + 2))
    lost_total = np.zeros(n)
    stockout_days = np.zeros(n)
    inv_sum = np.zeros(n)
    orders = np.zeros(n)

    for t in range(horizon):
        received = arrivals[:, t]
        on_hand += received
        on_order -= received
        d = demand[:, t]
        sold = np.minimum(on_hand, d)
        lost = d - sold
        on_hand -= sold
        lost_total += lost
        stockout_days += (lost > 0)
        inv_sum += on_hand
        position = on_hand + on_order
        trigger = position <= rop
        batches = np.floor((rop - position) / q) + 1.0
        qty = np.where(trigger, batches * q, 0.0)
        if trigger.any():
            if lead_times is not None:
                idx = np.where(trigger)[0]
                arrivals[idx, t + lead_times[idx, t] + 1] += qty[idx]
            else:
                arrivals[:, t + lead + 1] += qty
        on_order += qty
        orders += trigger

    total_demand = demand.sum(axis=1)
    safe_demand = np.where(total_demand > 0, total_demand, 1.0)
    service = np.where(total_demand > 0, 1.0 - lost_total / safe_demand, 1.0)
    ordering = orders * order_cost
    holding = inv_sum * holding_daily
    shortage = lost_total * penalty
    return {
        "total_cost": ordering + holding + shortage,
        "ordering_cost": ordering,
        "holding_cost": holding,
        "shortage_cost": shortage,
        "avg_inventory": inv_sum / horizon,
        "stockout_units": lost_total,
        "stockout_days": stockout_days,
        "stockout_rate": stockout_days / horizon,
        "service_level": service,
        "order_count": orders,
    }


def _metrics(r: dict[str, np.ndarray]) -> PolicyMetrics:
    tc = r["total_cost"]
    return PolicyMetrics(
        total_cost_mean=float(tc.mean()),
        total_cost_std=float(tc.std(ddof=1)) if tc.size > 1 else 0.0,
        total_cost_p05=float(np.percentile(tc, 5)),
        total_cost_p95=float(np.percentile(tc, 95)),
        ordering_cost_mean=float(r["ordering_cost"].mean()),
        holding_cost_mean=float(r["holding_cost"].mean()),
        shortage_cost_mean=float(r["shortage_cost"].mean()),
        avg_inventory_mean=float(r["avg_inventory"].mean()),
        stockout_units_mean=float(r["stockout_units"].mean()),
        stockout_rate_mean=float(r["stockout_rate"].mean()),
        service_level_mean=float(r["service_level"].mean()),
        service_level_p05=float(np.percentile(r["service_level"], 5)),
        order_count_mean=float(r["order_count"].mean()),
    )


def compute_sku_sweep(
    sku: SimulateSkuInput,
    p: SimulateParams,
    a: SkuAssumptions,
    demand: np.ndarray,
    lead_times: np.ndarray | None,
) -> SkuSweep:
    lead = a.lead_time_mean
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

    boot_rng = np.random.default_rng(derive_seed(p.seed, sku.sku_id, "bootstrap"))
    boot_paths = generate_paths(mean, blocks, p.n_scenarios, mean.shape[0], p.block_size, boot_rng)
    boot_lead_times = sample_lead_times(a.lead_time_mean, a.lead_time_std, p.n_scenarios, boot_rng)
    max_l = int(boot_lead_times.max())
    if max_l > boot_paths.shape[1]:
        extra = generate_paths(mean, blocks, p.n_scenarios, max_l - boot_paths.shape[1], p.block_size, boot_rng)
        boot_paths = np.concatenate([boot_paths, extra], axis=1)

    cum_paths = np.cumsum(boot_paths, axis=1)
    d_l = cum_paths[np.arange(p.n_scenarios), boot_lead_times - 1]
    q10, q90 = np.percentile(d_l, [10, 90])
    ltd_mean = float(d_l.mean())
    sigma_est = (q90 - q10) / 2.563

    holding_daily = a.holding_cost_annual / 365.0
    order_cost = a.ordering_cost
    penalty = a.shortage_penalty

    det_points: list[SweepPoint] = []
    emp_points: list[SweepPoint] = []
    qua_points: list[SweepPoint] = []

    for sl in SWEEP_SERVICE_LEVELS:
        z = NormalDist().inv_cdf(sl)
        rop_det = max(0, int(math.ceil(mu_l + z * sigma_l - 1e-9)))
        rop_emp = max(0, int(math.ceil(float(np.quantile(d_l, sl, method="higher")) - 1e-9)))
        rop_qua = max(0, int(math.ceil(ltd_mean + z * sigma_est - 1e-9)))

        start_inv = float(math.ceil(max(rop_det, rop_emp, rop_qua) + sku.eoq))

        det_sim = simulate_policy(
            demand, rop_det, sku.eoq, lead, start_inv,
            holding_daily, order_cost, penalty, lead_times=lead_times,
        )
        emp_sim = simulate_policy(
            demand, rop_emp, sku.eoq, lead, start_inv,
            holding_daily, order_cost, penalty, lead_times=lead_times,
        )
        qua_sim = simulate_policy(
            demand, rop_qua, sku.eoq, lead, start_inv,
            holding_daily, order_cost, penalty, lead_times=lead_times,
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
    rng = np.random.default_rng(derive_seed(p.seed, sku.sku_id, "scenarios"))
    paths = generate_paths(np.asarray(sku.forecast_mean, dtype=float), blocks, p.n_scenarios, p.horizon_days, p.block_size, rng)
    demand = np.rint(paths)
    rop_q = sku.rop_quantile if sku.rop_quantile is not None else sku.rop_uncertainty_aware
    start_inv = float(math.ceil(max(sku.rop_deterministic, sku.rop_uncertainty_aware, rop_q) + sku.eoq))

    lead = a.lead_time_mean
    holding_daily = a.holding_cost_annual / 365.0
    order_cost = a.ordering_cost
    penalty = a.shortage_penalty

    lead_times = (
        sample_lead_times(a.lead_time_mean, a.lead_time_std, (p.n_scenarios, p.horizon_days), rng)
        if a.lead_time_std > 0
        else None
    )

    det = simulate_policy(demand, sku.rop_deterministic, sku.eoq, lead, start_inv,
                          holding_daily, order_cost, penalty, lead_times=lead_times)
    emp = simulate_policy(demand, sku.rop_uncertainty_aware, sku.eoq, lead, start_inv,
                          holding_daily, order_cost, penalty, lead_times=lead_times)
    qua = simulate_policy(demand, rop_q, sku.eoq, lead, start_inv,
                          holding_daily, order_cost, penalty, lead_times=lead_times)

    diff = emp["total_cost"] - det["total_cost"]
    paired = PairedComparison(
        mean_total_cost_diff=float(diff.mean()),
        share_scenarios_uncertainty_aware_cheaper=float(np.mean(diff < -1e-9)),
        share_scenarios_equal=float(np.mean(np.abs(diff) <= 1e-9)),
    )
    sweep = compute_sku_sweep(sku, p, a, demand, lead_times)
    return SkuSimulation(
        sku_id=sku.sku_id, start_inventory=int(start_inv), mean_total_demand=float(demand.sum(axis=1).mean()),
        deterministic=_metrics(det), uncertainty_aware=_metrics(emp), quantile=_metrics(qua), paired=paired,
        sweep=sweep,
    )


def _aggregate_policy(results: list[SkuSimulation], policy: str) -> AggregatePolicyMetrics:
    ms = [getattr(r, policy) for r in results]
    demand = sum(r.mean_total_demand for r in results)
    stockout = sum(m.stockout_units_mean for m in ms)
    return AggregatePolicyMetrics(
        total_cost=sum(m.total_cost_mean for m in ms),
        ordering_cost=sum(m.ordering_cost_mean for m in ms),
        holding_cost=sum(m.holding_cost_mean for m in ms),
        shortage_cost=sum(m.shortage_cost_mean for m in ms),
        avg_inventory=sum(m.avg_inventory_mean for m in ms),
        stockout_units=stockout,
        stockout_rate_mean=float(np.mean([m.stockout_rate_mean for m in ms])),
        service_level=(1.0 - stockout / demand) if demand > 0 else 1.0,
        order_count=sum(m.order_count_mean for m in ms),
    )


def aggregate(results: list[SkuSimulation]) -> SimulateAggregate:
    has_qua = all(r.quantile is not None for r in results) and len(results) > 0
    return SimulateAggregate(
        deterministic=_aggregate_policy(results, "deterministic"),
        uncertainty_aware=_aggregate_policy(results, "uncertainty_aware"),
        quantile=_aggregate_policy(results, "quantile") if has_qua else None,
        mean_total_cost_diff_sum=sum(r.paired.mean_total_cost_diff for r in results),
    )
