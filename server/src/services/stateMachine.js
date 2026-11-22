import { SessionStatus } from "../contracts/common.js";

export const ALLOWED_TRANSITIONS = {
  created: ["uploading"],
  uploading: ["uploading", "validating"],
  validating: ["uploading", "validating", "dataset_ready", "validation_failed"],
  validation_failed: ["uploading", "validating"],
  dataset_ready: ["forecasting"],
  forecasting: ["forecast_ready", "forecast_failed", "dataset_ready"],
  forecast_failed: ["forecasting"],
  forecast_ready: ["assumptions_pending"],
  assumptions_pending: ["assumptions_pending", "optimizing"],
  optimizing: [
    "optimization_ready",
    "optimization_failed",
    "assumptions_pending",
  ],
  optimization_failed: ["assumptions_pending", "optimizing"],
  optimization_ready: ["assumptions_pending", "simulating"],
  simulating: ["completed", "simulation_failed", "optimization_ready"],
  simulation_failed: ["simulating", "assumptions_pending"],
  completed: ["assumptions_pending", "simulating"],
  cancelled: [],
};

export function canTransition(from, to) {
  return (ALLOWED_TRANSITIONS[from] || []).includes(to);
}

/** Statuses from which each action is allowed to START. */
export const ACTION_ALLOWED_FROM = {
  upload: ["created", "uploading", "validating", "validation_failed"],
  mapping: ["uploading", "validating", "validation_failed"],
  confirmDataset: ["validating"],
  forecast: ["dataset_ready", "forecast_failed"],
  assumptions: [
    "forecast_ready",
    "assumptions_pending",
    "optimization_failed",
    "optimization_ready",
    "simulation_failed",
    "completed",
  ],
  optimize: ["assumptions_pending", "optimization_failed"],
  simulate: ["optimization_ready", "simulation_failed", "completed"],
  portfolio: ["completed", "simulation_failed"],
  aiEligible: [
    "forecast_ready",
    "assumptions_pending",
    "optimizing",
    "optimization_ready",
    "optimization_failed",
    "simulating",
    "simulation_failed",
    "completed",
  ],
};

/** Session status to restore when a RUNNING job is cancelled. */
export const STATUS_AFTER_CANCEL = {
  validation: "uploading",
  transformation: "validating",
  forecast: "dataset_ready",
  optimization: "assumptions_pending",
  simulation: "optimization_ready",
  portfolio: "completed",
};
