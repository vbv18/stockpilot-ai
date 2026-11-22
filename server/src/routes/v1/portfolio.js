import { Router } from "express";
import { getUser } from "../../auth/currentUser.js";
import { IdParam, PortfolioRunBody } from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { PortfolioRunModel } from "../../models/portfolioRun.model.js";
import { SimulationRunModel } from "../../models/simulationRun.model.js";
import { enqueueJob } from "../../services/jobRunner.js";
import { getSessionOwned, setStage } from "../../services/sessionService.js";

const router = Router({ mergeParams: true });

function toPortfolioDto(r) {
  return {
    id: r._id.toString(),
    status: r.status,
    createdAt: r.createdAt ? r.createdAt.toISOString() : null,
    budget: r.budget,
    capacity: r.capacity,
    result: r.result || null,
    error: r.error?.code ? r.error : null,
  };
}

// POST /sessions/:sessionId/portfolio
router.post(
  "/",
  validate({ params: IdParam, body: PortfolioRunBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      if (!session.activeSimulationRunId) {
        throw new AppError(
          "INVALID_STATE",
          "Active simulation run with sweep data is required before running portfolio optimization.",
        );
      }

      const simRun = await SimulationRunModel.findOne({
        _id: session.activeSimulationRunId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!simRun || simRun.status !== "succeeded" || !simRun.sweep) {
        throw new AppError(
          "INVALID_STATE",
          "Simulation run with sweep data must be succeeded before running portfolio optimization.",
        );
      }

      const budget =
        body.budget !== undefined ? body.budget : session.budget;
      const capacity =
        body.capacity !== undefined ? body.capacity : session.capacity;

      if (
        (budget === undefined || budget === null) &&
        (capacity === undefined || capacity === null)
      ) {
        throw new AppError(
          "UNPROCESSABLE_ENTITY",
          "At least one of budget (max total inventory investment) or capacity (max total units) must be set to run portfolio optimization.",
        );
      }

      // Update session with new budget/capacity if provided
      if (body.budget !== undefined) session.budget = body.budget;
      if (body.capacity !== undefined) session.capacity = body.capacity;
      await session.save();

      const simulationRunId = simRun._id.toString();
      const optimizationRunId = simRun.optimizationRunId.toString();
      const assumptionSetId = session.activeAssumptionSetId.toString();

      await setStage(user.userId, params.sessionId, "portfolio", {
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
        stage: "portfolio",
        hashInput: { simulationRunId, budget, capacity },
        input: {
          simulationRunId,
          optimizationRunId,
          assumptionSetId,
          budget,
          capacity,
        },
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

// GET /sessions/:sessionId/portfolio
router.get("/", validate({ params: IdParam }), async (req, res, next) => {
  try {
    const user = getUser(res);
    const { params } = getValidated(res);
    const session = await getSessionOwned(user.userId, params.sessionId);

    if (!session.activePortfolioRunId) {
      return res.status(200).json({ data: null });
    }

    const run = await PortfolioRunModel.findOne({
      _id: session.activePortfolioRunId,
      userId: user.userId,
      sessionId: params.sessionId,
    });
    if (!run) {
      return res.status(200).json({ data: null });
    }

    return res.status(200).json({
      data: toPortfolioDto(run),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
