import {
  PyPortfolioRequest,
  PyPortfolioResponse,
} from "../contracts/python.js";
import { AppError } from "../lib/errors.js";
import { AnalysisSessionModel } from "../models/analysisSession.model.js";
import { AssumptionSetModel } from "../models/assumptionSet.model.js";
import { OptimizationRunModel } from "../models/optimizationRun.model.js";
import { PortfolioRunModel } from "../models/portfolioRun.model.js";
import { SimulationRunModel } from "../models/simulationRun.model.js";
import { registerJobHandler } from "./jobRunner.js";
import { setStage } from "./sessionService.js";
import { statsPost } from "./statsClient.js";
import { scheduleReindex } from "./vector/scheduleReindex.js";

registerJobHandler("portfolio", {
  async run(ctx) {
    const {
      simulationRunId,
      optimizationRunId,
      assumptionSetId,
      budget,
      capacity,
    } = ctx.input;

    const simRun = await SimulationRunModel.findOne({
      _id: simulationRunId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      status: "succeeded",
    }).lean();
    if (!simRun || !simRun.sweep) {
      throw new AppError("NOT_FOUND", "Simulation sweep data not found");
    }

    const optRun = await OptimizationRunModel.findOne({
      _id: optimizationRunId,
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      status: "succeeded",
    }).lean();
    if (!optRun) {
      throw new AppError("NOT_FOUND", "Optimization run not found");
    }

    const assumptionSet = await AssumptionSetModel.findById(
      assumptionSetId,
    ).lean();
    if (!assumptionSet) {
      throw new AppError("NOT_FOUND", "Assumption set not found");
    }

    const portRun = await PortfolioRunModel.create({
      userId: ctx.userId,
      sessionId: ctx.sessionId,
      simulationRunId,
      optimizationRunId,
      assumptionSetId,
      budget: budget ?? null,
      capacity: capacity ?? null,
      jobId: ctx.jobId,
      status: "running",
    });

    const skusMap =
      assumptionSet.skus instanceof Map
        ? Object.fromEntries(assumptionSet.skus)
        : assumptionSet.skus || {};

    const optMap = new Map();
    for (const s of optRun.result?.skus || []) {
      optMap.set(s.sku_id, s);
    }

    const portfolioSkus = [];
    const sweepMap = simRun.sweep || {};

    for (const [skuId, sweepObj] of Object.entries(sweepMap)) {
      const skuAssumptions = skusMap[skuId];
      if (!skuAssumptions) continue;
      const optSku = optMap.get(skuId);
      const unitCost = Number(skuAssumptions.unit_cost);
      const annualDemand = Number(
        optSku?.annual_demand ?? (optSku?.avg_daily_forecast ?? 0) * 365,
      );

      // Prefer uncertainty_aware curve, fallback to deterministic
      const points = sweepObj.uncertainty_aware || sweepObj.deterministic || [];
      if (!Array.isArray(points) || points.length === 0) continue;

      const curve = points.map((p) => {
        let avgInv = p.avg_inventory;
        if (avgInv === undefined || avgInv === null) {
          const ropVal =
            p.rop ??
            optSku?.rop_uncertainty_aware ??
            optSku?.rop_deterministic ??
            0;
          const eoqVal = optSku?.eoq ?? 1;
          const leadDemand =
            optSku?.mu_l ??
            skuAssumptions.lead_time_mean * (optSku?.avg_daily_forecast ?? 1);
          avgInv = Math.max(0, ropVal - leadDemand + eoqVal / 2);
        }
        return {
          service_level: Number(p.service_level),
          rop: Number(
            p.rop ??
              optSku?.rop_uncertainty_aware ??
              optSku?.rop_deterministic ??
              0,
          ),
          total_cost: Number(p.total_cost),
          avg_inventory: Number(avgInv),
          fill_rate:
            p.fill_rate !== undefined && p.fill_rate !== null
              ? Number(p.fill_rate)
              : null,
        };
      });

      portfolioSkus.push({
        sku_id: skuId,
        unit_cost: unitCost,
        annual_demand: annualDemand,
        curve,
      });
    }

    if (portfolioSkus.length === 0) {
      throw new AppError(
        "UNPROCESSABLE_ENTITY",
        "No eligible SKU sweep curves found for portfolio optimization",
      );
    }

    const pyRequest = {
      skus: portfolioSkus,
      budget: budget !== undefined && budget !== null ? Number(budget) : null,
      capacity:
        capacity !== undefined && capacity !== null ? Number(capacity) : null,
    };

    PyPortfolioRequest.parse(pyRequest);

    await ctx.setProgress(30, "Solving portfolio allocation across SKUs");

    const response = await statsPost(
      "/portfolio",
      pyRequest,
      PyPortfolioRequest,
      PyPortfolioResponse,
      {
        requestId: ctx.requestId,
        signal: ctx.signal,
      },
    );

    portRun.result = response;
    portRun.status = "succeeded";
    await portRun.save();

    const session = await AnalysisSessionModel.findById(ctx.sessionId);
    if (session) {
      session.activePortfolioRunId = portRun._id;
      await session.save();
    }

    await setStage(ctx.userId, ctx.sessionId, "portfolio", {
      status: "succeeded",
      finishedAt: new Date(),
      lastJobId: ctx.jobId,
    });

    scheduleReindex(ctx.userId, ctx.sessionId, "portfolio");

    await ctx.setProgress(100, "Portfolio optimization complete");
    return { portfolioRunId: portRun._id.toString() };
  },

  async onFailed(ctx, err) {
    await PortfolioRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      {
        $set: {
          status: "failed",
          error: {
            code: err?.code || "INTERNAL_ERROR",
            message: err?.message || "Portfolio optimization failed",
          },
        },
      },
    );
    await setStage(ctx.userId, ctx.sessionId, "portfolio", {
      status: "failed",
      errorCode: err?.code || "INTERNAL_ERROR",
      userMessage: err?.message || "Portfolio optimization failed",
      lastJobId: ctx.jobId,
    });
  },

  async onCancelled(ctx) {
    await PortfolioRunModel.updateOne(
      { jobId: ctx.jobId, userId: ctx.userId },
      { $set: { status: "cancelled" } },
    );
    await setStage(ctx.userId, ctx.sessionId, "portfolio", {
      status: "cancelled",
      lastJobId: ctx.jobId,
    });
  },
});
