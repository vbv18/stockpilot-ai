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

  const skusMap =
    assumptions?.skus instanceof Map
      ? Object.fromEntries(assumptions.skus)
      : assumptions?.skus ||
        (assumptions?.toObject
          ? assumptions.toObject({ flattenMaps: true }).skus
          : null) ||
        {};

  const skuAssump = skusMap[args.skuId];
  if (!skuAssump) {
    throw new AppError(
      "NOT_FOUND",
      `Assumptions for SKU ${args.skuId} not found`,
    );
  }

  const assumptionsView = {
    version: assumptions.version ?? 1,
    skuId: args.skuId,
    ordering_cost: skuAssump.ordering_cost,
    holding_cost_annual: skuAssump.holding_cost_annual,
    shortage_penalty: skuAssump.shortage_penalty,
    lead_time_mean: skuAssump.lead_time_mean,
    lead_time_std: skuAssump.lead_time_std ?? 0,
    service_level: skuAssump.service_level,
    unit_cost: skuAssump.unit_cost,
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
    targetServiceLevel: skuAssump.service_level,
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
