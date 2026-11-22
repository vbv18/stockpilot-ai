import mongoose from "mongoose";

const portfolioRunSchema = new mongoose.Schema(
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
    simulationRunId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "simulation_runs",
    },
    optimizationRunId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "optimization_runs",
    },
    assumptionSetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "assumption_sets",
    },
    budget: {
      type: Number,
      default: null,
    },
    capacity: {
      type: Number,
      default: null,
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

portfolioRunSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

export const PortfolioRunModel = mongoose.model(
  "portfolio_runs",
  portfolioRunSchema,
);
export default PortfolioRunModel;
