import { Router } from "express";
import { z } from "zod";
import { getUser } from "../../auth/currentUser.js";
import { PaginationQuery } from "../../contracts/common.js";
import { IdParam, SessionCreateBody, SessionPatchBody } from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { getStorage } from "../../lib/storage.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { AiConversationModel } from "../../models/aiConversation.model.js";
import { AiMessageModel } from "../../models/aiMessage.model.js";
import { AnalysisSessionModel } from "../../models/analysisSession.model.js";
import { AssumptionSetModel } from "../../models/assumptionSet.model.js";
import { DatasetModel } from "../../models/dataset.model.js";
import { ForecastRunModel } from "../../models/forecastRun.model.js";
import { JobModel } from "../../models/job.model.js";
import { OptimizationRunModel } from "../../models/optimizationRun.model.js";
import { SimulationRunModel } from "../../models/simulationRun.model.js";
import { WhatIfRunModel } from "../../models/whatIfRun.model.js";
import { createSession, getSessionOwned, listSessions, toSessionDto } from "../../services/sessionService.js";
import { getEmbedder } from "../../services/vector/embeddings.js";
import { deleteSession as deleteQdrantSession } from "../../services/vector/qdrantStore.js";

const router = Router();

// POST /sessions
router.post(
  "/",
  validate({ body: SessionCreateBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { body } = getValidated(res);
      const session = await createSession(user.userId, body.name);
      return res.status(201).json({ data: toSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions
const ListQuery = PaginationQuery.extend({
  archived: z.enum(["true", "false"]).default("false"),
});

router.get(
  "/",
  validate({ query: ListQuery }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { query } = getValidated(res);
      const archived = query.archived === "true";
      const { items, total } = await listSessions(user.userId, {
        page: query.page,
        limit: query.limit,
        archived,
      });
      return res.status(200).json({
        data: items.map(toSessionDto),
        meta: { page: query.page, limit: query.limit, total },
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions/:sessionId
router.get(
  "/:sessionId",
  validate({ params: IdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);
      return res.status(200).json({ data: toSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /sessions/:sessionId
router.patch(
  "/:sessionId",
  validate({ params: IdParam, body: SessionPatchBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      if (body.name !== undefined) {
        session.name = body.name.trim();
      }
      if (body.archived !== undefined) {
        session.archivedAt = body.archived ? new Date() : null;
      }
      await session.save();

      return res.status(200).json({ data: toSessionDto(session) });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /sessions/:sessionId
router.delete(
  "/:sessionId",
  validate({ params: IdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const requestId = res.locals.requestId || req.headers["x-request-id"] || "unknown";
      const { userId } = user;
      const { sessionId } = params;

      // 1. Owner check (404 on miss)
      await getSessionOwned(userId, sessionId);

      // 2. Running job check
      const activeJob = await JobModel.findOne({
        sessionId,
        status: { $in: ["queued", "running"] },
      });
      if (activeJob) {
        throw new AppError("CONFLICT", "Cancel running jobs before deleting this session.");
      }

      // 3. Delete Qdrant points if embedder configured
      if (getEmbedder()) {
        try {
          await deleteQdrantSession(userId, sessionId);
        } catch (qErr) {
          logger.error({ err: qErr.message, sessionId }, "Failed to delete Qdrant points on session deletion");
          throw new AppError(
            "UPSTREAM_VECTOR_ERROR",
            "Could not remove AI context; nothing was deleted. Please retry.",
          );
        }
      }

      // 4. Delete storage prefix datasets/<userId>/<sessionId>
      try {
        const storage = getStorage();
        await storage.deletePrefix(`datasets/${userId}/${sessionId}`);
      } catch (sErr) {
        logger.warn({ err: sErr.message, sessionId }, "Error deleting storage prefix");
      }

      // 5. Delete Mongo documents filtered by { userId, sessionId }
      const filter = { userId, sessionId };
      await AiMessageModel.deleteMany(filter);
      await AiConversationModel.deleteMany(filter);
      await WhatIfRunModel.deleteMany(filter);
      await JobModel.deleteMany(filter);
      await SimulationRunModel.deleteMany(filter);
      await OptimizationRunModel.deleteMany(filter);
      await AssumptionSetModel.deleteMany(filter);
      await ForecastRunModel.deleteMany(filter);
      await DatasetModel.deleteMany(filter);
      await AnalysisSessionModel.deleteOne({ _id: sessionId, userId });

      // 6. Audit log line
      logger.info({ event: "session_deleted", userId, sessionId, requestId }, "session deleted");

      return res.status(200).json({ data: { deleted: true } });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
