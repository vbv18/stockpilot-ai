import { AppError } from "../../../lib/errors.js";
import { AssumptionsBody } from "../../../contracts/pipeline.js";
import { RunWhatIfInput, RunWhatIfOutput } from "../../../contracts/ai.js";
import {
  PyOptimizeRequest,
  PyOptimizeResponse,
  PySimulateRequest,
  PySimulateResponse,
} from "../../../contracts/python.js";
import { WhatIfRunModel } from "../../../models/whatIfRun.model.js";
import { statsPost } from "../../statsClient.js";

// In-memory concurrency guard: one what-if per user at a time
const runningWhatIfUsers = new Set();

/**
 * run_what_if_scenario tool
 */
export async function runWhatIfScenario(rawArgs, bundle, ctx) {
  const args = RunWhatIfInput.parse(rawArgs);
  const { session, forecastRun, optimizationRun, simulationRun, assumptions } =
    bundle;

  if (
    !forecastRun ||
    forecastRun.status !== "succeeded" ||
    !optimizationRun ||
    optimizationRun.status !== "succeeded" ||
    !simulationRun ||
    simulationRun.status !== "succeeded" ||
    !assumptions
  ) {
    throw new AppError(
      "INVALID_STATE",
      "A completed optimization and simulation are required for what-if analysis.",
    );
  }

  if (runningWhatIfUsers.has(ctx.userId)) {
    throw new AppError("CONFLICT", "A what-if analysis is already running.");
  }

  runningWhatIfUsers.add(ctx.userId);

  try {
    const baseSkus =
      assumptions.skus instanceof Map
        ? Object.fromEntries(assumptions.skus)
        : assumptions.skus ||
          (assumptions.toObject
            ? assumptions.toObject({ flattenMaps: true }).skus
            : {}) ||
          {};

    const baselineAssumptions = {};
    const scenarioAssumptions = {};

    for (const [skuId, baseVals] of Object.entries(baseSkus)) {
      const bVals = {
        ordering_cost: baseVals.ordering_cost,
        holding_cost_annual: baseVals.holding_cost_annual,
        shortage_penalty: baseVals.shortage_penalty,
        lead_time_mean: baseVals.lead_time_mean,
        lead_time_std: baseVals.lead_time_std ?? 0,
        service_level: baseVals.service_level,
        unit_cost: baseVals.unit_cost,
      };
      baselineAssumptions[skuId] = bVals;

      const ovr = args.overrides[skuId] || {};
      scenarioAssumptions[skuId] = {
        ordering_cost: ovr.ordering_cost ?? bVals.ordering_cost,
        holding_cost_annual:
          ovr.holding_cost_annual ?? bVals.holding_cost_annual,
        shortage_penalty: ovr.shortage_penalty ?? bVals.shortage_penalty,
        lead_time_mean: ovr.lead_time_mean ?? bVals.lead_time_mean,
        lead_time_std: ovr.lead_time_std ?? bVals.lead_time_std,
        service_level: ovr.service_level ?? bVals.service_level,
        unit_cost: ovr.unit_cost ?? bVals.unit_cost,
      };
    }

    // Prepare forecast skus for /optimize
    const forecastSkus = forecastRun.result?.forecast?.skus || [];
    const eligibleSkus = forecastSkus.filter(
      (s) => s.status === "ok" && s.interval_status === "ok",
    );

    const modelParams = forecastRun.modelConfig?.params || {};
    const nBootstrap = modelParams.n_bootstrap ?? 500;
    const blockSize = modelParams.block_size ?? 7;
    const bootstrapSeed = forecastRun.seed;

    const optimizeSkus = eligibleSkus.map((s) => ({
      sku_id: s.sku_id,
      forecast_mean: s.autoets_mean,
      residual_blocks: s.residual_blocks,
      residual_std: s.residual_std,
    }));

    const pyOptimizeReq = {
      skus: optimizeSkus,
      params: {
        n_bootstrap: nBootstrap,
        block_size: blockSize,
        bootstrap_seed: bootstrapSeed,
      },
      assumptions: scenarioAssumptions,
    };

    const optResult = await statsPost(
      "/optimize",
      pyOptimizeReq,
      PyOptimizeRequest,
      PyOptimizeResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
        timeoutMs: 120_000,
      },
    );

    // Prepare /simulate request with same scenarioCount, horizonDays, seed
    const scenarioCount = simulationRun.scenarioCount ?? 500;
    const horizonDays = simulationRun.horizonDays ?? 90;
    const seed = simulationRun.seed ?? 42;

    const forecastMap = new Map();
    for (const s of forecastSkus) {
      forecastMap.set(s.sku_id, s);
    }

    const simulateSkus = [];
    for (const optSku of optResult.skus || []) {
      if (optSku.status !== "ok") continue;
      const fcSku = forecastMap.get(optSku.sku_id);
      if (!fcSku) continue;

      simulateSkus.push({
        sku_id: optSku.sku_id,
        forecast_mean: fcSku.autoets_mean,
        residual_blocks: fcSku.residual_blocks,
        eoq: optSku.eoq,
        rop_deterministic: optSku.rop_deterministic,
        rop_uncertainty_aware: optSku.rop_uncertainty_aware,
        rop_quantile: optSku.rop_quantile ?? optSku.rop_uncertainty_aware,
      });
    }

    const pySimulateReq = {
      skus: simulateSkus,
      params: {
        n_scenarios: scenarioCount,
        horizon_days: horizonDays,
        block_size: blockSize,
        seed,
      },
      assumptions: scenarioAssumptions,
    };

    const simResult = await statsPost(
      "/simulate",
      pySimulateReq,
      PySimulateRequest,
      PySimulateResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
        timeoutMs: 120_000,
      },
    );

    // Persist what-if run doc (conversationId set to null initially)
    const whatIfDoc = await WhatIfRunModel.create({
      userId: ctx.userId,
      sessionId: session._id.toString(),
      conversationId: null,
      baselineOptimizationRunId: optimizationRun._id,
      baselineSimulationRunId: simulationRun._id,
      overrides: args.overrides,
      effectiveAssumptions: scenarioAssumptions,
      optimizationResult: optResult,
      simulationResult: simResult,
    });

    const baseAgg =
      simulationRun.policyResults?.aggregate ||
      simulationRun.result?.aggregate ||
      {};
    const scenAgg = simResult.aggregate || {};

    const baseDet = baseAgg.deterministic || {};
    const baseUnc = baseAgg.uncertainty_aware || {};
    const scenDet = scenAgg.deterministic || {};
    const scenUnc = scenAgg.uncertainty_aware || {};

    const mapTotals = (t) => ({
      totalCost: t.mean_total_cost ?? t.total_cost ?? 0,
      orderingCost: t.mean_ordering_cost ?? t.ordering_cost ?? 0,
      holdingCost: t.mean_holding_cost ?? t.holding_cost ?? 0,
      shortageCost: t.mean_shortage_cost ?? t.shortage_cost ?? 0,
      serviceLevel: t.service_level ?? 0,
      stockoutUnits: t.mean_stockout_units ?? t.stockout_units ?? 0,
      avgInventory: t.mean_ending_inventory ?? t.avg_inventory ?? 0,
      orders: t.mean_orders_placed ?? t.order_count ?? 0,
    });

    const baselineTotals = {
      deterministic: mapTotals(baseDet),
      uncertaintyAware: mapTotals(baseUnc),
    };
    const scenarioTotals = {
      deterministic: mapTotals(scenDet),
      uncertaintyAware: mapTotals(scenUnc),
    };

    const deltas = {
      deterministicTotalCost:
        scenarioTotals.deterministic.totalCost -
        baselineTotals.deterministic.totalCost,
      uncertaintyAwareTotalCost:
        scenarioTotals.uncertaintyAware.totalCost -
        baselineTotals.uncertaintyAware.totalCost,
      deterministicServiceLevel:
        scenarioTotals.deterministic.serviceLevel -
        baselineTotals.deterministic.serviceLevel,
      uncertaintyAwareServiceLevel:
        scenarioTotals.uncertaintyAware.serviceLevel -
        baselineTotals.uncertaintyAware.serviceLevel,
    };

    const perSku = [];
    const baseOptSkusMap = new Map();
    const rawBaseOpt = optimizationRun.result?.skus;
    if (Array.isArray(rawBaseOpt)) {
      for (const s of rawBaseOpt) baseOptSkusMap.set(s.sku_id, s);
    } else if (rawBaseOpt) {
      for (const [k, s] of Object.entries(rawBaseOpt))
        baseOptSkusMap.set(s.sku_id || k, s);
    }

    const baseSimSkusMap = new Map();
    const rawBaseSim =
      simulationRun.policyResults?.skus || simulationRun.result?.skus;
    if (Array.isArray(rawBaseSim)) {
      for (const s of rawBaseSim) baseSimSkusMap.set(s.sku_id, s);
    } else if (rawBaseSim) {
      for (const [k, s] of Object.entries(rawBaseSim))
        baseSimSkusMap.set(s.sku_id || k, s);
    }

    const scenSimSkusMap = new Map();
    for (const s of simResult.skus || []) {
      scenSimSkusMap.set(s.sku_id, s);
    }

    for (const sOpt of optResult.skus || []) {
      const skuId = sOpt.sku_id;
      const bOpt = baseOptSkusMap.get(skuId);
      const sSim = scenSimSkusMap.get(skuId);
      const bSim = baseSimSkusMap.get(skuId);

      if (
        bOpt &&
        sOpt.status === "ok" &&
        bOpt.status === "ok" &&
        sSim &&
        bSim
      ) {
        const sDetCost =
          sSim.deterministic?.mean_total_cost ??
          sSim.deterministic?.total_cost_mean ??
          0;
        const bDetCost =
          bSim.deterministic?.mean_total_cost ??
          bSim.deterministic?.total_cost_mean ??
          0;
        const sUncCost =
          sSim.uncertainty_aware?.mean_total_cost ??
          sSim.uncertainty_aware?.total_cost_mean ??
          0;
        const bUncCost =
          bSim.uncertainty_aware?.mean_total_cost ??
          bSim.uncertainty_aware?.total_cost_mean ??
          0;

        perSku.push({
          skuId,
          eoqBaseline: bOpt.eoq,
          eoqScenario: sOpt.eoq,
          ropDeterministicBaseline: bOpt.rop_deterministic,
          ropDeterministicScenario: sOpt.rop_deterministic,
          ropUncertaintyAwareBaseline: bOpt.rop_uncertainty_aware,
          ropUncertaintyAwareScenario: sOpt.rop_uncertainty_aware,
          totalCostDeterministicDelta: sDetCost - bDetCost,
          totalCostUncertaintyAwareDelta: sUncCost - bUncCost,
        });
      }
    }

    const output = RunWhatIfOutput.parse({
      whatIfRunId: whatIfDoc._id.toString(),
      overrides: args.overrides,
      baselineAssumptions,
      scenarioAssumptions,
      baseline: baselineTotals,
      scenario: scenarioTotals,
      deltas,
      perSku,
      note: "What-if results are a separate scenario. Baseline assumptions and results were not changed.",
    });

    return {
      output,
      evidence: {
        artifactType: "what_if_run",
        artifactId: whatIfDoc._id.toString(),
        skuId: null,
        label: "What-if scenario analysis",
      },
    };
  } finally {
    runningWhatIfUsers.delete(ctx.userId);
  }
}
