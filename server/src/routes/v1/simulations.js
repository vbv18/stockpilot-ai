import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getUser } from "../../auth/currentUser.js";
import { IdParam, SimulationBody } from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { ForecastRunModel } from "../../models/forecastRun.model.js";
import { OptimizationRunModel } from "../../models/optimizationRun.model.js";
import { SimulationRunModel } from "../../models/simulationRun.model.js";
import { enqueueJob } from "../../services/jobRunner.js";
import { computeSkuRisk } from "../../services/risk.js";
import { getSessionOwned, requireStatus, setStage, transition } from "../../services/sessionService.js";
import { ACTION_ALLOWED_FROM } from "../../services/stateMachine.js";

const router = Router({ mergeParams: true });

const SimulationIdParam = IdParam.extend({
  simulationId: z.string().regex(/^[a-fA-F0-9]{24}$/),
}).strict();

const SIMULATION_NOTES = [
  "Simulation uses a lost-sales model with daily review; both policies share identical demand scenarios and the same starting inventory.",
  "Demand scenarios beyond day 28 repeat the 28-day forecast pattern; trend is not modelled.",
  "Results depend on the assumptions and scenario method and are not guaranteed future outcomes.",
];

// POST /sessions/:sessionId/simulations
router.post(
  "/",
  validate({ params: IdParam, body: SimulationBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      requireStatus(session, ACTION_ALLOWED_FROM.simulate);

      if (!session.activeOptimizationRunId) {
        throw new AppError("INVALID_STATE", "Active optimization run is required before simulation.");
      }

      const optRun = await OptimizationRunModel.findOne({
        _id: session.activeOptimizationRunId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!optRun || optRun.status !== "succeeded") {
        throw new AppError("INVALID_STATE", "Active optimization run must be succeeded.");
      }

      if (session.activeAssumptionSetId?.toString() !== optRun.assumptionSetId.toString()) {
        throw new AppError("INVALID_STATE", "Re-run optimization for the latest assumptions first.");
      }

      const optimizationRunId = optRun._id.toString();
      const nScenarios = body.nScenarios;
      const horizonDays = body.horizonDays;
      const seed = body.seed ?? crypto.randomInt(0, 2147483647);

      await transition(user.userId, params.sessionId, "simulating");
      await setStage(user.userId, params.sessionId, "simulation", {
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
        stage: "simulation",
        hashInput: { optimizationRunId, nScenarios, horizonDays },
        input: { optimizationRunId, nScenarios, horizonDays, seed },
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

// GET /sessions/:sessionId/simulations
router.get(
  "/",
  validate({ params: IdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      await getSessionOwned(user.userId, params.sessionId);

      const runs = await SimulationRunModel.find({
        sessionId: params.sessionId,
        userId: user.userId,
      })
        .sort({ createdAt: -1 })
        .limit(20);

      const items = runs.map((r) => ({
        id: r._id.toString(),
        status: r.status,
        createdAt: r.createdAt ? r.createdAt.toISOString() : null,
        scenarioCount: r.scenarioCount,
        horizonDays: r.horizonDays,
        seed: r.seed,
        optimizationRunId: r.optimizationRunId.toString(),
        aggregate: r.policyResults?.aggregate || null,
      }));

      return res.status(200).json({ data: items });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions/:sessionId/simulations/:simulationId
router.get(
  "/:simulationId",
  validate({ params: SimulationIdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      await getSessionOwned(user.userId, params.sessionId);

      const simRun = await SimulationRunModel.findOne({
        _id: params.simulationId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!simRun) {
        throw new AppError("NOT_FOUND", "Simulation run not found");
      }

      const optRun = await OptimizationRunModel.findById(simRun.optimizationRunId);
      const forecastRun = optRun ? await ForecastRunModel.findById(optRun.forecastRunId) : null;

      const evalBySku = new Map();
      if (forecastRun?.result?.evaluation?.skus) {
        for (const e of forecastRun.result.evaluation.skus) {
          evalBySku.set(e.sku_id, e);
        }
      }

      const simBySku = new Map();
      if (simRun.policyResults?.skus) {
        for (const s of simRun.policyResults.skus) {
          simBySku.set(s.sku_id, s);
        }
      }

      const risk = (optRun?.result?.skus || []).map((optSku) => {
        return computeSkuRisk({
          opt: optSku,
          evaluation: evalBySku.get(optSku.sku_id) || null,
          simulation: simBySku.get(optSku.sku_id) || null,
          targetServiceLevel: 0.95, // default or from assumption
        });
      });

      return res.status(200).json({
        data: {
          run: {
            id: simRun._id.toString(),
            status: simRun.status,
            optimizationRunId: simRun.optimizationRunId.toString(),
            scenarioCount: simRun.scenarioCount,
            horizonDays: simRun.horizonDays,
            seed: simRun.seed,
            policyDefinitions: simRun.policyDefinitions,
            createdAt: simRun.createdAt ? simRun.createdAt.toISOString() : null,
            error: simRun.error?.code ? simRun.error : null,
          },
          result: simRun.policyResults || null,
          risk,
          notes: SIMULATION_NOTES,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
