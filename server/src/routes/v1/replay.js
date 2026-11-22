import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getUser } from "../../auth/currentUser.js";
import { IdParam, ReplayBody } from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { ReplayRunModel } from "../../models/replayRun.model.js";
import { enqueueJob } from "../../services/jobRunner.js";
import { getSessionOwned } from "../../services/sessionService.js";

const router = Router({ mergeParams: true });

const ReplayIdParam = IdParam.extend({
  replayId: z.string().regex(/^[a-fA-F0-9]{24}$/),
}).strict();

function toReplayDto(r) {
  return {
    id: r._id.toString(),
    status: r.status,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    holdoutDays: r.holdoutDays,
    seed: r.seed,
    results: r.results || null,
    aggregate: r.results?.aggregate || null,
    skus: r.results?.skus || null,
    error: r.error?.code ? r.error : null,
  };
}

// POST /sessions/:sessionId/replay (or /sessions/:sessionId/simulations/replay)
router.post(
  "/",
  validate({ params: IdParam, body: ReplayBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      if (!session.activeDatasetId) {
        throw new AppError(
          "INVALID_STATE",
          "Active dataset is required before running replay.",
        );
      }

      if (!session.activeAssumptionSetId) {
        throw new AppError(
          "INVALID_STATE",
          "Active assumption set is required before running replay.",
        );
      }

      const seed = body.seed ?? crypto.randomInt(0, 2147483647);
      const holdoutDays = body.holdoutDays ?? 28;
      const datasetId = session.activeDatasetId.toString();
      const assumptionSetId = session.activeAssumptionSetId.toString();

      const requestId = res.locals.requestId || "req";
      const { job, deduplicated } = await enqueueJob({
        userId: user.userId,
        sessionId: params.sessionId,
        stage: "replay",
        hashInput: { datasetId, assumptionSetId, holdoutDays },
        input: { datasetId, assumptionSetId, holdoutDays, seed },
        requestId,
      });

      const statusCode = deduplicated ? 200 : 202;
      return res.status(statusCode).json({
        data: { jobId: job._id.toString() },
        ...(deduplicated ? { meta: { deduplicated: true } } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions/:sessionId/replay
router.get("/", validate({ params: IdParam }), async (req, res, next) => {
  try {
    const user = getUser(res);
    const { params } = getValidated(res);
    await getSessionOwned(user.userId, params.sessionId);

    const runs = await ReplayRunModel.find({
      sessionId: params.sessionId,
      userId: user.userId,
    })
      .sort({ createdAt: -1 })
      .limit(20);

    const items = runs.map(toReplayDto);

    return res.status(200).json({
      data: {
        latest: items[0] || null,
        runs: items,
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /sessions/:sessionId/replay/:replayId
router.get(
  "/:replayId",
  validate({ params: ReplayIdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      await getSessionOwned(user.userId, params.sessionId);

      const run = await ReplayRunModel.findOne({
        _id: params.replayId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!run) {
        throw new AppError("NOT_FOUND", "Replay run not found");
      }

      return res.status(200).json({ data: toReplayDto(run) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
