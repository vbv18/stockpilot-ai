import { AppError } from "../../../lib/errors.js";
import { AssumptionsBody } from "../../../contracts/pipeline.js";
import { RunWhatIfInput, RunWhatIfOutput } from "../../../contracts/ai.js";
import { PyOptimizeRequest, PyOptimizeResponse, PySimulateRequest, PySimulateResponse } from "../../../contracts/python.js";
import { WhatIfRunModel } from "../../../models/whatIfRun.model.js";
import { statsPost } from "../../statsClient.js";

// In-memory concurrency guard: one what-if per user at a time
const runningWhatIfUsers = new Set();

/**
 * run_what_if_scenario tool
 */
export async function runWhatIfScenario(rawArgs, bundle, ctx) {
  const args = RunWhatIfInput.parse(rawArgs);
  const { session, forecastRun, optimizationRun, simulationRun, assumptions } = bundle;

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
    const baseVals = assumptions.values;
    const effective = {
      orderingCost: baseVals.orderingCost,
      holdingCost: baseVals.holdingCost,
      holdingCostUnit: baseVals.holdingCostUnit,
      shortagePenalty: baseVals.shortagePenalty,
      leadTimeDays: baseVals.leadTimeDays,
      targetServiceLevel: baseVals.targetServiceLevel,
      ...args.overrides,
    };

    // Validate with AssumptionsBody omitting confirmed
    const validatedEffective = AssumptionsBody.omit({ confirmed: true }).parse(effective);

    // Baseline assumptions view
    const baseHday =
      baseVals.holdingCostUnit === "per_unit_per_year"
        ? baseVals.holdingCost / 365
        : baseVals.holdingCost;
    const baselineAssumptions = {
      orderingCost: baseVals.orderingCost,
      holdingCost: baseVals.holdingCost,
      holdingCostUnit: baseVals.holdingCostUnit,
      holdingCostPerUnitPerDay: baseHday,
      shortagePenalty: baseVals.shortagePenalty,
      leadTimeDays: baseVals.leadTimeDays,
      targetServiceLevel: baseVals.targetServiceLevel,
    };

    // Scenario assumptions view
    const scenHday =
      validatedEffective.holdingCostUnit === "per_unit_per_year"
        ? validatedEffective.holdingCost / 365
        : validatedEffective.holdingCost;
    const scenarioAssumptions = {
      orderingCost: validatedEffective.orderingCost,
      holdingCost: validatedEffective.holdingCost,
      holdingCostUnit: validatedEffective.holdingCostUnit,
      holdingCostPerUnitPerDay: scenHday,
      shortagePenalty: validatedEffective.shortagePenalty,
      leadTimeDays: validatedEffective.leadTimeDays,
      targetServiceLevel: validatedEffective.targetServiceLevel,
    };

    // Prepare forecast skus for /optimize
    const forecastSkus = {};
    for (const [skuId, fData] of Object.entries(forecastRun.result.skus)) {
      if (fData.status === "ok") {
        forecastSkus[skuId] = {
          autoets_mean: fData.autoets_mean,
          residual_blocks: fData.residual_blocks,
        };
      }
    }

    const pyOptimizeReq = {
      session_id: session._id.toString(),
      params: {
        ordering_cost: validatedEffective.orderingCost,
        holding_cost: validatedEffective.holdingCost,
        holding_cost_unit: validatedEffective.holdingCostUnit,
        lead_time_days: validatedEffective.leadTimeDays,
        target_service_level: validatedEffective.targetServiceLevel,
        n_bootstrap: 2000,
        block_size: 28,
        bootstrap_seed: 42,
      },
      skus: forecastSkus,
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

    const simSkus = {};
    for (const [skuId, skuOpt] of Object.entries(optResult.skus)) {
      if (skuOpt.status === "ok") {
        const origForecastSku = forecastRun.result.skus[skuId];
        simSkus[skuId] = {
          mean_path: origForecastSku.autoets_mean,
          residual_blocks: origForecastSku.residual_blocks,
          deterministic: {
            eoq: skuOpt.eoq,
            rop: skuOpt.rop_deterministic,
          },
          uncertainty_aware: {
            eoq: skuOpt.eoq,
            rop: skuOpt.rop_uncertainty_aware,
          },
        };
      }
    }

    const pySimulateReq = {
      session_id: session._id.toString(),
      params: {
        scenarios: scenarioCount,
        horizon_days: horizonDays,
        lead_time_days: validatedEffective.leadTimeDays,
        ordering_cost: validatedEffective.orderingCost,
        holding_cost: validatedEffective.holdingCost,
        holding_cost_unit: validatedEffective.holdingCostUnit,
        shortage_penalty: validatedEffective.shortagePenalty,
        block_size: 28,
        seed,
      },
      skus: simSkus,
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
      overrides: args.overrides,
      baseline: {
        assumptions: baselineAssumptions,
        optimizationRunId: optimizationRun._id.toString(),
        simulationRunId: simulationRun._id.toString(),
      },
      scenario: {
        assumptions: scenarioAssumptions,
        optimizationResult: optResult,
        simulationResult: simResult,
      },
    });

    const baseAgg = simulationRun.result.aggregate || {};
    const scenAgg = simResult.aggregate || {};

    const baseDet = baseAgg.deterministic || {};
    const baseUnc = baseAgg.uncertainty_aware || {};
    const scenDet = scenAgg.deterministic || {};
    const scenUnc = scenAgg.uncertainty_aware || {};

    const mapTotals = (t) => ({
      totalCost: t.mean_total_cost ?? 0,
      orderingCost: t.mean_ordering_cost ?? 0,
      holdingCost: t.mean_holding_cost ?? 0,
      shortageCost: t.mean_shortage_cost ?? 0,
      serviceLevel: t.service_level ?? 0,
      stockoutUnits: t.mean_stockout_units ?? 0,
      avgInventory: t.mean_ending_inventory ?? 0,
      orders: t.mean_orders_placed ?? 0,
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
      deterministicTotalCost: scenarioTotals.deterministic.totalCost - baselineTotals.deterministic.totalCost,
      uncertaintyAwareTotalCost: scenarioTotals.uncertaintyAware.totalCost - baselineTotals.uncertaintyAware.totalCost,
      deterministicServiceLevel: scenarioTotals.deterministic.serviceLevel - baselineTotals.deterministic.serviceLevel,
      uncertaintyAwareServiceLevel: scenarioTotals.uncertaintyAware.serviceLevel - baselineTotals.uncertaintyAware.serviceLevel,
    };

    const perSku = [];
    const baseOptSkus = optimizationRun.result.skus || {};
    const baseSimSkus = simulationRun.result.skus || {};

    for (const [skuId, sOpt] of Object.entries(optResult.skus)) {
      const bOpt = baseOptSkus[skuId];
      const sSim = simResult.skus?.[skuId];
      const bSim = baseSimSkus[skuId];

      if (bOpt && sOpt.status === "ok" && bOpt.status === "ok" && sSim && bSim) {
        const sDetCost = sSim.deterministic?.mean_total_cost ?? 0;
        const bDetCost = bSim.deterministic?.mean_total_cost ?? 0;
        const sUncCost = sSim.uncertainty_aware?.mean_total_cost ?? 0;
        const bUncCost = bSim.uncertainty_aware?.mean_total_cost ?? 0;

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
