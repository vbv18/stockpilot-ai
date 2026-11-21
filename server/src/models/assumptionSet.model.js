import mongoose from "mongoose";
import { HOLDING_COST_UNITS } from "../contracts/pipeline.js";

const assumptionSetSchema = new mongoose.Schema(
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
    version: {
      type: Number,
      required: true,
    },
    orderingCost: {
      type: Number,
      required: true,
    },
    holdingCost: {
      type: Number,
      required: true,
    },
    holdingCostUnit: {
      type: String,
      enum: HOLDING_COST_UNITS,
      required: true,
    },
    shortagePenalty: {
      type: Number,
      required: true,
    },
    leadTimeDays: {
      type: Number,
      required: true,
    },
    targetServiceLevel: {
      type: Number,
      required: true,
    },
    provenance: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    confirmedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

assumptionSetSchema.index({ sessionId: 1, version: 1 }, { unique: true });

export const AssumptionSetModel = mongoose.model(
  "assumption_sets",
  assumptionSetSchema,
);
export default AssumptionSetModel;
