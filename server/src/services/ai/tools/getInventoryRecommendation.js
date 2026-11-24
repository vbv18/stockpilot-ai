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
    ordering_cost: skuAssump.ordering_cost ?? skuAssump.order_cost ?? 0,
    holding_cost_annual:
      skuAssump.holding_cost_annual ?? skuAssump.holding_rate ?? 0,
    shortage_penalty:
      skuAssump.shortage_penalty ?? skuAssump.shortage_cost ?? 0,
    order_cost: skuAssump.order_cost ?? skuAssump.ordering_cost ?? 0,
    holding_rate: skuAssump.holding_rate ?? skuAssump.holding_cost_annual ?? 0,
    shortage_cost: skuAssump.shortage_cost ?? skuAssump.shortage_penalty ?? 0,
    lead_time_mean: skuAssump.lead_time_mean,
    lead_time_std: skuAssump.lead_time_std ?? 0,
    service_level:
      skuAssump.service_level ?? skuAssump.target_service_level ?? 0.95,
    target_service_level:
      skuAssump.target_service_level ?? skuAssump.service_level ?? 0.95,
    unit_cost: skuAssump.unit_cost,
    moq: skuAssump.moq ?? 1,
    pack_size: skuAssump.pack_size ?? 1,
    initial_stock: skuAssump.initial_stock ?? 0,
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
