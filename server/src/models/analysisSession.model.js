import mongoose from "mongoose";
import { SESSION_STATUSES, STAGE_NAMES } from "../contracts/common.js";

const stageSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["not_started", "running", "succeeded", "failed", "cancelled"],
      default: "not_started",
    },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    errorCode: { type: String, default: null },
    userMessage: { type: String, default: null },
    retryable: { type: Boolean, default: false },
    lastJobId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const analysisSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "users",
    },
    name: {
      type: String,
      required: true,
      maxlength: 120,
    },
    status: {
      type: String,
      enum: SESSION_STATUSES,
      default: "created",
    },
    stages: {
      dataset: { type: stageSchema, default: () => ({}) },
      forecast: { type: stageSchema, default: () => ({}) },
      optimization: { type: stageSchema, default: () => ({}) },
      simulation: { type: stageSchema, default: () => ({}) },
      portfolio: { type: stageSchema, default: () => ({}) },
    },
    budget: {
      type: Number,
      default: null,
    },
    capacity: {
      type: Number,
      default: null,
    },
    activeDatasetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "datasets",
    },
    activeForecastRunId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "forecast_runs",
    },
    activeAssumptionSetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "assumption_sets",
    },
    activeOptimizationRunId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "optimization_runs",
    },
    activeSimulationRunId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "simulation_runs",
    },
    activeReplayRunId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "replay_runs",
    },
    activePortfolioRunId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      ref: "portfolio_runs",
    },
    aiIndex: {
      status: {
        type: String,
        enum: ["not_indexed", "pending", "indexed", "failed", "skipped"],
        default: "not_indexed",
      },
      updatedAt: { type: Date, default: null },
      contentVersion: { type: Number, default: 0 },
      errorMessage: { type: String, default: null },
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

analysisSessionSchema.index({ userId: 1, createdAt: -1 });
analysisSessionSchema.index({ userId: 1, status: 1 });
analysisSessionSchema.index({ userId: 1, archivedAt: 1 });

export const AnalysisSessionModel = mongoose.model(
  "analysis_sessions",
  analysisSessionSchema,
);
export default AnalysisSessionModel;
