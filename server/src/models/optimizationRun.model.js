import mongoose from "mongoose";

const optimizationRunSchema = new mongoose.Schema(
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
    assumptionSetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "assumption_sets",
    },
    forecastRunId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "forecast_runs",
    },
    policyConfig: {
      nBootstrap: { type: Number },
      blockSize: { type: Number },
      bootstrapSeed: { type: Number },
      orderQuantityRule: { type: String, default: "EOQ_both_policies" },
    },
    result: {
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

optimizationRunSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

export const OptimizationRunModel = mongoose.model(
  "optimization_runs",
  optimizationRunSchema,
);
export default OptimizationRunModel;
