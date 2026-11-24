import { AppError } from "../../../lib/errors.js";
import {
  GetModelComparisonInput,
  GetModelComparisonOutput,
} from "../../../contracts/ai.js";

/**
 * Format point metrics
 */
function formatMetrics(m) {
  if (!m) return null;
  return {
    mae: m.mae ?? null,
    rmse: m.rmse ?? null,
    wape: m.wape ?? null,
    mase: m.mase ?? null,
    coverage: m.coverage ?? null,
    pinballLoss: m.pinball_loss ?? null,
  };
}

/**
 * Format baseline improvement
 */
function formatBaselineImprovement(bi) {
  if (!bi) return null;
  return {
    maePct: bi.mae_pct ?? null,
    rmsePct: bi.rmse_pct ?? null,
    wapePct: bi.wape_pct ?? null,
    coverageMinusNominal: bi.coverage_minus_nominal ?? null,
  };
}

/**
 * Format single SKU evaluation comparison
 */
function formatSkuEval(skuId, data) {
  if (!data) return null;
  return {
    skuId,
    status: data.status || "ok",
    chosenModel: data.chosen_model || null,
    maseImprovement: data.mase_improvement ?? null,
    autoets: formatMetrics(data.autoets),
    seasonalNaive: formatMetrics(data.seasonal_naive),
    crostonSba: formatMetrics(data.croston_sba),
    naive: formatMetrics(data.naive),
    globalLgbm: formatMetrics(data.global_lgbm),
    baselineImprovement: formatBaselineImprovement(data.baseline_improvement),
    coverageMinusNominal:
      data.coverage_minus_nominal ??
      data.baseline_improvement?.coverage_minus_nominal ??
      null,
    intervalCoverage:
      data.interval_metrics?.coverage ??
      data.interval_metrics?.coverage_p10_p90 ??
      null,
    intervalMeanWidth: data.interval_metrics?.mean_width ?? null,
  };
}

/**
 * get_model_comparison tool
 */
export async function getModelComparison(rawArgs, bundle) {
  const normalizedArgs = {
    ...rawArgs,
    skuId: rawArgs?.skuId || rawArgs?.sku || undefined,
  };
  const args = GetModelComparisonInput.parse(normalizedArgs);
  const { forecastRun } = bundle;

  if (!forecastRun || !forecastRun.result?.evaluation) {
    const output = GetModelComparisonOutput.parse({
      status: "not_evaluated",
      forecastRunId: forecastRun?._id?.toString() || null,
      message: "Rolling backtest evaluation not found for this forecast run.",
    });
    return {
      output,
      evidence: {
        artifactType: "evaluation",
        artifactId: forecastRun
          ? forecastRun._id.toString()
          : bundle.session._id.toString(),
        skuId: args.skuId || null,
        label: "Model comparison (not evaluated)",
      },
    };
  }

  const evaluation = forecastRun.result.evaluation;
  const rawSkus = evaluation.skus || {};
  const evalMap = Array.isArray(rawSkus)
    ? Object.fromEntries(rawSkus.map((s) => [s.sku_id, s]))
    : rawSkus;

  if (args.skuId) {
    const skuData = evalMap[args.skuId];
    if (!skuData) {
      throw new AppError(
        "NOT_FOUND",
        `SKU ${args.skuId} not found in model evaluation`,
      );
    }

    const sku = formatSkuEval(args.skuId, skuData);
    const output = GetModelComparisonOutput.parse({
      status: "evaluated",
      forecastRunId: forecastRun._id.toString(),
      sku,
    });

    return {
      output,
      evidence: {
        artifactType: "evaluation",
        artifactId: forecastRun._id.toString(),
        skuId: args.skuId,
        label: `Model comparison for SKU ${args.skuId}`,
      },
    };
  }

  const agg = evaluation.aggregate || {};
  const skus = Object.entries(evalMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sId, d]) => formatSkuEval(sId, d));

  const chosenModelCounts = {};
  for (const s of skus) {
    if (s.chosenModel) {
      chosenModelCounts[s.chosenModel] =
        (chosenModelCounts[s.chosenModel] || 0) + 1;
    }
  }

  const mapAggregateModel = (m) => {
    if (!m) return null;
    return {
      maeMean: m.mae_mean ?? null,
      rmseMean: m.rmse_mean ?? null,
      wapePooled: m.wape_pooled ?? null,
      maseMean: m.mase_mean ?? null,
      coverageMean: m.coverage_mean ?? null,
      pinballLossMean: m.pinball_loss_mean ?? null,
    };
  };

  const aggregate = {
    autoets: mapAggregateModel(agg.autoets),
    seasonalNaive: mapAggregateModel(agg.seasonal_naive),
    crostonSba: mapAggregateModel(agg.croston_sba),
    naive: mapAggregateModel(agg.naive),
    globalLgbm: mapAggregateModel(agg.global_lgbm),
    baselineImprovement: formatBaselineImprovement(
      agg.baseline_improvement || evaluation.baseline_improvement,
    ),
    coverageMinusNominal:
      agg.coverage_minus_nominal ?? evaluation.coverage_minus_nominal ?? null,
    coverageMean: agg.coverage_mean ?? null,
    meanWidthMean: agg.mean_width_mean ?? null,
  };

  const output = GetModelComparisonOutput.parse({
    status: "evaluated",
    forecastRunId: forecastRun._id.toString(),
    aggregate,
    chosenModelCounts,
    skus,
  });

  return {
    output,
    evidence: {
      artifactType: "evaluation",
      artifactId: forecastRun._id.toString(),
      skuId: null,
      label: "Rolling backtest model comparison",
    },
  };
}
