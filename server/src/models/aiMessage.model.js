import mongoose from "mongoose";

const aiMessageSchema = new mongoose.Schema(
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
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      ref: "ai_conversations",
    },
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    structured: {
      type: mongoose.Schema.Types.Mixed,
    },
    evidenceRefs: {
      type: mongoose.Schema.Types.Mixed,
    },
    toolTrace: {
      type: mongoose.Schema.Types.Mixed,
    },
    modelMeta: {
      provider: { type: String },
      model: { type: String },
      latencyMs: { type: Number },
      attempts: { type: Number },
    },
    status: {
      type: String,
      enum: ["ok", "error"],
      default: "ok",
    },
    errorCode: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

aiMessageSchema.index({ conversationId: 1, createdAt: 1 });
aiMessageSchema.index({ userId: 1, sessionId: 1 });

export const AiMessageModel = mongoose.model("ai_messages", aiMessageSchema);
export default AiMessageModel;
