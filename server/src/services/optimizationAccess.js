import { AppError } from "../lib/errors.js";
import { AssumptionSetModel } from "../models/assumptionSet.model.js";
import { ForecastRunModel } from "../models/forecastRun.model.js";
import { OptimizationRunModel } from "../models/optimizationRun.model.js";
import { SimulationRunModel } from "../models/simulationRun.model.js";
import { computeSkuRisk } from "./risk.js";

export async function getActiveOptimizationRun(userId, sessionId) {
  const run = await OptimizationRunModel.findOne({
    userId,
    sessionId,
    status: "succeeded",
  }).sort({ createdAt: -1 });

  if (!run) {
    throw new AppError("NOT_FOUND", "Active optimization run not found");
  }
  return run;
}

export async function getActiveAssumptionSetForRun(run) {
  const assumptionSet = await AssumptionSetModel.findById(run.assumptionSetId);
  if (!assumptionSet) {
    throw new AppError(
      "NOT_FOUND",
      "Assumption set for optimization run not found",
    );
  }
  return assumptionSet;
}

export async function buildSessionRisk(userId, sessionId) {
  const optRun = await OptimizationRunModel.findOne({
    userId,
    sessionId,
    status: "succeeded",
  }).sort({ createdAt: -1 });

  if (!optRun || !optRun.result?.skus) {
    return { targetServiceLevel: 0.95, risks: [] };
  }

  const assumptionSet = await AssumptionSetModel.findById(
    optRun.assumptionSetId,
  );
  const targetServiceLevel = assumptionSet
    ? assumptionSet.targetServiceLevel
    : 0.95;

  const forecastRun = await ForecastRunModel.findById(optRun.forecastRunId);
  const evaluationsBySku = new Map();
  if (forecastRun?.result?.evaluation?.skus) {
    for (const e of forecastRun.result.evaluation.skus) {
      evaluationsBySku.set(e.sku_id, e);
    }
  }

  // Find simulation run for this optimization run
  const simRun = await SimulationRunModel.findOne({
    userId,
    sessionId,
    optimizationRunId: optRun._id,
    status: "succeeded",
  }).sort({ createdAt: -1 });

  const simulationsBySku = new Map();
  if (simRun?.policyResults?.skus) {
    for (const s of simRun.policyResults.skus) {
      simulationsBySku.set(s.sku_id, s);
    }
  }

  const risks = optRun.result.skus.map((optSku) => {
    return computeSkuRisk({
      opt: optSku,
      evaluation: evaluationsBySku.get(optSku.sku_id) || null,
      simulation: simulationsBySku.get(optSku.sku_id) || null,
      targetServiceLevel,
    });
  });

  return { targetServiceLevel, risks };
}
