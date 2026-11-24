import { AppError } from "../../../lib/errors.js";
import {
  GetPortfolioPlanInput,
  GetPortfolioPlanOutput,
} from "../../../contracts/ai.js";

/**
 * Helper to normalize a SKU's portfolio allocation item
 */
function formatPlanItem(s) {
  if (!s) return null;
  return {
    skuId: s.sku_id,
    serviceLevel: s.service_level,
    rop: s.rop,
    avgInventory: s.avg_inventory,
    inventoryInvestment: s.inventory_investment,
    totalCost: s.total_cost,
    turnover: s.turnover,
  };
}

/**
 * Helper to normalize plan aggregate totals
 */
function formatTotals(plan) {
  if (!plan) return null;
  return {
    totalCost: plan.total_cost,
    totalInventoryInvestment: plan.total_inventory_investment,
    totalUnits: plan.total_units,
    avgServiceLevel: plan.avg_service_level,
    turnover: plan.turnover,
  };
}

/**
 * get_portfolio_plan tool
 */
export async function getPortfolioPlan(rawArgs, bundle) {
  const args = GetPortfolioPlanInput.parse(rawArgs);
  const { portfolioRun } = bundle;

  if (!portfolioRun || !portfolioRun.result) {
    const output = GetPortfolioPlanOutput.parse({
      status: "not_run",
      portfolioRunId: null,
      bindingConstraints: [],
      message:
        "No succeeded portfolio optimization run found for this session.",
    });
    return {
      output,
      evidence: {
        artifactType: "portfolio_run",
        artifactId: bundle.session._id.toString(),
        skuId: args.skuId || null,
        label: "Portfolio plan (not run)",
      },
    };
  }

  const res = portfolioRun.result;
  const unconstrainedPlan = res.unconstrained_plan || null;
  const constrainedPlan = res.constrained_plan || null;

  const uMap = new Map(
    (unconstrainedPlan?.skus || []).map((s) => [s.sku_id, s]),
  );
  const cMap = new Map((constrainedPlan?.skus || []).map((s) => [s.sku_id, s]));

  const status =
    res.status === "infeasible" || portfolioRun.status === "infeasible"
      ? "infeasible"
      : portfolioRun.status === "succeeded" ||
          res.status === "optimal" ||
          res.status === "succeeded"
        ? "succeeded"
        : "not_run";

  const baseOutput = {
    status,
    portfolioRunId: portfolioRun._id.toString(),
    budget: res.budget ?? null,
    capacity: res.capacity ?? null,
    bindingConstraints: res.binding_constraints || [],
    budgetShadowPrice: res.budget_shadow_price ?? null,
    shadowPrice: res.shadow_price ?? res.budget_shadow_price ?? null,
    exactCost: res.exact_cost ?? null,
    greedyCost: res.greedy_cost ?? null,
    optimalityGapPct: res.optimality_gap_pct ?? null,
    minimumFeasibleBudget: res.minimum_feasible_budget ?? null,
    totalCostDelta: res.total_cost_delta ?? null,
    budgetUsagePct: res.budget_usage_pct ?? null,
    capacityUsagePct: res.capacity_usage_pct ?? null,
    unconstrained: formatTotals(unconstrainedPlan),
    constrained: formatTotals(constrainedPlan),
  };

  if (args.skuId) {
    const u = formatPlanItem(uMap.get(args.skuId));
    const c = formatPlanItem(cMap.get(args.skuId));

    if (!u && !c) {
      throw new AppError(
        "NOT_FOUND",
        `SKU ${args.skuId} not found in portfolio plan`,
      );
    }

    const skuComparison = {
      skuId: args.skuId,
      unconstrained: u || c,
      constrained: c || u,
      costDelta:
        c?.totalCost != null && u?.totalCost != null
          ? c.totalCost - u.totalCost
          : 0,
      serviceLevelDelta:
        c?.serviceLevel != null && u?.serviceLevel != null
          ? c.serviceLevel - u.serviceLevel
          : 0,
    };

    const output = GetPortfolioPlanOutput.parse({
      ...baseOutput,
      sku: skuComparison,
    });

    return {
      output,
      evidence: {
        artifactType: "portfolio_run",
        artifactId: portfolioRun._id.toString(),
        skuId: args.skuId,
        label: `Portfolio plan for SKU ${args.skuId}`,
      },
    };
  }

  const allSkuIds = [...new Set([...uMap.keys(), ...cMap.keys()])].sort((a, b) => {
    const deltaA = Math.abs(
      (cMap.get(a)?.total_cost ?? 0) - (uMap.get(a)?.total_cost ?? 0),
    );
    const deltaB = Math.abs(
      (cMap.get(b)?.total_cost ?? 0) - (uMap.get(b)?.total_cost ?? 0),
    );
    return deltaB - deltaA;
  });
  const skus = allSkuIds.slice(0, 6).map((sId) => {
    const u = formatPlanItem(uMap.get(sId));
    const c = formatPlanItem(cMap.get(sId));
    return {
      skuId: sId,
      unconstrained: u || c,
      constrained: c || u,
      costDelta:
        c?.totalCost != null && u?.totalCost != null
          ? c.totalCost - u.totalCost
          : 0,
      serviceLevelDelta:
        c?.serviceLevel != null && u?.serviceLevel != null
          ? c.serviceLevel - u.serviceLevel
          : 0,
    };
  });

  const output = GetPortfolioPlanOutput.parse({
    ...baseOutput,
    skus,
  });

  return {
    output,
    evidence: {
      artifactType: "portfolio_run",
      artifactId: portfolioRun._id.toString(),
      skuId: null,
      label: "Portfolio optimization plan",
    },
  };
}
