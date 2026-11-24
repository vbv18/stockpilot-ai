import { PyReplayRequest, PyReplayResponse } from "../contracts/python.js";
import { AppError } from "../lib/errors.js";
import { AnalysisSessionModel } from "../models/analysisSession.model.js";
import { AssumptionSetModel } from "../models/assumptionSet.model.js";
import { ReplayRunModel } from "../models/replayRun.model.js";
import { registerJobHandler } from "./jobRunner.js";
import { loadProcessedSeries } from "./processedSeries.js";
import { statsPost } from "./statsClient.js";
import { scheduleReindex } from "./vector/scheduleReindex.js";

registerJobHandler("replay", {
  async run(ctx) {
    const { datasetId, assumptionSetId, holdoutDays = 28, seed } = ctx.input;

    const assumptionSet = await AssumptionSetModel.findOne({
      _id: assumptionSetId,
      userId: ctx.userId,
    }).lean();
    if (!assumptionSet) {
      throw new AppError("NOT_FOUND", "Assumption set not found");
    }

    const replayRun = await ReplayRunModel.create({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      datasetId,
      assumptionSetId,
      seed,
      holdoutDays,
      jobId: ctx.jobId,
      status: "running",
    });

    await ctx.setProgress(10, "Loading historical demand data");
    const rawSeries = await loadProcessedSeries(ctx.userId, datasetId);

    const seriesPayload = rawSeries.map((s) => ({
      sku_id: s.skuId,
      start_date: s.startDate,
      values: s.values,
    }));

    const skusMap =
      assumptionSet.skus instanceof Map
        ? Object.fromEntries(assumptionSet.skus)
        : assumptionSet.skus || {};

    const pyRequest = {
      series: seriesPayload,
      params: {
        seed,
        holdout_days: holdoutDays,
        season_length: 7,
        n_bootstrap: 500,
        block_size: 7,
        min_history: 56,
        origin_step: 7,
        min_residual_blocks: 8,
      },
      assumptions: skusMap,
    };
    PyReplayRequest.parse(pyRequest);

    ctx.throwIfCancelled();
    await ctx.setProgress(
      35,
      "Fitting policies on earlier days and replaying on actual held-out demand",
    );

    const replayResponse = await statsPost(
      "/replay",
      pyRequest,
      PyReplayRequest,
      PyReplayResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
      },
    );

    ctx.throwIfCancelled();
    await ctx.setProgress(90, "Saving replay results");

    replayRun.results = replayResponse;
    replayRun.status = "succeeded";
    await replayRun.save();

    await AnalysisSessionModel.updateOne(
      { _id: ctx.sessionId, userId: ctx.userId },
      { $set: { activeReplayRunId: replayRun._id } },
    );

    scheduleReindex(ctx.userId, ctx.sessionId, "replay");

    return {
      resultRef: { collection: "replay_runs", id: replayRun._id.toString() },
    };
  },

  async onFailed(ctx, failure) {
    await ReplayRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      {
        $set: {
          status: "failed",
          "error.code": failure.code,
          "error.message": failure.userMessage,
        },
      },
    );
  },

  async onCancelled(ctx) {
    await ReplayRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      { $set: { status: "cancelled" } },
    );
  },
});
