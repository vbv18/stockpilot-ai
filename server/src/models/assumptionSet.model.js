import mongoose from "mongoose";

const skuAssumptionSchema = new mongoose.Schema(
  {
    ordering_cost: {
      type: Number,
      required: true,
    },
    holding_cost_annual: {
      type: Number,
      required: true,
    },
    shortage_penalty: {
      type: Number,
      required: true,
    },
    lead_time_mean: {
      type: Number,
      required: true,
    },
    lead_time_std: {
      type: Number,
      default: 0,
    },
    service_level: {
      type: Number,
      required: true,
    },
    unit_cost: {
      type: Number,
      required: true,
    },
  },
  { _id: false },
);

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
    skus: {
      type: Map,
      of: skuAssumptionSchema,
      required: true,
    },
    provenance: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    budget: {
      type: Number,
      default: null,
    },
    capacity: {
      type: Number,
      default: null,
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
