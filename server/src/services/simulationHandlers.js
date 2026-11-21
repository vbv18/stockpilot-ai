import { holdingCostDaily } from "../contracts/pipeline.js";
import { PySimulateRequest, PySimulateResponse } from "../contracts/python.js";
import { AppError } from "../lib/errors.js";
import { AnalysisSessionModel } from "../models/analysisSession.model.js";
import { AssumptionSetModel } from "../models/assumptionSet.model.js";
import { ForecastRunModel } from "../models/forecastRun.model.js";
import { OptimizationRunModel } from "../models/optimizationRun.model.js";
import { SimulationRunModel } from "../models/simulationRun.model.js";
import { registerJobHandler } from "./jobRunner.js";
import { setStage, transition } from "./sessionService.js";
import { statsPost } from "./statsClient.js";
import { scheduleReindex } from "./vector/scheduleReindex.js";

registerJobHandler("simulation", {
  async run(ctx) {
    const { optimizationRunId, nScenarios, horizonDays, seed } = ctx.input;

    const optRun = await OptimizationRunModel.findOne({
      _id: optimizationRunId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      status: "succeeded",
    });
    if (!optRun) {
      throw new AppError("NOT_FOUND", "Optimization run not found");
    }

    const assumptionSet = await AssumptionSetModel.findById(
      optRun.assumptionSetId,
    );
    if (!assumptionSet) {
      throw new AppError("NOT_FOUND", "Assumption set not found");
    }

    const forecastRun = await ForecastRunModel.findById(optRun.forecastRunId);
    if (!forecastRun || !forecastRun.result?.forecast?.skus) {
      throw new AppError("NOT_FOUND", "Forecast run not found");
    }

    const simRun = await SimulationRunModel.create({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      optimizationRunId,
      scenarioCount: nScenarios,
      horizonDays,
      seed,
      policyDefinitions: {
        deterministic: "ROP_d = mu_L + z*sigma_L, order quantity EOQ",
        uncertainty_aware:
          "ROP_u = empirical alpha-quantile of simulated lead-time demand, order quantity EOQ",
        reviewPeriod: "daily",
        lostSales: true,
      },
      jobId: ctx.jobId,
      status: "running",
    });

    const forecastMap = new Map();
    for (const s of forecastRun.result.forecast.skus) {
      forecastMap.set(s.sku_id, s);
    }

    const simulateSkus = [];
    for (const optSku of optRun.result?.skus || []) {
      if (optSku.status !== "ok") continue;
      const fcSku = forecastMap.get(optSku.sku_id);
      if (!fcSku) continue;

      simulateSkus.push({
        sku_id: optSku.sku_id,
        forecast_mean: fcSku.autoets_mean,
        residual_blocks: fcSku.residual_blocks,
        eoq: optSku.eoq,
        rop_deterministic: optSku.rop_deterministic,
        rop_uncertainty_aware: optSku.rop_uncertainty_aware,
      });
    }

    const blockSize = optRun.policyConfig?.blockSize ?? 7;

    const pyRequest = {
      skus: simulateSkus,
      params: {
        ordering_cost: assumptionSet.orderingCost,
        holding_cost_daily: holdingCostDaily(assumptionSet),
        shortage_penalty: assumptionSet.shortagePenalty,
        lead_time_days: assumptionSet.leadTimeDays,
        n_scenarios: nScenarios,
        horizon_days: horizonDays,
        block_size: blockSize,
        seed,
      },
    };
    PySimulateRequest.parse(pyRequest);

    await ctx.setProgress(15, "Running Monte Carlo scenarios");
    const simulateResponse = await statsPost(
      "/simulate",
      pyRequest,
      PySimulateRequest,
      PySimulateResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
      },
    );

    simRun.policyResults = simulateResponse;
    simRun.status = "succeeded";
    await simRun.save();

    await AnalysisSessionModel.updateOne(
      { _id: ctx.sessionId, userId: ctx.userId },
      { $set: { activeSimulationRunId: simRun._id } },
    );

    await transition(ctx.userId, ctx.sessionId, "completed");
    await setStage(ctx.userId, ctx.sessionId, "simulation", {
      status: "succeeded",
      finishedAt: new Date(),
    });

    scheduleReindex(ctx.userId, ctx.sessionId, "simulation");

    return {
      resultRef: { collection: "simulation_runs", id: simRun._id.toString() },
    };
  },

  async onFailed(ctx, failure) {
    await SimulationRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      {
        $set: {
          status: "failed",
          "error.code": failure.code,
          "error.message": failure.userMessage,
        },
      },
    );
    await transition(ctx.userId, ctx.sessionId, "simulation_failed").catch(
      () => {},
    );
    await setStage(ctx.userId, ctx.sessionId, "simulation", {
      status: "failed",
      errorCode: failure.code,
      userMessage: failure.userMessage,
      retryable: failure.retryable,
    });
  },

  async onCancelled(ctx) {
    await SimulationRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      { $set: { status: "cancelled" } },
    );
    await transition(ctx.userId, ctx.sessionId, "optimization_ready").catch(
      () => {},
    );
    await setStage(ctx.userId, ctx.sessionId, "simulation", {
      status: "cancelled",
    });
  },
});
