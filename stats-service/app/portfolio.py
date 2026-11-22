from __future__ import annotations

import math
from typing import Optional

from .engine.meta import RunClock
from .schemas import (
    PortfolioCurvePoint,
    PortfolioPlanSummary,
    PortfolioRequest,
    PortfolioResponse,
    PortfolioSkuInput,
    SkuPortfolioPlan,
)


def solve_portfolio(req: PortfolioRequest) -> PortfolioResponse:
    clock = RunClock()
    budget = req.budget
    capacity = req.capacity

    # Sort each SKU's curve points by service_level ascending
    skus_data: list[tuple[PortfolioSkuInput, list[PortfolioCurvePoint]]] = []
    for s in req.skus:
        sorted_curve = sorted(s.curve, key=lambda p: p.service_level)
        skus_data.append((s, sorted_curve))

    # 1. Unconstrained per-SKU solution:
    # For each SKU, pick the service level on its sweep curve that minimizes total expected cost
    unconstrained_indices: list[int] = []
    for s, curve in skus_data:
        best_idx = 0
        min_cost = curve[0].total_cost
        for idx, pt in enumerate(curve):
            if pt.total_cost < min_cost - 1e-9:
                min_cost = pt.total_cost
                best_idx = idx
            elif abs(pt.total_cost - min_cost) <= 1e-9:
                # Break ties with lower average inventory
                if pt.avg_inventory < curve[best_idx].avg_inventory:
                    best_idx = idx
        unconstrained_indices.append(best_idx)

    def build_plan_summary(indices: list[int]) -> PortfolioPlanSummary:
        sku_plans: list[SkuPortfolioPlan] = []
        tot_cost = 0.0
        tot_investment = 0.0
        tot_units = 0.0
        tot_sl = 0.0
        tot_annual_demand = 0.0

        for (s, curve), idx in zip(skus_data, indices):
            pt = curve[idx]
            inv = max(0.0, float(pt.avg_inventory))
            inv_invest = inv * float(s.unit_cost)
            cost = float(pt.total_cost)
            turnover = (float(s.annual_demand) / inv) if inv > 1e-9 else 0.0

            tot_cost += cost
            tot_investment += inv_invest
            tot_units += inv
            tot_sl += float(pt.service_level)
            tot_annual_demand += float(s.annual_demand)

            sku_plans.append(
                SkuPortfolioPlan(
                    sku_id=s.sku_id,
                    service_level=float(pt.service_level),
                    rop=int(pt.rop),
                    avg_inventory=inv,
                    inventory_investment=inv_invest,
                    total_cost=cost,
                    turnover=turnover,
                )
            )

        n = len(sku_plans)
        avg_sl = (tot_sl / n) if n > 0 else 0.0
        plan_turnover = (tot_annual_demand / tot_units) if tot_units > 1e-9 else 0.0

        return PortfolioPlanSummary(
            skus=sku_plans,
            total_cost=tot_cost,
            total_inventory_investment=tot_investment,
            total_units=tot_units,
            avg_service_level=avg_sl,
            turnover=plan_turnover,
        )

    unconstrained_plan = build_plan_summary(unconstrained_indices)

    # Check feasibility of unconstrained plan
    budget_ok = budget is None or unconstrained_plan.total_inventory_investment <= budget + 1e-6
    capacity_ok = capacity is None or unconstrained_plan.total_units <= capacity + 1e-6

    if budget_ok and capacity_ok:
        budget_usage_pct = (
            (unconstrained_plan.total_inventory_investment / budget * 100.0)
            if budget is not None and budget > 0
            else None
        )
        capacity_usage_pct = (
            (unconstrained_plan.total_units / capacity * 100.0)
            if capacity is not None and capacity > 0
            else None
        )
        return PortfolioResponse(
            run_meta=clock.meta(0),
            unconstrained_plan=unconstrained_plan,
            constrained_plan=unconstrained_plan,
            total_cost_delta=0.0,
            binding_constraints=[],
            budget_shadow_price=0.0,
            budget=budget,
            capacity=capacity,
            budget_usage_pct=budget_usage_pct,
            capacity_usage_pct=capacity_usage_pct,
        )

    # 2. Greedy marginal-cost-per-resource allocation starting from the lowest service level
    curr_indices = [0 for _ in skus_data]
    curr_inv_cost = sum(curve[0].avg_inventory * s.unit_cost for s, curve in skus_data)
    curr_units = sum(curve[0].avg_inventory for _, curve in skus_data)

    last_budget_ratio: Optional[float] = None
    blocked_by_budget = False
    blocked_by_capacity = False
    best_blocked_budget_ratio: Optional[float] = None

    while True:
        best_sku_idx: Optional[int] = None
        best_score = -1.0
        best_d_budget = 0.0
        best_d_units = 0.0
        best_d_cost = 0.0

        for i, ((s, curve), u_idx) in enumerate(zip(skus_data, unconstrained_indices)):
            c_idx = curr_indices[i]
            if c_idx >= u_idx or c_idx >= len(curve) - 1:
                continue

            curr_pt = curve[c_idx]
            next_pt = curve[c_idx + 1]

            d_cost = next_pt.total_cost - curr_pt.total_cost
            cost_reduction = -d_cost
            if cost_reduction <= 1e-9:
                continue

            d_units = max(0.0, next_pt.avg_inventory - curr_pt.avg_inventory)
            d_budget = d_units * s.unit_cost

            # Check feasibility
            step_violates_budget = (budget is not None) and (curr_inv_cost + d_budget > budget + 1e-6)
            step_violates_capacity = (capacity is not None) and (curr_units + d_units > capacity + 1e-6)

            if step_violates_budget:
                blocked_by_budget = True
                if d_budget > 1e-9:
                    ratio = cost_reduction / d_budget
                    if best_blocked_budget_ratio is None or ratio > best_blocked_budget_ratio:
                        best_blocked_budget_ratio = ratio

            if step_violates_capacity:
                blocked_by_capacity = True

            if step_violates_budget or step_violates_capacity:
                continue

            # Step is feasible. Compute marginal score
            if budget is not None and capacity is not None:
                res_fraction = max(d_budget / budget, d_units / capacity)
                score = cost_reduction / max(res_fraction, 1e-12)
            elif budget is not None:
                score = cost_reduction / max(d_budget, 1e-9)
            else:
                score = cost_reduction / max(d_units, 1e-9)

            if score > best_score:
                best_score = score
                best_sku_idx = i
                best_d_budget = d_budget
                best_d_units = d_units
                best_d_cost = d_cost

        if best_sku_idx is None:
            break

        curr_indices[best_sku_idx] += 1
        curr_inv_cost += best_d_budget
        curr_units += best_d_units
        if best_d_budget > 1e-9:
            last_budget_ratio = (-best_d_cost) / best_d_budget

    constrained_plan = build_plan_summary(curr_indices)
    cost_delta = max(0.0, constrained_plan.total_cost - unconstrained_plan.total_cost)

    # Check which constraints bind
    binding_constraints: list[str] = []
    is_tight_budget = (budget is not None) and (
        constrained_plan.total_inventory_investment >= budget - 1.0
        or (constrained_plan.total_inventory_investment / budget) >= 0.98
    )
    is_tight_capacity = (capacity is not None) and (
        constrained_plan.total_units >= capacity - 1.0
        or (constrained_plan.total_units / capacity) >= 0.98
    )

    if budget is not None and (blocked_by_budget or is_tight_budget):
        binding_constraints.append("budget")
    if capacity is not None and (blocked_by_capacity or is_tight_capacity):
        binding_constraints.append("capacity")

    # Budget shadow price (cost change per extra unit of budget)
    if "budget" in binding_constraints:
        rate = best_blocked_budget_ratio if best_blocked_budget_ratio is not None else last_budget_ratio
        shadow_price = -float(rate) if rate is not None else 0.0
    else:
        shadow_price = 0.0

    budget_usage_pct = (
        (constrained_plan.total_inventory_investment / budget * 100.0)
        if budget is not None and budget > 0
        else None
    )
    capacity_usage_pct = (
        (constrained_plan.total_units / capacity * 100.0)
        if capacity is not None and capacity > 0
        else None
    )

    return PortfolioResponse(
        run_meta=clock.meta(0),
        unconstrained_plan=unconstrained_plan,
        constrained_plan=constrained_plan,
        total_cost_delta=cost_delta,
        binding_constraints=binding_constraints,
        budget_shadow_price=shadow_price,
        budget=budget,
        capacity=capacity,
        budget_usage_pct=budget_usage_pct,
        capacity_usage_pct=capacity_usage_pct,
    )
