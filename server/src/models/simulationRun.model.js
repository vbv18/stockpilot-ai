import mongoose from "mongoose";

const simulationRunSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "users",
    },
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "analysis_sessions",
    },
    optimizationRunId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "optimization_runs",
    },
    scenarioCount: {
      type: Number,
      required: true,
    },
    horizonDays: {
      type: Number,
      required: true,
    },
    seed: {
      type: Number,
    },
    policyDefinitions: {
      type: mongoose.Schema.Types.Mixed,
    },
    policyResults: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ["running", "succeeded", "failed", "cancelled"],
      default: "running",
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "jobs",
    },
    error: {
      code: { type: String, default: null },
      message: { type: String, default: null },
    },
  },
  {
    timestamps: true,
  },
);

simulationRunSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

export const SimulationRunModel = mongoose.model(
  "simulation_runs",
  simulationRunSchema,
);
export default SimulationRunModel;
