import { FORECAST_DEFAULTS } from "../config/constants.js";
import { PyEvaluateResponse, PyForecastRequest, PyForecastResponse } from "../contracts/python.js";
import { AppError } from "../lib/errors.js";
import { AnalysisSessionModel } from "../models/analysisSession.model.js";
import { ForecastRunModel } from "../models/forecastRun.model.js";
import { registerJobHandler } from "./jobRunner.js";
import { loadProcessedSeries } from "./processedSeries.js";
import { setStage, transition } from "./sessionService.js";
import { statsPost } from "./statsClient.js";
import { scheduleReindex } from "./vector/scheduleReindex.js";

registerJobHandler("forecast", {
  async run(ctx) {
    const { datasetId, seed } = ctx.input;

    const forecastRun = await ForecastRunModel.create({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      datasetId,
      seed,
      modelConfig: {
        primary: "AutoETS",
        baseline: "SeasonalNaive",
        params: {
          horizon: FORECAST_DEFAULTS.horizon,
          season_length: FORECAST_DEFAULTS.seasonLength,
          n_bootstrap: FORECAST_DEFAULTS.nBootstrap,
          block_size: FORECAST_DEFAULTS.blockSize,
          min_history: FORECAST_DEFAULTS.minHistory,
          origin_step: FORECAST_DEFAULTS.originStep,
          min_residual_blocks: FORECAST_DEFAULTS.minResidualBlocks,
          seed,
        },
      },
      evaluationConfig: {
        holdoutDays: FORECAST_DEFAULTS.horizon,
      },
      jobId: ctx.jobId,
      status: "running",
    });

    await ctx.setProgress(5, "Preparing series");
    const rawSeries = await loadProcessedSeries(ctx.userId, datasetId);

    const seriesPayload = rawSeries.map((s) => ({
      sku_id: s.skuId,
      start_date: s.startDate,
      values: s.values,
    }));

    const pyRequest = {
      series: seriesPayload,
      params: forecastRun.modelConfig.params,
    };
    PyForecastRequest.parse(pyRequest);

    await ctx.setProgress(10, "Fitting models and bootstrapping intervals");
    const forecastResponse = await statsPost(
      "/forecast",
      pyRequest,
      PyForecastRequest,
      PyForecastResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
      },
    );

    ctx.throwIfCancelled();
    await ctx.setProgress(55, "Evaluating on the last 28 days");

    const evaluateResponse = await statsPost(
      "/evaluate",
      pyRequest,
      PyForecastRequest,
      PyEvaluateResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
      },
    );

    ctx.throwIfCancelled();
    await ctx.setProgress(90, "Saving results");

    const eligibleSkus = forecastResponse.skus.filter(
      (s) => s.status === "ok" && s.interval_status === "ok",
    );
    if (eligibleSkus.length === 0) {
      throw new AppError(
        "NO_ELIGIBLE_SKUS",
        "None of the series had enough history to compute prediction intervals. At least 112 days of daily history per SKU are required.",
      );
    }

    const result = {
      forecast: forecastResponse,
      evaluation: evaluateResponse,
    };
    const resultStr = JSON.stringify(result);
    if (Buffer.byteLength(resultStr, "utf-8") > 12 * 1024 * 1024) {
      throw new AppError("INTERNAL_ERROR", "Forecast result size exceeds 12 MB limit.");
    }

    forecastRun.status = "succeeded";
    forecastRun.result = result;
    forecastRun.metrics = evaluateResponse.aggregate;
    forecastRun.runMeta = {
      forecast: forecastResponse.run_meta,
      evaluation: evaluateResponse.run_meta,
    };
    await forecastRun.save();

    await AnalysisSessionModel.updateOne(
      { _id: ctx.sessionId, userId: ctx.userId },
      { $set: { activeForecastRunId: forecastRun._id } },
    );

    await transition(ctx.userId, ctx.sessionId, "forecast_ready");
    await setStage(ctx.userId, ctx.sessionId, "forecast", {
      status: "succeeded",
      finishedAt: new Date(),
    });

    scheduleReindex(ctx.userId, ctx.sessionId, "forecast");

    return { resultRef: { collection: "forecast_runs", id: forecastRun._id.toString() } };
  },

  async onFailed(ctx, failure) {
    await ForecastRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      {
        $set: {
          status: "failed",
          "error.code": failure.code,
          "error.message": failure.userMessage,
        },
      },
    );
    await transition(ctx.userId, ctx.sessionId, "forecast_failed").catch(() => {});
    await setStage(ctx.userId, ctx.sessionId, "forecast", {
      status: "failed",
      errorCode: failure.code,
      userMessage: failure.userMessage,
      retryable: failure.retryable,
    });
  },

  async onCancelled(ctx) {
    await ForecastRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      { $set: { status: "cancelled" } },
    );
    await transition(ctx.userId, ctx.sessionId, "dataset_ready").catch(() => {});
    await setStage(ctx.userId, ctx.sessionId, "forecast", {
      status: "cancelled",
    });
  },
});
