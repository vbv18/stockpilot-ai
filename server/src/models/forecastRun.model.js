import mongoose from "mongoose";

const forecastRunSchema = new mongoose.Schema(
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
    datasetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "datasets",
    },
    modelConfig: {
      primary: { type: String },
      baseline: { type: String },
      params: { type: mongoose.Schema.Types.Mixed },
    },
    evaluationConfig: {
      holdoutDays: { type: Number },
    },
    metrics: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    result: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    runMeta: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    seed: {
      type: Number,
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

forecastRunSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

export const ForecastRunModel = mongoose.model("forecast_runs", forecastRunSchema);
export default ForecastRunModel;
