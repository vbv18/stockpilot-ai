import mongoose from "mongoose";

const whatIfRunSchema = new mongoose.Schema(
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
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "ai_conversations",
    },
    baselineOptimizationRunId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "optimization_runs",
    },
    baselineSimulationRunId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "simulation_runs",
    },
    overrides: {
      type: mongoose.Schema.Types.Mixed,
    },
    effectiveAssumptions: {
      type: mongoose.Schema.Types.Mixed,
    },
    optimizationResult: {
      type: mongoose.Schema.Types.Mixed,
    },
    simulationResult: {
      type: mongoose.Schema.Types.Mixed,
    },
    comparison: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  },
);

whatIfRunSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

export const WhatIfRunModel = mongoose.model("what_if_runs", whatIfRunSchema);
export default WhatIfRunModel;
