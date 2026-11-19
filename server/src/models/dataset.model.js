import mongoose from "mongoose";

const fileRefSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    bytes: { type: Number, required: true },
    sha256: { type: String, required: true },
    originalName: { type: String },
    encoding: { type: String },
    delimiter: { type: String },
  },
  { _id: false },
);

const processedFileRefSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    bytes: { type: Number, required: true },
    sha256: { type: String, required: true },
  },
  { _id: false },
);

const datasetSchema = new mongoose.Schema(
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
    originalFileRef: {
      type: fileRefSchema,
      required: true,
    },
    processedFileRef: {
      type: processedFileRefSchema,
      default: null,
    },
    aggregatedFileRef: {
      type: processedFileRefSchema,
      default: null,
    },
    datasetSchema: {
      columns: [{ type: String }],
    },
    preview: {
      type: [[String]],
      default: [],
    },
    mapping: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    rowCounts: {
      totalDataRows: { type: Number, default: 0 },
      acceptedRows: { type: Number, default: 0 },
      rejectedRows: { type: Number, default: 0 },
      processedRows: { type: Number, default: 0 },
    },
    validationSummary: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    transformationConfig: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    status: {
      type: String,
      enum: ["uploaded", "validating", "validated", "validation_failed", "transforming", "ready", "replaced"],
      default: "uploaded",
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

datasetSchema.index({ userId: 1, sessionId: 1, createdAt: -1 });

export const DatasetModel = mongoose.model("datasets", datasetSchema);
export default DatasetModel;
