import { AppError } from "../../../lib/errors.js";
import {
  GetDependencyPairsInput,
  GetDependencyPairsOutput,
} from "../../../contracts/ai.js";

/**
 * get_dependency_pairs tool
 * Returns demand correlation / dependency pairs (|rho| >= 0.3) and risk pooling ratio.
 */
export async function getDependencyPairs(rawArgs, bundle) {
  const normalizedArgs = {
    ...rawArgs,
    skuId: rawArgs?.skuId || rawArgs?.sku || undefined,
  };
  const args = GetDependencyPairsInput.parse(normalizedArgs);
  const { optimizationRun } = bundle;

  if (!optimizationRun || !optimizationRun.result?.dependency) {
    const output = GetDependencyPairsOutput.parse({
      status: "not_available",
      optimizationRunId: optimizationRun?._id?.toString() || null,
      skuId: args.skuId || null,
      poolingRatio: null,
      pairsCount: 0,
      pairs: [],
      message:
        "Demand dependency analysis not found for this optimization run.",
    });
    return {
      output,
      evidence: {
        artifactType: "optimization_run",
        artifactId:
          optimizationRun?._id?.toString() || bundle.session._id.toString(),
        skuId: args.skuId || null,
        label: "Demand dependency pairs (not available)",
      },
    };
  }

  const dep = optimizationRun.result.dependency;
  const targetSku = args.skuId || null;
  const allPairs = dep.pairs || [];

  const filteredPairs = targetSku
    ? allPairs.filter((p) => p.sku_i === targetSku || p.sku_j === targetSku)
    : allPairs;

  const output = GetDependencyPairsOutput.parse({
    status: "computed",
    optimizationRunId: optimizationRun._id.toString(),
    skuId: targetSku,
    poolingRatio: dep.pooling_ratio ?? null,
    pairsCount: filteredPairs.length,
    pairs: filteredPairs.map((p) => ({
      sku_i: p.sku_i,
      sku_j: p.sku_j,
      rho: p.rho,
      relation: p.relation,
    })),
    message: null,
  });

  return {
    output,
    evidence: {
      artifactType: "optimization_run",
      artifactId: optimizationRun._id.toString(),
      skuId: targetSku,
      label: targetSku
        ? `Demand dependency pairs for SKU ${targetSku}`
        : "Demand dependency pairs and risk pooling ratio",
    },
  };
}
