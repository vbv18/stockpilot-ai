from __future__ import annotations

import math

import numpy as np

from ..schemas import (AggregatePolicyMetrics, PairedComparison, PolicyMetrics, SimulateAggregate,
                       SimulateParams, SimulateSkuInput, SkuSimulation)
from .bootstrap import generate_paths
from .seeds import derive_seed


def simulate_policy(demand: np.ndarray, rop: float, q: int, lead: int, start_inv: float,
                    holding_daily: float, order_cost: float, penalty: float) -> dict[str, np.ndarray]:
    n, horizon = demand.shape
    on_hand = np.full(n, float(start_inv))
    on_order = np.zeros(n)
    arrivals = np.zeros((n, horizon + lead + 2))
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


def simulate_sku(sku: SimulateSkuInput, p: SimulateParams) -> SkuSimulation:
    blocks = np.asarray(sku.residual_blocks, dtype=float)
    rng = np.random.default_rng(derive_seed(p.seed, sku.sku_id, "scenarios"))
    paths = generate_paths(np.asarray(sku.forecast_mean, dtype=float), blocks, p.n_scenarios, p.horizon_days, p.block_size, rng)
    demand = np.rint(paths)
    start_inv = float(math.ceil(max(sku.rop_deterministic, sku.rop_uncertainty_aware) + sku.eoq))

    det = simulate_policy(demand, sku.rop_deterministic, sku.eoq, p.lead_time_days, start_inv,
                          p.holding_cost_daily, p.ordering_cost, p.shortage_penalty)
    emp = simulate_policy(demand, sku.rop_uncertainty_aware, sku.eoq, p.lead_time_days, start_inv,
                          p.holding_cost_daily, p.ordering_cost, p.shortage_penalty)

    diff = emp["total_cost"] - det["total_cost"]
    paired = PairedComparison(
        mean_total_cost_diff=float(diff.mean()),
        share_scenarios_uncertainty_aware_cheaper=float(np.mean(diff < -1e-9)),
        share_scenarios_equal=float(np.mean(np.abs(diff) <= 1e-9)),
    )
    return SkuSimulation(
        sku_id=sku.sku_id, start_inventory=int(start_inv), mean_total_demand=float(demand.sum(axis=1).mean()),
        deterministic=_metrics(det), uncertainty_aware=_metrics(emp), paired=paired,
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
    return SimulateAggregate(
        deterministic=_aggregate_policy(results, "deterministic"),
        uncertainty_aware=_aggregate_policy(results, "uncertainty_aware"),
        mean_total_cost_diff_sum=sum(r.paired.mean_total_cost_diff for r in results),
    )
