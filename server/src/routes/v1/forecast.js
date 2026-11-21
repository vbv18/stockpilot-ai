import crypto from "node:crypto";
import { Router } from "express";
import { getUser } from "../../auth/currentUser.js";
import { ForecastBody, IdParam } from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { DatasetModel } from "../../models/dataset.model.js";
import { ForecastRunModel } from "../../models/forecastRun.model.js";
import {
  getActiveForecastRun,
  stripForClient,
} from "../../services/forecastAccess.js";
import { enqueueJob } from "../../services/jobRunner.js";
import { loadProcessedSeries } from "../../services/processedSeries.js";
import {
  getSessionOwned,
  requireStatus,
  setStage,
  transition,
} from "../../services/sessionService.js";
import { ACTION_ALLOWED_FROM } from "../../services/stateMachine.js";

const router = Router({ mergeParams: true });

// POST /sessions/:sessionId/forecast
router.post(
  "/",
  validate({ params: IdParam, body: ForecastBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      requireStatus(session, ACTION_ALLOWED_FROM.forecast);

      if (!session.activeDatasetId) {
        throw new AppError("NOT_FOUND", "No active dataset found for session");
      }

      const dataset = await DatasetModel.findOne({
        _id: session.activeDatasetId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!dataset || dataset.status !== "ready") {
        throw new AppError(
          "INVALID_STATE",
          "Active dataset must be in 'ready' status to start forecasting.",
        );
      }

      const seed = body.seed ?? crypto.randomInt(0, 2147483647);
      const datasetId = dataset._id.toString();

      await transition(user.userId, params.sessionId, "forecasting");
      await setStage(user.userId, params.sessionId, "forecast", {
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        errorCode: null,
        userMessage: null,
      });

      const requestId = res.locals.requestId || "req";
      const { job, deduplicated } = await enqueueJob({
        userId: user.userId,
        sessionId: params.sessionId,
        stage: "forecast",
        hashInput: { datasetId },
        input: { datasetId, seed },
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

// GET /sessions/:sessionId/forecast
router.get("/", validate({ params: IdParam }), async (req, res, next) => {
  try {
    const user = getUser(res);
    const { params } = getValidated(res);
    const session = await getSessionOwned(user.userId, params.sessionId);

    if (!session.activeForecastRunId) {
      throw new AppError(
        "NOT_FOUND",
        "No active forecast run found for session",
      );
    }

    const run = await ForecastRunModel.findOne({
      _id: session.activeForecastRunId,
      userId: user.userId,
      sessionId: params.sessionId,
    });
    if (!run) {
      throw new AppError("NOT_FOUND", "Forecast run not found");
    }

    let history = [];
    if (session.activeDatasetId) {
      history = await loadProcessedSeries(
        user.userId,
        session.activeDatasetId.toString(),
      ).catch(() => []);
    }

    const fullForecast = run.result?.forecast || null;
    const strippedForecast = stripForClient(fullForecast);
    const evaluation = run.result?.evaluation || null;

    const eligibleSkuIds = (fullForecast?.skus || [])
      .filter((s) => s.status === "ok" && s.interval_status === "ok")
      .map((s) => s.sku_id);

    return res.status(200).json({
      data: {
        run: {
          id: run._id.toString(),
          status: run.status,
          createdAt: run.createdAt ? run.createdAt.toISOString() : null,
          updatedAt: run.updatedAt ? run.updatedAt.toISOString() : null,
          seed: run.seed,
          modelConfig: run.modelConfig,
          evaluationConfig: run.evaluationConfig,
          runMeta: run.runMeta,
          error: run.error?.code ? run.error : null,
        },
        history,
        forecast: strippedForecast,
        evaluation,
        eligibleSkuIds,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
