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
    intervalCoverage: data.interval_metrics?.coverage ?? null,
    intervalMeanWidth: data.interval_metrics?.mean_width ?? null,
  };
}

/**
 * get_model_comparison tool
 */
export async function getModelComparison(rawArgs, bundle) {
  const args = GetModelComparisonInput.parse(rawArgs);
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
        artifactId: forecastRun ? forecastRun._id.toString() : bundle.session._id.toString(),
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

  const aggregate = {
    autoets: agg.autoets
      ? {
          maeMean: agg.autoets.mae_mean ?? null,
          rmseMean: agg.autoets.rmse_mean ?? null,
          wapePooled: agg.autoets.wape_pooled ?? null,
          maseMean: agg.autoets.mase_mean ?? null,
        }
      : null,
    seasonalNaive: agg.seasonal_naive
      ? {
          maeMean: agg.seasonal_naive.mae_mean ?? null,
          rmseMean: agg.seasonal_naive.rmse_mean ?? null,
          wapePooled: agg.seasonal_naive.wape_pooled ?? null,
          maseMean: agg.seasonal_naive.mase_mean ?? null,
        }
      : null,
    crostonSba: agg.croston_sba
      ? {
          maeMean: agg.croston_sba.mae_mean ?? null,
          rmseMean: agg.croston_sba.rmse_mean ?? null,
          wapePooled: agg.croston_sba.wape_pooled ?? null,
          maseMean: agg.croston_sba.mase_mean ?? null,
        }
      : null,
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
