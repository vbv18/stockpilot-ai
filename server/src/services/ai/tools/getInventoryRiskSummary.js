import { AppError } from "../../../lib/errors.js";
import { GetRiskSummaryInput, GetRiskSummaryOutput } from "../../../contracts/ai.js";
import { buildSessionRisk } from "../../risk.js";

/**
 * get_inventory_risk_summary tool
 */
export async function getInventoryRiskSummary(rawArgs, bundle) {
  const args = GetRiskSummaryInput.parse(rawArgs);
  const { optimizationRun, simulationRun, assumptions } = bundle;

  if (!optimizationRun || !optimizationRun.result) {
    throw new AppError("NOT_FOUND", "Optimization run not found for this session");
  }

  const targetServiceLevel = assumptions?.values?.targetServiceLevel ?? 0.95;
  const risks = buildSessionRisk(optimizationRun, simulationRun, assumptions);

  let rankedBy = args.rankBy;
  if (
    (!simulationRun || !simulationRun.result?.skus) &&
    (rankedBy === "stockout_units_deterministic" || rankedBy === "stockout_units_uncertainty_aware")
  ) {
    rankedBy = "risk_score";
  }

  // Sorting
  const sorted = [...risks].sort((a, b) => {
    if (rankedBy === "stockout_units_deterministic") {
      const aVal = a.stockoutUnitsDeterministic ?? 0;
      const bVal = b.stockoutUnitsDeterministic ?? 0;
      if (bVal !== aVal) return bVal - aVal;
    } else if (rankedBy === "stockout_units_uncertainty_aware") {
      const aVal = a.stockoutUnitsUncertaintyAware ?? 0;
      const bVal = b.stockoutUnitsUncertaintyAware ?? 0;
      if (bVal !== aVal) return bVal - aVal;
    } else {
      if (b.score !== a.score) return b.score - a.score;
    }
    return a.skuId.localeCompare(b.skuId);
  });

  const topItems = sorted.slice(0, args.topN).map((r) => ({
    skuId: r.skuId,
    level: r.level,
    score: r.score,
    flags: (r.flags || []).map((f) => ({
      code: f.code,
      message: f.message,
    })),
    stockoutUnitsDeterministic: r.stockoutUnitsDeterministic ?? null,
    stockoutUnitsUncertaintyAware: r.stockoutUnitsUncertaintyAware ?? null,
  }));

  const countsByLevel = { low: 0, medium: 0, high: 0 };
  for (const r of risks) {
    countsByLevel[r.level] = (countsByLevel[r.level] || 0) + 1;
  }

  const output = GetRiskSummaryOutput.parse({
    rankedBy,
    targetServiceLevel,
    simulationAvailable: Boolean(simulationRun && simulationRun.result),
    items: topItems,
    countsByLevel,
    criteria: "Risk flags are screening criteria, not predictions. Stockout tolerance = 1 minus the target service level.",
  });

  return {
    output,
    evidence: {
      artifactType: "optimization_run",
      artifactId: optimizationRun._id.toString(),
      skuId: null,
      label: "Inventory risk summary",
    },
  };
}
