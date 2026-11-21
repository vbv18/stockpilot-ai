import { AppError } from "../../../lib/errors.js";
import {
  GetInventoryRecommendationInput,
  GetInventoryRecommendationOutput,
} from "../../../contracts/ai.js";
import { computeSkuRisk } from "../../risk.js";

/**
 * get_inventory_recommendation tool
 */
export async function getInventoryRecommendation(rawArgs, bundle) {
  const args = GetInventoryRecommendationInput.parse(rawArgs);
  const { session, optimizationRun, simulationRun, assumptions } = bundle;

  if (!optimizationRun || !optimizationRun.result?.skus) {
    throw new AppError(
      "NOT_FOUND",
      "Optimization run not found for this session",
    );
  }

  const skuOpt = optimizationRun.result.skus[args.skuId];
  if (!skuOpt) {
    throw new AppError(
      "NOT_FOUND",
      `SKU ${args.skuId} is not part of this session`,
    );
  }

  if (!assumptions || !assumptions.values) {
    throw new AppError(
      "NOT_FOUND",
      "Assumption set not found for this session",
    );
  }

  const aVals = assumptions.values;
  const holdingCostPerUnitPerDay =
    aVals.holdingCostUnit === "per_unit_per_year"
      ? aVals.holdingCost / 365
      : aVals.holdingCost;

  const assumptionsView = {
    version: assumptions.version ?? 1,
    orderingCost: aVals.orderingCost,
    holdingCost: aVals.holdingCost,
    holdingCostUnit: aVals.holdingCostUnit || "per_unit_per_day",
    holdingCostPerUnitPerDay,
    shortagePenalty: aVals.shortagePenalty,
    leadTimeDays: aVals.leadTimeDays,
    targetServiceLevel: aVals.targetServiceLevel,
  };

  // Only include simulation if active simulation belongs to this optimization run
  const activeSim =
    simulationRun &&
    simulationRun.optimizationRunId === optimizationRun._id.toString()
      ? simulationRun
      : null;

  const skuRiskRaw = computeSkuRisk({
    opt: skuOpt,
    evaluation: null,
    simulation: activeSim?.result?.skus?.[args.skuId] || null,
    targetServiceLevel: aVals.targetServiceLevel,
  });
  const riskView = {
    skuId: args.skuId,
    level: skuRiskRaw.level,
    score: skuRiskRaw.score,
    flags: (skuRiskRaw.flags || []).map((f) => ({
      code: f.code,
      message: f.message,
    })),
  };

  const skuSim = activeSim?.result?.skus?.[args.skuId] || null;
  const stale =
    session.activeAssumptionSetId !== optimizationRun.assumptionSetId;

  const output = GetInventoryRecommendationOutput.parse({
    skuId: args.skuId,
    assumptions: assumptionsView,
    optimization: skuOpt,
    risk: riskView,
    simulation: skuSim,
    stale,
  });

  return {
    output,
    evidence: {
      artifactType: "optimization_run",
      artifactId: optimizationRun._id.toString(),
      skuId: args.skuId,
      label: `Inventory recommendation for SKU ${args.skuId}`,
    },
  };
}
