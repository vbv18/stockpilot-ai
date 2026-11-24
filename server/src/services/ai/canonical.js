import { buildSessionRisk } from "../risk.js";

/**
 * Builds compact session digest with raw numbers and no prose
 */
export function buildSessionDigest(bundle, risks = null) {
  const {
    session,
    dataset,
    forecastRun,
    assumptions,
    optimizationRun,
    simulationRun,
    portfolioRun,
    replayRun,
  } = bundle;

  let computedRisks = risks;
  if (!computedRisks && optimizationRun) {
    try {
      computedRisks = buildSessionRisk(
        optimizationRun,
        simulationRun,
        assumptions,
      );
    } catch {
      computedRisks = [];
    }
  }
  const riskMap = new Map((computedRisks || []).map((r) => [r.skuId, r]));

  // Assumptions view
  let assumptionsView = null;
  if (assumptions) {
    const rawMap =
      assumptions.skus instanceof Map
        ? Object.fromEntries(assumptions.skus)
        : assumptions.skus ||
          (assumptions.toObject
            ? assumptions.toObject({ flattenMaps: true }).skus
            : {}) ||
          {};
    assumptionsView = {
      version: assumptions.version ?? 1,
      skuCount: Object.keys(rawMap).length,
    };
  }

  // SKU summaries
  const skus = [];
  const forecastSkus = forecastRun?.result?.skus || {};
  const evalSkus = forecastRun?.result?.evaluation?.skus || {};
  const optSkus = optimizationRun?.result?.skus || {};
  const simSkus = simulationRun?.result?.skus || {};

  const allSkuIds = new Set([
    ...Object.keys(forecastSkus),
    ...Object.keys(optSkus),
    ...Object.keys(simSkus),
  ]);

  for (const skuId of [...allSkuIds].sort()) {
    const fData = forecastSkus[skuId];
    const oData = optSkus[skuId];
    const rData = riskMap.get(skuId);

    const skuEntry = {
      skuId,
      forecastStatus: fData?.status || "ok",
      eoq: oData?.eoq ?? null,
      sDet: oData?.s_det ?? oData?.rop_deterministic ?? null,
      sEmp: oData?.s_emp ?? oData?.rop_uncertainty_aware ?? null,
      riskLevel: rData?.level || null,
    };
    const cleanEntry = {};
    for (const [k, v] of Object.entries(skuEntry)) {
      if (v !== null && v !== undefined) cleanEntry[k] = v;
    }
    skus.push(cleanEntry);
  }

  let dependencySummary = null;
  if (optimizationRun?.result?.dependency) {
    const dep = optimizationRun.result.dependency;
    dependencySummary = {
      poolingRatio: dep.pooling_ratio ?? null,
      pairsCount: dep.pairs?.length ?? 0,
      topPairs: (dep.pairs || []).slice(0, 3).map((p) => ({
        sku_i: p.sku_i,
        sku_j: p.sku_j,
        rho: p.rho,
        relation: p.relation,
      })),
    };
  }

  let portfolioSummary = null;
  if (portfolioRun?.result) {
    const pr = portfolioRun.result;
    portfolioSummary = {
      status: portfolioRun.status,
      budget: pr.budget ?? null,
      capacity: pr.capacity ?? null,
      totalCostDelta: pr.total_cost_delta ?? null,
      bindingConstraints: pr.binding_constraints || [],
      budgetShadowPrice: pr.budget_shadow_price ?? null,
      shadowPrice: pr.shadow_price ?? pr.budget_shadow_price ?? null,
      exactCost: pr.exact_cost ?? null,
      greedyCost: pr.greedy_cost ?? null,
      optimalityGapPct: pr.optimality_gap_pct ?? null,
      minimumFeasibleBudget: pr.minimum_feasible_budget ?? null,
      unconstrainedTotalCost: pr.unconstrained_plan?.total_cost ?? null,
      constrainedTotalCost: pr.constrained_plan?.total_cost ?? null,
      budgetUsagePct: pr.budget_usage_pct ?? null,
      capacityUsagePct: pr.capacity_usage_pct ?? null,
    };
  }

  let replaySummary = null;
  if (replayRun?.results) {
    const rr = replayRun.results;
    replaySummary = {
      status: replayRun.status,
      holdoutDays: replayRun.holdoutDays ?? 28,
      costDeterministic: rr.aggregate?.deterministic?.total_cost ?? null,
      costUncertaintyAware: rr.aggregate?.uncertainty_aware?.total_cost ?? null,
    };
  }

  let forecastAggregate = null;
  if (forecastRun?.result?.evaluation?.aggregate) {
    const { model_comparison, ...rest } =
      forecastRun.result.evaluation.aggregate;
    forecastAggregate = rest;
  }

  return {
    session: {
      name: session.name,
      status: session.status,
    },
    dataset: dataset?.validationSummary
      ? {
          skuIds: dataset.validationSummary.skuIds || [],
          dateRange: dataset.validationSummary.dateRange || null,
          rowCounts: {
            accepted: dataset.validationSummary.acceptedRows,
            total: dataset.validationSummary.totalRows,
          },
        }
      : null,
    assumptions: assumptionsView,
    forecastAggregate,
    skus,
    simulationAggregate: simulationRun?.result?.aggregate || null,
    dependency: dependencySummary,
    portfolio: portfolioSummary,
    replay: replaySummary,
  };
}

/**
 * Maps a Qdrant hit back to its Mongo canonical record
 */
export function loadCanonicalForHit(bundle, hit) {
  const {
    session,
    dataset,
    forecastRun,
    assumptions,
    optimizationRun,
    simulationRun,
    portfolioRun,
    replayRun,
  } = bundle;
  const { artifactType, artifactId, skuId } = hit;

  switch (artifactType) {
    case "session_overview": {
      return {
        artifactType: "session_digest",
        artifactId: session._id.toString(),
        skuId: null,
        label: "Session overview digest",
        payload: buildSessionDigest(bundle),
      };
    }

    case "dataset_summary": {
      if (!dataset?.validationSummary) return null;
      const vs = dataset.validationSummary;
      return {
        artifactType: "dataset",
        artifactId: dataset._id.toString(),
        skuId: null,
        label: "Dataset summary",
        payload: {
          skuCount: vs.skuIds ? vs.skuIds.length : 0,
          dateRange: vs.dateRange || null,
          acceptedRows: vs.acceptedRows,
          totalRows: vs.totalRows,
        },
      };
    }

    case "forecast_aggregate": {
      const agg = forecastRun?.result?.evaluation?.aggregate;
      if (!agg) return null;
      const { model_comparison, ...rest } = agg;
      return {
        artifactType: "evaluation",
        artifactId: forecastRun._id.toString(),
        skuId: null,
        label: "Forecast evaluation aggregate",
        payload: rest,
      };
    }

    case "forecast_sku": {
      const skuData = forecastRun?.result?.skus?.[skuId];
      if (!skuData) return null;
      // Exclude large residual_blocks
      const { residual_blocks, ...rest } = skuData;
      return {
        artifactType: "forecast_run",
        artifactId: forecastRun._id.toString(),
        skuId,
        label: `Forecast for SKU ${skuId}`,
        payload: rest,
      };
    }

    case "evaluation_sku": {
      const evalData = forecastRun?.result?.evaluation?.skus?.[skuId];
      if (!evalData) return null;
      return {
        artifactType: "evaluation",
        artifactId: forecastRun._id.toString(),
        skuId,
        label: `Holdout evaluation for SKU ${skuId}`,
        payload: evalData,
      };
    }

    case "assumption_set": {
      if (!assumptions) return null;
      const skusMap =
        assumptions.skus instanceof Map
          ? Object.fromEntries(assumptions.skus)
          : assumptions.skus ||
            (assumptions.toObject
              ? assumptions.toObject({ flattenMaps: true }).skus
              : {}) ||
            {};
      return {
        artifactType: "assumption_set",
        artifactId: assumptions._id.toString(),
        skuId: null,
        label: `Assumptions version ${assumptions.version ?? 1}`,
        payload: {
          version: assumptions.version ?? 1,
          skus: skusMap,
        },
      };
    }

    case "optimization_sku": {
      const skuOpt = optimizationRun?.result?.skus?.[skuId];
      if (!skuOpt) return null;
      return {
        artifactType: "optimization_run",
        artifactId: optimizationRun._id.toString(),
        skuId,
        label: `Optimization for SKU ${skuId}`,
        payload: skuOpt,
      };
    }

    case "optimization_aggregate": {
      if (!optimizationRun?.result) return null;
      const dep = optimizationRun.result.dependency;
      return {
        artifactType: "optimization_run",
        artifactId: optimizationRun._id.toString(),
        skuId: null,
        label: "Optimization aggregate",
        payload: {
          skusCount: Object.keys(optimizationRun.result.skus || {}).length,
          poolingRatio: dep?.pooling_ratio ?? null,
          pairsCount: dep?.pairs?.length ?? 0,
          topPairs: (dep?.pairs || []).slice(0, 5),
        },
      };
    }

    case "simulation_sku": {
      const skuSim = simulationRun?.result?.skus?.[skuId];
      if (!skuSim) return null;
      return {
        artifactType: "simulation_run",
        artifactId: simulationRun._id.toString(),
        skuId,
        label: `Simulation for SKU ${skuId}`,
        payload: skuSim,
      };
    }

    case "simulation_aggregate": {
      const simAgg = simulationRun?.result?.aggregate;
      if (!simAgg) return null;
      return {
        artifactType: "simulation_run",
        artifactId: simulationRun._id.toString(),
        skuId: null,
        label: "Simulation aggregate",
        payload: simAgg,
      };
    }

    case "portfolio_aggregate": {
      if (!portfolioRun?.result) return null;
      const pr = portfolioRun.result;
      return {
        artifactType: "portfolio_run",
        artifactId: portfolioRun._id.toString(),
        skuId: null,
        label: "Portfolio optimization aggregate",
        payload: {
          budget: pr.budget ?? null,
          capacity: pr.capacity ?? null,
          bindingConstraints: pr.binding_constraints || [],
          budgetShadowPrice: pr.budget_shadow_price ?? null,
          shadowPrice: pr.shadow_price ?? pr.budget_shadow_price ?? null,
          exactCost: pr.exact_cost ?? null,
          greedyCost: pr.greedy_cost ?? null,
          optimalityGapPct: pr.optimality_gap_pct ?? null,
          minimumFeasibleBudget: pr.minimum_feasible_budget ?? null,
          totalCostDelta: pr.total_cost_delta ?? null,
          budgetUsagePct: pr.budget_usage_pct ?? null,
          capacityUsagePct: pr.capacity_usage_pct ?? null,
          unconstrained: pr.unconstrained_plan,
          constrained: pr.constrained_plan,
        },
      };
    }

    case "portfolio_sku": {
      if (!portfolioRun?.result || !skuId) return null;
      const uMap = new Map(
        (portfolioRun.result.unconstrained_plan?.skus || []).map((s) => [
          s.sku_id,
          s,
        ]),
      );
      const cMap = new Map(
        (portfolioRun.result.constrained_plan?.skus || []).map((s) => [
          s.sku_id,
          s,
        ]),
      );
      const u = uMap.get(skuId);
      const c = cMap.get(skuId);
      if (!u && !c) return null;
      return {
        artifactType: "portfolio_run",
        artifactId: portfolioRun._id.toString(),
        skuId,
        label: `Portfolio plan for SKU ${skuId}`,
        payload: {
          skuId,
          unconstrained: u || null,
          constrained: c || null,
          exactCost: c?.exact_cost ?? null,
          greedyCost: c?.greedy_cost ?? null,
          exactServiceLevel: c?.exact_service_level ?? null,
          greedyServiceLevel: c?.greedy_service_level ?? null,
          exactRop: c?.exact_rop ?? null,
          greedyRop: c?.greedy_rop ?? null,
          costDelta:
            c?.total_cost != null && u?.total_cost != null
              ? c.total_cost - u.total_cost
              : null,
          serviceLevelDelta:
            c?.service_level != null && u?.service_level != null
              ? c.service_level - u.service_level
              : null,
        },
      };
    }

    case "replay_aggregate": {
      if (!replayRun?.results) return null;
      return {
        artifactType: "replay_run",
        artifactId: replayRun._id.toString(),
        skuId: null,
        label: "Actual demand replay aggregate",
        payload: replayRun.results.aggregate || null,
      };
    }

    case "replay_sku": {
      if (!replayRun?.results || !skuId) return null;
      const skus = Array.isArray(replayRun.results.skus)
        ? replayRun.results.skus
        : Object.values(replayRun.results.skus || {});
      const skuReplay = skus.find((s) => s.sku_id === skuId);
      if (!skuReplay) return null;
      return {
        artifactType: "replay_run",
        artifactId: replayRun._id.toString(),
        skuId,
        label: `Actual demand replay for SKU ${skuId}`,
        payload: skuReplay,
      };
    }

    case "backtest_aggregate": {
      if (!forecastRun?.result?.evaluation) return null;
      return {
        artifactType: "evaluation",
        artifactId: forecastRun._id.toString(),
        skuId: null,
        label: "Rolling backtest model comparison aggregate",
        payload: forecastRun.result.evaluation.aggregate || null,
      };
    }

    default:
      return null;
  }
}
