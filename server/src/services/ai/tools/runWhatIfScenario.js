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
      const orderCost = baseVals.order_cost ?? baseVals.ordering_cost ?? 100;
      const holdingRate =
        baseVals.holding_rate ?? baseVals.holding_cost_annual ?? 10;
      const shortageCost =
        baseVals.shortage_cost ?? baseVals.shortage_penalty ?? 50;
      const targetServiceLevel =
        baseVals.target_service_level ?? baseVals.service_level ?? 0.95;
      const leadTimeMean = baseVals.lead_time_mean ?? 7;
      const leadTimeStd = baseVals.lead_time_std ?? 0;
      const unitCost = baseVals.unit_cost ?? 20;
      const moq = baseVals.moq ?? 1;
      const packSize = baseVals.pack_size ?? 1;
      const initialStock = baseVals.initial_stock ?? 0;

      const bVals = {
        sku_id: skuId,
        unit_cost: unitCost,
        order_cost: orderCost,
        holding_rate: holdingRate,
        shortage_cost: shortageCost,
        lead_time_mean: leadTimeMean,
        lead_time_std: leadTimeStd,
        target_service_level: targetServiceLevel,
        moq,
        pack_size: packSize,
        initial_stock: initialStock,
        ordering_cost: orderCost,
        holding_cost_annual: holdingRate,
        shortage_penalty: shortageCost,
        service_level: targetServiceLevel,
      };
      baselineAssumptions[skuId] = bVals;

      const ovr = args.overrides[skuId] || {};
      const scOrderCost = ovr.order_cost ?? ovr.ordering_cost ?? orderCost;
      const scHoldingRate =
        ovr.holding_rate ?? ovr.holding_cost_annual ?? holdingRate;
      const scShortageCost =
        ovr.shortage_cost ?? ovr.shortage_penalty ?? shortageCost;
      const scLeadTimeMean = ovr.lead_time_mean ?? leadTimeMean;
      const scLeadTimeStd = ovr.lead_time_std ?? leadTimeStd;
      const scServiceLevel =
        ovr.target_service_level ?? ovr.service_level ?? targetServiceLevel;
      const scUnitCost = ovr.unit_cost ?? unitCost;
      const scMoq = ovr.moq ?? moq;
      const scPackSize = ovr.pack_size ?? packSize;
      const scInitialStock = ovr.initial_stock ?? initialStock;

      scenarioAssumptions[skuId] = {
        sku_id: skuId,
        unit_cost: scUnitCost,
        order_cost: scOrderCost,
        holding_rate: scHoldingRate,
        shortage_cost: scShortageCost,
        lead_time_mean: scLeadTimeMean,
        lead_time_std: scLeadTimeStd,
        target_service_level: scServiceLevel,
        moq: scMoq,
        pack_size: scPackSize,
        initial_stock: scInitialStock,
        ordering_cost: scOrderCost,
        holding_cost_annual: scHoldingRate,
        shortage_penalty: scShortageCost,
        service_level: scServiceLevel,
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

      const ropDet = optSku.rop_deterministic ?? optSku.s_det ?? 0;
      const ropUnc = optSku.rop_uncertainty_aware ?? optSku.s_emp ?? 0;
      const ropQua = optSku.rop_quantile ?? optSku.s_quant ?? ropUnc;

      simulateSkus.push({
        sku_id: optSku.sku_id,
        forecast_mean: fcSku.autoets_mean,
        residual_blocks: fcSku.residual_blocks,
        residual_std: fcSku.residual_std,
        eoq: optSku.eoq,
        rop_deterministic: ropDet,
        rop_uncertainty_aware: ropUnc,
        rop_quantile: ropQua,
        s_det: optSku.s_det ?? ropDet,
        s_quant: optSku.s_quant ?? ropQua,
        s_emp: optSku.s_emp ?? ropUnc,
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

    const baseDet = baseAgg.deterministic || baseAgg.s_det || {};
    const baseUnc = baseAgg.uncertainty_aware || baseAgg.s_emp || {};
    const baseQua = baseAgg.quantile || baseAgg.s_quant || {};

    const scenDet = scenAgg.deterministic || scenAgg.s_det || {};
    const scenUnc = scenAgg.uncertainty_aware || scenAgg.s_emp || {};
    const scenQua = scenAgg.quantile || scenAgg.s_quant || {};

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
      quantile: mapTotals(baseQua),
    };
    const scenarioTotals = {
      deterministic: mapTotals(scenDet),
      uncertaintyAware: mapTotals(scenUnc),
      quantile: mapTotals(scenQua),
    };

    const deltas = {
      deterministicTotalCost:
        scenarioTotals.deterministic.totalCost -
        baselineTotals.deterministic.totalCost,
      uncertaintyAwareTotalCost:
        scenarioTotals.uncertaintyAware.totalCost -
        baselineTotals.uncertaintyAware.totalCost,
      quantileTotalCost:
        scenarioTotals.quantile.totalCost - baselineTotals.quantile.totalCost,
      deterministicServiceLevel:
        scenarioTotals.deterministic.serviceLevel -
        baselineTotals.deterministic.serviceLevel,
      uncertaintyAwareServiceLevel:
        scenarioTotals.uncertaintyAware.serviceLevel -
        baselineTotals.uncertaintyAware.serviceLevel,
      quantileServiceLevel:
        scenarioTotals.quantile.serviceLevel -
        baselineTotals.quantile.serviceLevel,
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
        const sDet = sSim.deterministic || sSim.s_det || {};
        const bDet = bSim.deterministic || bSim.s_det || {};
        const sDetCost =
          sDet.mean_total_cost ?? sDet.total_cost_mean ?? sDet.total_cost ?? 0;
        const bDetCost =
          bDet.mean_total_cost ?? bDet.total_cost_mean ?? bDet.total_cost ?? 0;

        const sUnc = sSim.uncertainty_aware || sSim.s_emp || {};
        const bUnc = bSim.uncertainty_aware || bSim.s_emp || {};
        const sUncCost =
          sUnc.mean_total_cost ?? sUnc.total_cost_mean ?? sUnc.total_cost ?? 0;
        const bUncCost =
          bUnc.mean_total_cost ?? bUnc.total_cost_mean ?? bUnc.total_cost ?? 0;

        const sQua = sSim.quantile || sSim.s_quant || {};
        const bQua = bSim.quantile || bSim.s_quant || {};
        const sQuaCost =
          sQua.mean_total_cost ?? sQua.total_cost_mean ?? sQua.total_cost ?? 0;
        const bQuaCost =
          bQua.mean_total_cost ?? bQua.total_cost_mean ?? bQua.total_cost ?? 0;

        perSku.push({
          skuId,
          eoqBaseline: bOpt.eoq,
          eoqScenario: sOpt.eoq,
          ropDeterministicBaseline: bOpt.rop_deterministic ?? bOpt.s_det ?? 0,
          ropDeterministicScenario: sOpt.rop_deterministic ?? sOpt.s_det ?? 0,
          ropUncertaintyAwareBaseline:
            bOpt.rop_uncertainty_aware ?? bOpt.s_emp ?? 0,
          ropUncertaintyAwareScenario:
            sOpt.rop_uncertainty_aware ?? sOpt.s_emp ?? 0,
          ropQuantileBaseline:
            bOpt.rop_quantile ??
            bOpt.s_quant ??
            bOpt.rop_uncertainty_aware ??
            0,
          ropQuantileScenario:
            sOpt.rop_quantile ??
            sOpt.s_quant ??
            sOpt.rop_uncertainty_aware ??
            0,
          totalCostDeterministicDelta: sDetCost - bDetCost,
          totalCostUncertaintyAwareDelta: sUncCost - bUncCost,
          totalCostQuantileDelta: sQuaCost - bQuaCost,
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
      note: "What-if results are a separate scenario across all three policies. Baseline assumptions and results were not changed.",
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
