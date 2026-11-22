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
    const skusMap =
      assumptions.skus instanceof Map
        ? Object.fromEntries(assumptions.skus)
        : assumptions.skus ||
          (assumptions.toObject
            ? assumptions.toObject({ flattenMaps: true }).skus
            : {}) ||
          {};
    assumptionsView = {
      version: assumptions.version ?? 1,
      skus: skusMap,
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
    const eData = evalSkus[skuId];
    const oData = optSkus[skuId];
    const sData = simSkus[skuId];
    const rData = riskMap.get(skuId);

    const autoetsMean = fData?.autoets_mean || [];
    const avgDailyForecast =
      autoetsMean.length > 0
        ? autoetsMean.reduce((a, b) => a + b, 0) / autoetsMean.length
        : null;

    skus.push({
      skuId,
      forecastStatus: fData?.status || null,
      intervalStatus: fData?.interval_status || null,
      avgDailyForecast,
      holdoutWapeAutoets: eData?.autoets?.wape ?? null,
      holdoutCoverage: eData?.interval_metrics?.coverage_p10_p90 ?? null,
      eoq: oData?.eoq ?? null,
      ropDeterministic: oData?.rop_deterministic ?? null,
      ropQuantile: oData?.rop_quantile ?? null,
      ropUncertaintyAware: oData?.rop_uncertainty_aware ?? null,
      ropGap: oData?.rop_gap ?? null,
      riskLevel: rData?.level || null,
      simDetTotalCost: sData?.deterministic?.mean_total_cost ?? null,
      simQuaTotalCost: sData?.quantile?.mean_total_cost ?? null,
      simUncTotalCost: sData?.uncertainty_aware?.mean_total_cost ?? null,
      simDetServiceLevel: sData?.deterministic?.service_level ?? null,
      simQuaServiceLevel: sData?.quantile?.service_level ?? null,
      simUncServiceLevel: sData?.uncertainty_aware?.service_level ?? null,
    });
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
      aggregate: rr.aggregate || null,
    };
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
    forecastAggregate: forecastRun?.result?.evaluation?.aggregate || null,
    skus,
    simulationAggregate: simulationRun?.result?.aggregate || null,
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
      return {
        artifactType: "dataset",
        artifactId: dataset._id.toString(),
        skuId: null,
        label: "Dataset summary",
        payload: dataset.validationSummary,
      };
    }

    case "forecast_aggregate": {
      const agg = forecastRun?.result?.evaluation?.aggregate;
      if (!agg) return null;
      return {
        artifactType: "evaluation",
        artifactId: forecastRun._id.toString(),
        skuId: null,
        label: "Forecast evaluation aggregate",
        payload: agg,
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
      return {
        artifactType: "optimization_run",
        artifactId: optimizationRun._id.toString(),
        skuId: null,
        label: "Optimization aggregate",
        payload: {
          skusCount: Object.keys(optimizationRun.result.skus || {}).length,
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
      return {
        artifactType: "portfolio_run",
        artifactId: portfolioRun._id.toString(),
        skuId: null,
        label: "Portfolio optimization aggregate",
        payload: {
          budget: portfolioRun.result.budget ?? null,
          capacity: portfolioRun.result.capacity ?? null,
          bindingConstraints: portfolioRun.result.binding_constraints || [],
          budgetShadowPrice: portfolioRun.result.budget_shadow_price ?? null,
          totalCostDelta: portfolioRun.result.total_cost_delta ?? null,
          budgetUsagePct: portfolioRun.result.budget_usage_pct ?? null,
          capacityUsagePct: portfolioRun.result.capacity_usage_pct ?? null,
          unconstrained: portfolioRun.result.unconstrained_plan,
          constrained: portfolioRun.result.constrained_plan,
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
