import { AppError } from "../../../lib/errors.js";
import {
  CompareInventoryPoliciesInput,
  CompareInventoryPoliciesOutput,
} from "../../../contracts/ai.js";

/**
 * compare_inventory_policies tool
 */
export async function compareInventoryPolicies(rawArgs, bundle) {
  const args = CompareInventoryPoliciesInput.parse(rawArgs);
  const { simulationRun } = bundle;

  if (!simulationRun || !simulationRun.result) {
    throw new AppError(
      "NOT_FOUND",
      "Simulation run not found for this session",
    );
  }

  const simResult = simulationRun.result;
  const skuCount = simResult.skus ? Object.keys(simResult.skus).length : 0;

  if (args.skuId) {
    const skuSim = simResult.skus?.[args.skuId];
    if (!skuSim) {
      throw new AppError(
        "NOT_FOUND",
        `SKU ${args.skuId} is not part of this simulation`,
      );
    }

    const output = CompareInventoryPoliciesOutput.parse({
      scope: "sku",
      simulationRunId: simulationRun._id.toString(),
      scenarioCount: simulationRun.scenarioCount ?? 500,
      horizonDays: simulationRun.horizonDays ?? 90,
      seed: simulationRun.seed ?? 42,
      sku: skuSim,
      aggregate: null,
      skuCount,
    });

    return {
      output,
      evidence: {
        artifactType: "simulation_run",
        artifactId: simulationRun._id.toString(),
        skuId: args.skuId,
        label: `Simulation comparison for SKU ${args.skuId}`,
      },
    };
  }

  // Aggregate scope
  const output = CompareInventoryPoliciesOutput.parse({
    scope: "aggregate",
    simulationRunId: simulationRun._id.toString(),
    scenarioCount: simulationRun.scenarioCount ?? 500,
    horizonDays: simulationRun.horizonDays ?? 90,
    seed: simulationRun.seed ?? 42,
    sku: null,
    aggregate: simResult.aggregate || null,
    skuCount,
  });

  return {
    output,
    evidence: {
      artifactType: "simulation_run",
      artifactId: simulationRun._id.toString(),
      skuId: null,
      label: "Aggregate simulation policy comparison",
    },
  };
}
