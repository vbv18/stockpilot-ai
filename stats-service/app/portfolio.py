from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp

from .engine.meta import RunClock
from .schemas import (
    PortfolioCurvePoint,
    PortfolioPlanSummary,
    PortfolioRequest,
    PortfolioResponse,
    PortfolioSkuInput,
    SkuPortfolioPlan,
)


class ExactResult:
    def __init__(
        self,
        greedy_cost: Optional[float],
        exact_cost: Optional[float],
        optimality_gap_pct: Optional[float],
        chosen_alphas: Optional[dict[str, float]],
        status: str = "optimal",
        minimum_feasible_budget: Optional[float] = None,
        shadow_price: Optional[float] = None,
        exact_indices: Optional[list[int]] = None,
        greedy_indices: Optional[list[int]] = None,
        exact_plan: Optional[PortfolioPlanSummary] = None,
        greedy_plan: Optional[PortfolioPlanSummary] = None,
    ):
        self.greedy_cost = greedy_cost
        self.exact_cost = exact_cost
        self.optimality_gap_pct = optimality_gap_pct
        self.chosen_alphas = chosen_alphas if chosen_alphas is not None else {}
        self.status = status
        self.minimum_feasible_budget = minimum_feasible_budget
        self.shadow_price = shadow_price
        self.exact_indices = exact_indices
        self.greedy_indices = greedy_indices
        self.exact_plan = exact_plan
        self.greedy_plan = greedy_plan

    def __iter__(self):
        yield self.greedy_cost
        yield self.exact_cost
        yield self.optimality_gap_pct
        yield self.chosen_alphas

    def __getitem__(self, item: Any) -> Any:
        if isinstance(item, int):
            return [
                self.greedy_cost,
                self.exact_cost,
                self.optimality_gap_pct,
                self.chosen_alphas,
            ][item]
        return getattr(self, item)


class _NormalizedSku:
    def __init__(
        self,
        sku_id: str,
        unit_cost: float,
        annual_demand: float,
        curve: list[PortfolioCurvePoint],
    ):
        self.sku_id = sku_id
        self.unit_cost = unit_cost
        self.annual_demand = annual_demand
        self.curve = curve


def _normalize_curves(
    curves: Any,
) -> list[tuple[_NormalizedSku, list[PortfolioCurvePoint]]]:
    skus_data: list[tuple[_NormalizedSku, list[PortfolioCurvePoint]]] = []

    raw_items: list[Any] = []
    if isinstance(curves, dict):
        for k, v in curves.items():
            if isinstance(v, dict):
                raw_items.append({"sku_id": k, **v})
            elif hasattr(v, "curve"):
                raw_items.append(v)
            else:
                raw_items.append({"sku_id": k, "curve": v})
    elif isinstance(curves, (list, tuple)):
        raw_items = list(curves)
    else:
        raise ValueError(f"Unsupported curves type: {type(curves)}")

    for idx, item in enumerate(raw_items):
        if hasattr(item, "curve"):
            sku_id = str(getattr(item, "sku_id", f"SKU_{idx}"))
            unit_cost = float(getattr(item, "unit_cost", 1.0))
            annual_demand = float(getattr(item, "annual_demand", 0.0))
            raw_curve = getattr(item, "curve")
        elif isinstance(item, dict) and "curve" in item:
            sku_id = str(item.get("sku_id", f"SKU_{idx}"))
            unit_cost = float(item.get("unit_cost", 1.0))
            annual_demand = float(item.get("annual_demand", 0.0))
            raw_curve = item["curve"]
        elif isinstance(item, (list, tuple)):
            sku_id = f"SKU_{idx}"
            unit_cost = 1.0
            annual_demand = 0.0
            raw_curve = item
        else:
            sku_id = f"SKU_{idx}"
            unit_cost = 1.0
            annual_demand = 0.0
            raw_curve = [item]

        parsed_curve: list[PortfolioCurvePoint] = []
        for pt in raw_curve:
            if isinstance(pt, PortfolioCurvePoint):
                parsed_curve.append(pt)
            elif isinstance(pt, dict):
                parsed_curve.append(
                    PortfolioCurvePoint(
                        service_level=float(pt["service_level"]),
                        rop=int(pt["rop"]),
                        total_cost=float(pt["total_cost"]),
                        avg_inventory=float(pt["avg_inventory"]),
                        fill_rate=float(pt["fill_rate"])
                        if pt.get("fill_rate") is not None
                        else None,
                    )
                )
            else:
                parsed_curve.append(
                    PortfolioCurvePoint(
                        service_level=float(getattr(pt, "service_level", 0.95)),
                        rop=int(getattr(pt, "rop", 0)),
                        total_cost=float(getattr(pt, "total_cost", 0.0)),
                        avg_inventory=float(getattr(pt, "avg_inventory", 0.0)),
                        fill_rate=float(getattr(pt, "fill_rate", 0.95))
                        if getattr(pt, "fill_rate", None) is not None
                        else None,
                    )
                )

        sorted_curve = sorted(parsed_curve, key=lambda p: p.service_level)
        norm_sku = _NormalizedSku(sku_id, unit_cost, annual_demand, sorted_curve)
        skus_data.append((norm_sku, sorted_curve))

    return skus_data


def _build_summary(
    skus_data: list[tuple[_NormalizedSku, list[PortfolioCurvePoint]]],
    indices: list[int],
    greedy_indices: Optional[list[int]] = None,
    exact_indices: Optional[list[int]] = None,
) -> PortfolioPlanSummary:
    sku_plans: list[SkuPortfolioPlan] = []
    tot_cost = 0.0
    tot_investment = 0.0
    tot_units = 0.0
    tot_sl = 0.0
    tot_annual_demand = 0.0

    for i, ((s, curve), idx) in enumerate(zip(skus_data, indices)):
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

        g_sl = None
        g_rop = None
        g_cost = None
        if greedy_indices is not None and i < len(greedy_indices):
            g_pt = curve[greedy_indices[i]]
            g_sl = float(g_pt.service_level)
            g_rop = int(g_pt.rop)
            g_cost = float(g_pt.total_cost)

        e_sl = None
        e_rop = None
        e_cost = None
        if exact_indices is not None and i < len(exact_indices):
            e_pt = curve[exact_indices[i]]
            e_sl = float(e_pt.service_level)
            e_rop = int(e_pt.rop)
            e_cost = float(e_pt.total_cost)

        sku_plans.append(
            SkuPortfolioPlan(
                sku_id=s.sku_id,
                service_level=float(pt.service_level),
                rop=int(pt.rop),
                avg_inventory=inv,
                inventory_investment=inv_invest,
                total_cost=cost,
                turnover=turnover,
                greedy_service_level=g_sl,
                exact_service_level=e_sl,
                greedy_cost=g_cost,
                exact_cost=e_cost,
                greedy_rop=g_rop,
                exact_rop=e_rop,
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


def _solve_greedy(
    skus_data: list[tuple[_NormalizedSku, list[PortfolioCurvePoint]]],
    unconstrained_indices: list[int],
    budget: Optional[float],
    capacity: Optional[float],
) -> tuple[list[int], bool, bool, Optional[float], Optional[float]]:
    # Start at each SKU's cost-minimizing level
    curr_indices = list(unconstrained_indices)
    curr_inv_cost = sum(curve[curr_indices[i]].avg_inventory * s.unit_cost for i, (s, curve) in enumerate(skus_data))
    curr_units = sum(curve[curr_indices[i]].avg_inventory for i, (_, curve) in enumerate(skus_data))

    blocked_by_budget = False
    blocked_by_capacity = False

    while True:
        violates_budget = (budget is not None) and (curr_inv_cost > budget + 1e-6)
        violates_capacity = (capacity is not None) and (curr_units > capacity + 1e-6)

        if not violates_budget and not violates_capacity:
            break

        if violates_budget:
            blocked_by_budget = True
        if violates_capacity:
            blocked_by_capacity = True

        best_sku_idx: Optional[int] = None
        best_ratio = float("inf")
        best_d_budget = 0.0
        best_d_units = 0.0

        for i, (s, curve) in enumerate(skus_data):
            c_idx = curr_indices[i]
            if c_idx <= 0:
                continue

            curr_pt = curve[c_idx]
            prev_pt = curve[c_idx - 1]

            cost_increase = prev_pt.total_cost - curr_pt.total_cost
            budget_saved = (curr_pt.avg_inventory - prev_pt.avg_inventory) * s.unit_cost
            units_saved = curr_pt.avg_inventory - prev_pt.avg_inventory

            if violates_budget and budget_saved > 1e-9:
                ratio = max(0.0, cost_increase) / budget_saved
            elif violates_capacity and units_saved > 1e-9:
                ratio = max(0.0, cost_increase) / units_saved
            elif budget_saved > 1e-9:
                ratio = max(0.0, cost_increase) / budget_saved
            else:
                continue

            if ratio < best_ratio:
                best_ratio = ratio
                best_sku_idx = i
                best_d_budget = budget_saved
                best_d_units = units_saved

        if best_sku_idx is None:
            break

        curr_indices[best_sku_idx] -= 1
        curr_inv_cost -= best_d_budget
        curr_units -= best_d_units

    return (
        curr_indices,
        blocked_by_budget,
        blocked_by_capacity,
        None,
        None,
    )


def _run_milp(
    skus_data: list[tuple[_NormalizedSku, list[PortfolioCurvePoint]]],
    budget: Optional[float],
    capacity: Optional[float],
) -> dict[str, Any]:
    n_skus = len(skus_data)
    min_feasible_budget = sum(
        min(pt.avg_inventory * s.unit_cost for pt in curve) for s, curve in skus_data
    )
    min_feasible_capacity = sum(
        min(pt.avg_inventory for pt in curve) for s, curve in skus_data
    )

    if budget is not None and budget < min_feasible_budget - 1e-6:
        return {
            "status": "infeasible",
            "minimum_feasible_budget": float(min_feasible_budget),
        }

    if capacity is not None and capacity < min_feasible_capacity - 1e-6:
        return {
            "status": "infeasible",
            "minimum_feasible_budget": float(min_feasible_budget),
        }

    m_vars = sum(len(curve) for _, curve in skus_data)
    c_obj = np.zeros(m_vars, dtype=np.float64)
    offsets: list[int] = []
    curr_off = 0
    for s, curve in skus_data:
        offsets.append(curr_off)
        for k, pt in enumerate(curve):
            c_obj[curr_off + k] = float(pt.total_cost)
        curr_off += len(curve)

    num_constraints = n_skus + (1 if budget is not None else 0) + (1 if capacity is not None else 0)
    a_mat = np.zeros((num_constraints, m_vars), dtype=np.float64)
    lhs = np.zeros(num_constraints, dtype=np.float64)
    rhs = np.zeros(num_constraints, dtype=np.float64)

    # 1. Exactly one choice per SKU: sum_k x[i, k] = 1
    for i, (_, curve) in enumerate(skus_data):
        off = offsets[i]
        k_len = len(curve)
        a_mat[i, off : off + k_len] = 1.0
        lhs[i] = 1.0
        rhs[i] = 1.0

    row_idx = n_skus
    # 2. Budget constraint: sum_{i, k} b_{i, k} * x[i, k] <= budget
    if budget is not None:
        for i, (s, curve) in enumerate(skus_data):
            off = offsets[i]
            for k, pt in enumerate(curve):
                a_mat[row_idx, off + k] = float(pt.avg_inventory) * float(s.unit_cost)
        lhs[row_idx] = -np.inf
        rhs[row_idx] = float(budget) + 1e-4
        row_idx += 1

    # 3. Capacity constraint: sum_{i, k} u_{i, k} * x[i, k] <= capacity
    if capacity is not None:
        for i, (_, curve) in enumerate(skus_data):
            off = offsets[i]
            for k, pt in enumerate(curve):
                a_mat[row_idx, off + k] = float(pt.avg_inventory)
        lhs[row_idx] = -np.inf
        rhs[row_idx] = float(capacity)
        row_idx += 1

    integrality = np.ones(m_vars, dtype=np.int32)
    bounds = Bounds(lb=0.0, ub=1.0)
    constraints = LinearConstraint(a_mat, lhs, rhs)

    try:
        res = milp(c=c_obj, integrality=integrality, bounds=bounds, constraints=constraints)
    except Exception:
        return {
            "status": "infeasible",
            "minimum_feasible_budget": float(min_feasible_budget),
        }

    if not res.success or res.x is None:
        return {
            "status": "infeasible",
            "minimum_feasible_budget": float(min_feasible_budget),
        }

    chosen_indices: list[int] = []
    for i, (_, curve) in enumerate(skus_data):
        off = offsets[i]
        k_len = len(curve)
        x_sku = res.x[off : off + k_len]
        chosen_indices.append(int(np.argmax(x_sku)))

    return {
        "status": "optimal",
        "exact_cost": float(res.fun),
        "chosen_indices": chosen_indices,
        "minimum_feasible_budget": float(min_feasible_budget),
    }


def solve_exact(
    curves: Any,
    budget: Optional[float] = None,
    capacity: Optional[float] = None,
) -> ExactResult:
    skus_data = _normalize_curves(curves)

    min_feasible_budget = sum(
        min(pt.avg_inventory * s.unit_cost for pt in curve) for s, curve in skus_data
    )

    # 1. Unconstrained reference per SKU
    unconstrained_indices: list[int] = []
    for s, curve in skus_data:
        best_idx = 0
        min_c = curve[0].total_cost
        for idx, pt in enumerate(curve):
            if pt.total_cost < min_c - 1e-9:
                min_c = pt.total_cost
                best_idx = idx
            elif abs(pt.total_cost - min_c) <= 1e-9:
                if pt.avg_inventory < curve[best_idx].avg_inventory:
                    best_idx = idx
        unconstrained_indices.append(best_idx)

    # 2. Greedy solver
    greedy_indices, _, _, _, _ = _solve_greedy(
        skus_data, unconstrained_indices, budget, capacity
    )
    greedy_plan = _build_summary(skus_data, greedy_indices)
    greedy_cost = float(greedy_plan.total_cost)

    # 3. Exact MILP solver
    milp_res = _run_milp(skus_data, budget, capacity)
    if milp_res["status"] != "optimal":
        return ExactResult(
            status="infeasible",
            greedy_cost=None,
            exact_cost=None,
            optimality_gap_pct=None,
            chosen_alphas={},
            minimum_feasible_budget=float(min_feasible_budget),
            shadow_price=None,
            exact_indices=None,
            greedy_indices=greedy_indices,
            exact_plan=None,
            greedy_plan=greedy_plan,
        )

    exact_indices = milp_res["chosen_indices"]
    exact_cost = float(milp_res["exact_cost"])
    chosen_alphas = {
        s.sku_id: float(curve[k].service_level)
        for (s, curve), k in zip(skus_data, exact_indices)
    }

    # Optimality gap percentage: (greedy - exact) / exact * 100
    if exact_cost > 1e-9:
        optimality_gap_pct = max(0.0, (greedy_cost - exact_cost) / exact_cost * 100.0)
    else:
        optimality_gap_pct = 0.0

    # 4. Shadow price = central difference of exact cost at B*0.99 and B*1.01
    shadow_price = 0.0
    if budget is not None and budget > 0:
        b_low = budget * 0.99
        b_high = budget * 1.01
        res_low = _run_milp(skus_data, b_low, capacity)
        res_high = _run_milp(skus_data, b_high, capacity)

        if res_low["status"] == "optimal" and res_high["status"] == "optimal":
            shadow_price = (res_high["exact_cost"] - res_low["exact_cost"]) / (0.02 * budget)
        elif res_high["status"] == "optimal":
            shadow_price = (res_high["exact_cost"] - exact_cost) / (0.01 * budget)

    exact_plan = _build_summary(
        skus_data, exact_indices, greedy_indices=greedy_indices, exact_indices=exact_indices
    )
    greedy_plan = _build_summary(
        skus_data, greedy_indices, greedy_indices=greedy_indices, exact_indices=exact_indices
    )

    return ExactResult(
        status="optimal",
        greedy_cost=greedy_cost,
        exact_cost=exact_cost,
        optimality_gap_pct=optimality_gap_pct,
        chosen_alphas=chosen_alphas,
        minimum_feasible_budget=float(min_feasible_budget),
        shadow_price=float(shadow_price),
        exact_indices=exact_indices,
        greedy_indices=greedy_indices,
        exact_plan=exact_plan,
        greedy_plan=greedy_plan,
    )


def solve_portfolio(req: PortfolioRequest) -> PortfolioResponse:
    clock = RunClock()
    budget = req.budget
    capacity = req.capacity

    skus_data = _normalize_curves(req.skus)

    # 1. Unconstrained reference plan
    unconstrained_indices: list[int] = []
    for s, curve in skus_data:
        best_idx = 0
        min_cost = curve[0].total_cost
        for idx, pt in enumerate(curve):
            if pt.total_cost < min_cost - 1e-9:
                min_cost = pt.total_cost
                best_idx = idx
            elif abs(pt.total_cost - min_cost) <= 1e-9:
                if pt.avg_inventory < curve[best_idx].avg_inventory:
                    best_idx = idx
        unconstrained_indices.append(best_idx)

    unconstrained_plan = _build_summary(skus_data, unconstrained_indices)

    # 2. Exact & Greedy optimization
    exact_res = solve_exact(req.skus, budget, capacity)

    if exact_res.status == "infeasible":
        return PortfolioResponse(
            run_meta=clock.meta(0),
            unconstrained_plan=unconstrained_plan,
            constrained_plan=unconstrained_plan,
            total_cost_delta=0.0,
            binding_constraints=["budget" if budget is not None else "capacity"],
            budget_shadow_price=0.0,
            budget=budget,
            capacity=capacity,
            budget_usage_pct=None,
            capacity_usage_pct=None,
            status="infeasible",
            minimum_feasible_budget=exact_res.minimum_feasible_budget,
            greedy_cost=None,
            exact_cost=None,
            optimality_gap_pct=None,
            chosen_alphas={},
            shadow_price=None,
            exact_plan=None,
            greedy_plan=exact_res.greedy_plan,
        )

    exact_plan = exact_res.exact_plan or _build_summary(skus_data, exact_res.exact_indices or [])
    greedy_plan = exact_res.greedy_plan or _build_summary(skus_data, exact_res.greedy_indices or [])

    cost_delta = max(0.0, exact_plan.total_cost - unconstrained_plan.total_cost)

    # Binding constraints evaluation:
    # A constraint is "binding" iff exact cost at 1.01*B is lower than at B by more than 1e-9.
    binding_constraints: list[str] = []
    if budget is not None and exact_res.exact_cost is not None:
        b_high = budget * 1.01
        res_b_high = _run_milp(skus_data, b_high, capacity)
        if res_b_high["status"] == "optimal":
            if (exact_res.exact_cost - res_b_high["exact_cost"]) > 1e-9:
                binding_constraints.append("budget")

    if capacity is not None and exact_res.exact_cost is not None:
        c_high = capacity * 1.01
        res_c_high = _run_milp(skus_data, budget, c_high)
        if res_c_high["status"] == "optimal":
            if (exact_res.exact_cost - res_c_high["exact_cost"]) > 1e-9:
                binding_constraints.append("capacity")

    budget_usage_pct = (
        (exact_plan.total_inventory_investment / budget * 100.0)
        if budget is not None and budget > 0
        else None
    )
    capacity_usage_pct = (
        (exact_plan.total_units / capacity * 100.0)
        if capacity is not None and capacity > 0
        else None
    )

    shadow_price = exact_res.shadow_price if exact_res.shadow_price is not None else 0.0

    return PortfolioResponse(
        run_meta=clock.meta(0),
        unconstrained_plan=unconstrained_plan,
        constrained_plan=exact_plan,
        total_cost_delta=cost_delta,
        binding_constraints=binding_constraints,
        budget_shadow_price=shadow_price,
        budget=budget,
        capacity=capacity,
        budget_usage_pct=budget_usage_pct,
        capacity_usage_pct=capacity_usage_pct,
        status="optimal",
        minimum_feasible_budget=exact_res.minimum_feasible_budget,
        greedy_cost=exact_res.greedy_cost,
        exact_cost=exact_res.exact_cost,
        optimality_gap_pct=exact_res.optimality_gap_pct,
        chosen_alphas=exact_res.chosen_alphas,
        shadow_price=shadow_price,
        exact_plan=exact_plan,
        greedy_plan=greedy_plan,
    )
