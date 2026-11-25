import { Router } from "express";
import { z } from "zod";
import { getUser } from "../../auth/currentUser.js";
import { IdParam } from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { AssumptionSetModel } from "../../models/assumptionSet.model.js";
import { ForecastRunModel } from "../../models/forecastRun.model.js";
import { OptimizationRunModel } from "../../models/optimizationRun.model.js";
import { SimulationRunModel } from "../../models/simulationRun.model.js";
import { enqueueJob } from "../../services/jobRunner.js";
import {
  getSessionOwned,
  requireStatus,
  setStage,
  transition,
} from "../../services/sessionService.js";
import { ACTION_ALLOWED_FROM } from "../../services/stateMachine.js";
import { toAssumptionSetDto } from "./assumptions.js";

const router = Router({ mergeParams: true });

// POST /sessions/:sessionId/optimize
router.post(
  "/",
  validate({ params: IdParam, body: z.object({}).strict() }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      requireStatus(session, ACTION_ALLOWED_FROM.optimize);

      if (!session.activeAssumptionSetId) {
        throw new AppError(
          "INVALID_STATE",
          "Active assumption set is required before optimization.",
        );
      }
      if (!session.activeForecastRunId) {
        throw new AppError(
          "INVALID_STATE",
          "Active forecast run is required before optimization.",
        );
      }

      const assumptionSetId = session.activeAssumptionSetId.toString();
      const forecastRunId = session.activeForecastRunId.toString();

      await transition(user.userId, params.sessionId, "optimizing");
      await setStage(user.userId, params.sessionId, "optimization", {
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
        stage: "optimization",
        hashInput: { assumptionSetId, forecastRunId },
        input: { assumptionSetId, forecastRunId },
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

// GET /sessions/:sessionId/optimization
router.get("/", validate({ params: IdParam }), async (req, res, next) => {
  try {
    const user = getUser(res);
    const { params } = getValidated(res);
    const session = await getSessionOwned(user.userId, params.sessionId);

    if (!session.activeOptimizationRunId) {
      return res.status(200).json({ data: null });
    }

    const run = await OptimizationRunModel.findOne({
      _id: session.activeOptimizationRunId,
      userId: user.userId,
      sessionId: params.sessionId,
    });
    if (!run) {
      return res.status(200).json({ data: null });
    }

    const assumptionDoc = await AssumptionSetModel.findById(
      run.assumptionSetId,
    );
    if (!assumptionDoc) {
      throw new AppError("NOT_FOUND", "Assumption set for run not found");
    }

    const stale =
      session.activeAssumptionSetId?.toString() !==
      run.assumptionSetId.toString();

    return res.status(200).json({
      data: {
        run: {
          id: run._id.toString(),
          status: run.status,
          assumptionSetId: run.assumptionSetId.toString(),
          forecastRunId: run.forecastRunId.toString(),
          policyConfig: run.policyConfig,
          createdAt: run.createdAt ? run.createdAt.toISOString() : null,
          error: run.error?.code ? run.error : null,
        },
        assumptions: toAssumptionSetDto(assumptionDoc),
        result: run.result,
        stale,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;
