import mongoose from "mongoose";

const replayRunSchema = new mongoose.Schema(
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
    assumptionSetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "assumption_sets",
    },
    seed: {
      type: Number,
    },
    holdoutDays: {
      type: Number,
      default: 28,
    },
    results: {
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

replayRunSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

export const ReplayRunModel = mongoose.model(
  "replay_runs",
  replayRunSchema,
);
export default ReplayRunModel;
