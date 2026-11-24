import mongoose from "mongoose";

const skuAssumptionSchema = new mongoose.Schema(
  {
    sku_id: {
      type: String,
      required: true,
    },
    unit_cost: {
      type: Number,
      required: true,
    },
    order_cost: {
      type: Number,
      required: true,
    },
    holding_rate: {
      type: Number,
      required: true,
    },
    shortage_cost: {
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
    target_service_level: {
      type: Number,
      required: true,
    },
    moq: {
      type: Number,
      default: 1,
    },
    pack_size: {
      type: Number,
      default: 1,
    },
    initial_stock: {
      type: Number,
      default: 0,
    },
    ordering_cost: { type: Number },
    holding_cost_annual: { type: Number },
    shortage_penalty: { type: Number },
    service_level: { type: Number },
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
