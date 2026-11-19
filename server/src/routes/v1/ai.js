import { Router } from "express";
import { z } from "zod";
import { ACTION_ALLOWED_FROM } from "../../services/stateMachine.js";
import { getEnv } from "../../config/env.js";
import {
  ConversationCreateBody,
  ConversationIdParam,
  MessageCreateBody,
} from "../../contracts/ai.js";
import { ObjectIdString, PaginationQuery } from "../../contracts/common.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { AiConversationModel } from "../../models/aiConversation.model.js";
import { AiMessageModel } from "../../models/aiMessage.model.js";
import { AnalysisSessionModel } from "../../models/analysisSession.model.js";
import { runAgent } from "../../services/ai/agent.js";
import { reindexSession } from "../../services/vector/indexer.js";

const router = Router();

// Per-conversation lock to prevent concurrent messages
const processingConversations = new Set();

// Helper to check session ownership and eligibility
async function getEligibleSession(userId, sessionId) {
  const session = await AnalysisSessionModel.findOne({ _id: sessionId, userId });
  if (!session) {
    throw new AppError("NOT_FOUND", "Session not found");
  }
  if (!ACTION_ALLOWED_FROM.aiEligible.includes(session.status)) {
    throw new AppError("AI_SESSION_NOT_ELIGIBLE", "This session is not ready for AI analysis.");
  }
  return session;
}

/**
 * GET /ai/sessions
 * List eligible non-archived sessions for AI
 */
router.get("/sessions", async (req, res, next) => {
  try {
    const userId = req.user.firebaseUid;
    const sessions = await AnalysisSessionModel.find({
      userId,
      archived: { $ne: true },
      status: { $in: ACTION_ALLOWED_FROM.aiEligible },
    }).sort({ updatedAt: -1 });

    const data = sessions.map((s) => ({
      id: s._id.toString(),
      name: s.name,
      status: s.status,
      updatedAt: s.updatedAt?.toISOString() || new Date().toISOString(),
      aiIndexStatus: s.aiIndex?.status || "not_indexed",
      hasForecast: Boolean(s.activeForecastRunId),
      hasOptimization: Boolean(s.activeOptimizationRunId),
      hasSimulation: Boolean(s.activeSimulationRunId),
      isComplete: s.status === "completed",
    }));

    return res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /ai/sessions/:sessionId/reindex
 * Manually trigger reindex for a session
 */
router.post("/sessions/:sessionId/reindex", async (req, res, next) => {
  try {
    const userId = req.user.firebaseUid;
    const { sessionId } = req.params;

    const session = await getEligibleSession(userId, sessionId);

    // Run reindex awaited with max 60s timeout
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new AppError("UPSTREAM_VECTOR_ERROR", "Indexing timed out")), 60_000),
    );

    await Promise.race([reindexSession(userId, session._id.toString(), "manual"), timeout]);

    const updated = await AnalysisSessionModel.findById(sessionId);
    return res.status(200).json({
      data: {
        status: updated?.aiIndex?.status || "unknown",
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /ai/conversations
 * Create a new AI conversation
 */
router.post("/conversations", async (req, res, next) => {
  try {
    const userId = req.user.firebaseUid;
    const body = ConversationCreateBody.parse(req.body);

    const session = await getEligibleSession(userId, body.sessionId);

    const title = body.title || `Conversation ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`;

    const conv = await AiConversationModel.create({
      userId,
      sessionId: session._id.toString(),
      title,
      messageCount: 0,
      lastMessageAt: null,
    });

    return res.status(201).json({
      data: {
        id: conv._id.toString(),
        sessionId: conv.sessionId,
        sessionName: session.name,
        title: conv.title,
        messageCount: conv.messageCount,
        lastMessageAt: conv.lastMessageAt?.toISOString() || null,
        createdAt: conv.createdAt?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /ai/conversations
 * List user's conversations
 */
router.get("/conversations", async (req, res, next) => {
  try {
    const userId = req.user.firebaseUid;
    const querySchema = PaginationQuery.extend({
      sessionId: ObjectIdString.optional(),
    });
    const parsed = querySchema.parse(req.query);

    const filter = { userId, archived: { $ne: true } };
    if (parsed.sessionId) {
      filter.sessionId = parsed.sessionId;
    }

    const conversations = await AiConversationModel.find(filter)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip((parsed.page - 1) * parsed.limit)
      .limit(parsed.limit);

    // Populate session names
    const sessionIds = [...new Set(conversations.map((c) => c.sessionId))];
    const sessions = await AnalysisSessionModel.find({ _id: { $in: sessionIds } });
    const nameMap = new Map(sessions.map((s) => [s._id.toString(), s.name]));

    const data = conversations.map((c) => ({
      id: c._id.toString(),
      sessionId: c.sessionId,
      sessionName: nameMap.get(c.sessionId) || "Unknown Session",
      title: c.title,
      messageCount: c.messageCount,
      lastMessageAt: c.lastMessageAt?.toISOString() || null,
      createdAt: c.createdAt?.toISOString() || new Date().toISOString(),
    }));

    return res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /ai/conversations/:conversationId
 * Get single conversation
 */
router.get("/conversations/:conversationId", async (req, res, next) => {
  try {
    const userId = req.user.firebaseUid;
    const { conversationId } = ConversationIdParam.parse(req.params);

    const conv = await AiConversationModel.findOne({ _id: conversationId, userId });
    if (!conv) {
      throw new AppError("NOT_FOUND", "Conversation not found");
    }

    const session = await AnalysisSessionModel.findById(conv.sessionId);

    return res.status(200).json({
      data: {
        id: conv._id.toString(),
        sessionId: conv.sessionId,
        sessionName: session?.name || "Unknown Session",
        title: conv.title,
        messageCount: conv.messageCount,
        lastMessageAt: conv.lastMessageAt?.toISOString() || null,
        createdAt: conv.createdAt?.toISOString() || new Date().toISOString(),
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /ai/conversations/:conversationId/messages
 * List messages in a conversation
 */
router.get("/conversations/:conversationId/messages", async (req, res, next) => {
  try {
    const userId = req.user.firebaseUid;
    const { conversationId } = ConversationIdParam.parse(req.params);
    const { page, limit } = PaginationQuery.parse({
      ...req.query,
      limit: req.query.limit || 50,
    });

    const conv = await AiConversationModel.findOne({ _id: conversationId, userId });
    if (!conv) {
      throw new AppError("NOT_FOUND", "Conversation not found");
    }

    const messages = await AiMessageModel.find({ conversationId })
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const data = messages.map((m) => ({
      id: m._id.toString(),
      conversationId: m.conversationId,
      role: m.role,
      content: m.content,
      structured: m.structured || null,
      status: m.status,
      errorCode: m.errorCode || null,
      createdAt: m.createdAt?.toISOString() || new Date().toISOString(),
    }));

    return res.status(200).json({ data });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /ai/conversations/:conversationId/messages
 * Send user message and run agent
 */
router.post("/conversations/:conversationId/messages", async (req, res, next) => {
  const { conversationId } = ConversationIdParam.parse(req.params);
  const userId = req.user.firebaseUid;
  const requestId = res.locals.requestId || "unknown";

  try {
    const env = getEnv();
    if (!env.LLM_PROVIDER || !env.LLM_API_KEY) {
      throw new AppError("SERVICE_UNAVAILABLE", "AI analysis is not configured.");
    }

    // 1. Load conversation by _id and userId
    const conv = await AiConversationModel.findOne({ _id: conversationId, userId });
    if (!conv) {
      throw new AppError("NOT_FOUND", "Conversation not found");
    }

    // 2. Require session still eligible
    const session = await getEligibleSession(userId, conv.sessionId);

    // 3. In-memory per-conversation lock
    if (processingConversations.has(conversationId)) {
      throw new AppError("CONFLICT", "A message is already being processed.");
    }
    processingConversations.add(conversationId);

    const body = MessageCreateBody.parse(req.body);

    // 4. Load history (last 6 messages)
    const priorMessages = await AiMessageModel.find({ conversationId })
      .sort({ createdAt: -1 })
      .limit(6);
    const history = priorMessages.reverse().map((m) => ({
      role: m.role,
      content: m.structured?.summary || m.content,
    }));

    // 5. Persist user message
    const userMsgDoc = await AiMessageModel.create({
      userId,
      sessionId: session._id.toString(),
      conversationId,
      role: "user",
      content: body.content,
      status: "ok",
    });

    // 6. Run agent
    let agentResult;
    try {
      const controller = new AbortController();
      req.on("close", () => controller.abort());

      agentResult = await runAgent({
        userId,
        sessionId: session._id.toString(),
        conversationId,
        requestId,
        signal: controller.signal,
        question: body.content,
        history,
      });

      // 7. Persist assistant message on success
      const assistantMsgDoc = await AiMessageModel.create({
        userId,
        sessionId: session._id.toString(),
        conversationId,
        role: "assistant",
        content: agentResult.response.message,
        structured: agentResult.response,
        evidenceRefs: agentResult.evidenceRefs,
        toolTrace: agentResult.toolTrace,
        modelMeta: agentResult.modelMeta,
        status: "ok",
      });

      // Update conversation
      await AiConversationModel.updateOne(
        { _id: conversationId },
        {
          $set: { lastMessageAt: new Date() },
          $inc: { messageCount: 2 },
        },
      );

      logger.info(
        {
          requestId,
          conversationId,
          sessionId: session._id.toString(),
          toolsUsed: agentResult.toolTrace.map((t) => t.tool),
          latencyMs: agentResult.modelMeta.latencyMs,
          attempts: agentResult.modelMeta.attempts,
        },
        "AI response generated",
      );

      return res.status(200).json({
        data: {
          userMessage: {
            id: userMsgDoc._id.toString(),
            conversationId,
            role: "user",
            content: userMsgDoc.content,
            structured: null,
            status: "ok",
            errorCode: null,
            createdAt: userMsgDoc.createdAt.toISOString(),
          },
          assistantMessage: {
            id: assistantMsgDoc._id.toString(),
            conversationId,
            role: "assistant",
            content: assistantMsgDoc.content,
            structured: assistantMsgDoc.structured,
            status: "ok",
            errorCode: null,
            createdAt: assistantMsgDoc.createdAt.toISOString(),
          },
        },
      });
    } catch (err) {
      // 8. On error persist assistant message with error status
      await AiMessageModel.create({
        userId,
        sessionId: session._id.toString(),
        conversationId,
        role: "assistant",
        content: "",
        status: "error",
        errorCode: err.code || "INTERNAL_ERROR",
      });
      throw err;
    }
  } catch (err) {
    next(err);
  } finally {
    processingConversations.delete(conversationId);
  }
});

export default router;
