import mongoose from "mongoose";
import { JOB_STAGES } from "../contracts/common.js";

const jobSchema = new mongoose.Schema(
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
    stage: {
      type: String,
      enum: JOB_STAGES,
      required: true,
    },
    status: {
      type: String,
      enum: ["queued", "running", "succeeded", "failed", "cancelled"],
      default: "queued",
    },
    inputHash: {
      type: String,
      default: null,
    },
    input: {
      type: mongoose.Schema.Types.Mixed,
    },
    progress: {
      pct: { type: Number, default: 0 },
      message: { type: String, default: "" },
    },
    errorCode: {
      type: String,
      default: null,
    },
    userMessage: {
      type: String,
      default: null,
    },
    retryable: {
      type: Boolean,
      default: false,
    },
    resultRef: {
      collection: { type: String },
      id: { type: mongoose.Schema.Types.ObjectId },
    },
    requestId: {
      type: String,
      default: null,
    },
    startedAt: {
      type: Date,
      default: null,
    },
    finishedAt: {
      type: Date,
      default: null,
    },
    cancelRequested: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  },
);

jobSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

jobSchema.index(
  { sessionId: 1, stage: 1, inputHash: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["queued", "running"] } },
  },
);

export const JobModel = mongoose.model("jobs", jobSchema);
export default JobModel;
