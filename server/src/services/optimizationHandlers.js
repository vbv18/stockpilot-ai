import { holdingCostDaily } from "../contracts/pipeline.js";
import { PyOptimizeRequest, PyOptimizeResponse } from "../contracts/python.js";
import { AppError } from "../lib/errors.js";
import { AnalysisSessionModel } from "../models/analysisSession.model.js";
import { AssumptionSetModel } from "../models/assumptionSet.model.js";
import { ForecastRunModel } from "../models/forecastRun.model.js";
import { OptimizationRunModel } from "../models/optimizationRun.model.js";
import { registerJobHandler } from "./jobRunner.js";
import { setStage, transition } from "./sessionService.js";
import { statsPost } from "./statsClient.js";
import { scheduleReindex } from "./vector/scheduleReindex.js";

registerJobHandler("optimization", {
  async run(ctx) {
    const { assumptionSetId, forecastRunId } = ctx.input;

    const assumptionSet = await AssumptionSetModel.findOne({
      _id: assumptionSetId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
    });
    if (!assumptionSet) {
      throw new AppError("NOT_FOUND", "Assumption set not found");
    }

    const forecastRun = await ForecastRunModel.findOne({
      _id: forecastRunId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      status: "succeeded",
    });
    if (!forecastRun) {
      throw new AppError("NOT_FOUND", "Active forecast run not found");
    }

    const optRun = await OptimizationRunModel.create({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      assumptionSetId,
      forecastRunId,
      jobId: ctx.jobId,
      status: "running",
    });

    const forecastSkus = forecastRun.result?.forecast?.skus || [];
    const eligibleSkus = forecastSkus.filter(
      (s) => s.status === "ok" && s.interval_status === "ok",
    );

    const modelParams = forecastRun.modelConfig?.params || {};
    const nBootstrap = modelParams.n_bootstrap ?? 500;
    const blockSize = modelParams.block_size ?? 7;
    const bootstrapSeed = forecastRun.seed;

    const optimizeSkus = eligibleSkus.map((s) => ({
      sku_id: s.sku_id,
      forecast_mean: s.autoets_mean,
      residual_blocks: s.residual_blocks,
      residual_std: s.residual_std,
    }));

    const pyRequest = {
      skus: optimizeSkus,
      params: {
        ordering_cost: assumptionSet.orderingCost,
        holding_cost_daily: holdingCostDaily(assumptionSet),
        shortage_penalty: assumptionSet.shortagePenalty,
        lead_time_days: assumptionSet.leadTimeDays,
        target_service_level: assumptionSet.targetServiceLevel,
        n_bootstrap: nBootstrap,
        block_size: blockSize,
        bootstrap_seed: bootstrapSeed,
      },
    };
    PyOptimizeRequest.parse(pyRequest);

    await ctx.setProgress(20, "Computing reorder points");
    const optimizeResponse = await statsPost(
      "/optimize",
      pyRequest,
      PyOptimizeRequest,
      PyOptimizeResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
      },
    );

    const okSkus = optimizeResponse.skus.filter((s) => s.status === "ok");
    if (okSkus.length === 0) {
      throw new AppError("NO_ELIGIBLE_SKUS", "No SKU has positive forecast demand for this lead time.");
    }

    optRun.status = "succeeded";
    optRun.result = optimizeResponse;
    optRun.policyConfig = {
      nBootstrap,
      blockSize,
      bootstrapSeed,
      orderQuantityRule: "EOQ_both_policies",
    };
    await optRun.save();

    await AnalysisSessionModel.updateOne(
      { _id: ctx.sessionId, userId: ctx.userId },
      { $set: { activeOptimizationRunId: optRun._id } },
    );

    await transition(ctx.userId, ctx.sessionId, "optimization_ready");
    await setStage(ctx.userId, ctx.sessionId, "optimization", {
      status: "succeeded",
      finishedAt: new Date(),
    });

    scheduleReindex(ctx.userId, ctx.sessionId, "optimization");

    return { resultRef: { collection: "optimization_runs", id: optRun._id.toString() } };
  },

  async onFailed(ctx, failure) {
    await OptimizationRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      {
        $set: {
          status: "failed",
          "error.code": failure.code,
          "error.message": failure.userMessage,
        },
      },
    );
    await transition(ctx.userId, ctx.sessionId, "optimization_failed").catch(() => {});
    await setStage(ctx.userId, ctx.sessionId, "optimization", {
      status: "failed",
      errorCode: failure.code,
      userMessage: failure.userMessage,
      retryable: failure.retryable,
    });
  },

  async onCancelled(ctx) {
    await OptimizationRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      { $set: { status: "cancelled" } },
    );
    await transition(ctx.userId, ctx.sessionId, "assumptions_pending").catch(() => {});
    await setStage(ctx.userId, ctx.sessionId, "optimization", {
      status: "cancelled",
    });
  },
});
