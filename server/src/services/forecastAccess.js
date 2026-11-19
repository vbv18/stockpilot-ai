import { AppError } from "../lib/errors.js";
import { ForecastRunModel } from "../models/forecastRun.model.js";

export async function getActiveForecastRun(userId, sessionId) {
  const run = await ForecastRunModel.findOne({
    userId,
    sessionId,
    status: "succeeded",
  }).sort({ createdAt: -1 });

  if (!run) {
    throw new AppError("NOT_FOUND", "Active forecast run not found");
  }
  return run;
}

export function stripForClient(forecast) {
  if (!forecast) return null;
  const clone = JSON.parse(JSON.stringify(forecast));
  if (Array.isArray(clone.skus)) {
    for (const s of clone.skus) {
      s.residual_blocks = null;
      s.residual_block_cutoffs = null;
    }
  }
  return clone;
}
