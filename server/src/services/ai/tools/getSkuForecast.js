import { AppError } from "../../../lib/errors.js";
import {
  GetSkuForecastInput,
  GetSkuForecastOutput,
} from "../../../contracts/ai.js";

/**
 * get_sku_forecast tool
 */
export async function getSkuForecast(rawArgs, bundle) {
  const args = GetSkuForecastInput.parse(rawArgs);
  const { forecastRun, history } = bundle;

  if (!forecastRun || !forecastRun.result?.skus) {
    throw new AppError("NOT_FOUND", "Forecast run not found for this session");
  }

  const skuData = forecastRun.result.skus[args.skuId];
  if (!skuData) {
    throw new AppError(
      "NOT_FOUND",
      `SKU ${args.skuId} is not part of this session`,
    );
  }

  const evalData = forecastRun.result.evaluation?.skus?.[args.skuId] || null;

  // History tail calculation
  let historyTail = null;
  let last28Avg = null;
  let prior28Avg = null;
  let zeroDaysLast56 = null;

  if (history && Array.isArray(history)) {
    const skuHistoryObj = history.find((h) => h.skuId === args.skuId);
    if (
      skuHistoryObj &&
      skuHistoryObj.series &&
      skuHistoryObj.series.length > 0
    ) {
      const series = skuHistoryObj.series;
      if (args.includeHistoryDays > 0) {
        const slice = series.slice(-args.includeHistoryDays);
        if (slice.length > 0) {
          historyTail = {
            startDate: slice[0].date,
            values: slice.map((pt) => pt.quantity),
          };
        }
      }
      if (series.length >= 28) {
        const l28 = series.slice(-28).map((pt) => pt.quantity);
        last28Avg = l28.reduce((a, b) => a + b, 0) / 28;
      }
      if (series.length >= 56) {
        const p28 = series.slice(-56, -28).map((pt) => pt.quantity);
        prior28Avg = p28.reduce((a, b) => a + b, 0) / 28;
        const last56 = series.slice(-56).map((pt) => pt.quantity);
        zeroDaysLast56 = last56.filter((q) => q === 0).length;
      }
    }
  }

  // Summary and forecast curves
  let forecastObj = null;
  let summary = null;

  if (skuData.status === "ok") {
    const autoetsMean = skuData.autoets_mean || [];
    const seasonalNaiveMean = skuData.seasonal_naive_mean || [];
    const p10 = skuData.p10 || [];
    const p50 = skuData.p50 || [];
    const p90 = skuData.p90 || [];

    forecastObj = {
      startDate:
        forecastRun.result.forecast_start_date ||
        new Date().toISOString().slice(0, 10),
      autoetsMean,
      seasonalNaiveMean,
      p10,
      p50,
      p90,
    };

    const avgDailyForecast =
      autoetsMean.length > 0
        ? autoetsMean.reduce((a, b) => a + b, 0) / autoetsMean.length
        : 0;
    const totalForecast28 = autoetsMean.reduce((a, b) => a + b, 0);
    const avgP10 =
      p10.length > 0 ? p10.reduce((a, b) => a + b, 0) / p10.length : null;
    const avgP90 =
      p90.length > 0 ? p90.reduce((a, b) => a + b, 0) / p90.length : null;

    summary = {
      avgDailyForecast,
      totalForecast28,
      avgP10,
      avgP90,
      last28Avg,
      prior28Avg,
      zeroDaysLast56,
    };
  }

  const evaluation = evalData
    ? {
        autoets: evalData.autoets || null,
        seasonalNaive: evalData.seasonal_naive || null,
        intervalMetrics: evalData.interval_metrics || null,
      }
    : null;

  const output = GetSkuForecastOutput.parse({
    skuId: args.skuId,
    status: skuData.status,
    intervalStatus: skuData.interval_status,
    message: skuData.message || null,
    nObservations: skuData.n_observations ?? 0,
    historyTail,
    forecast: forecastObj,
    summary,
    evaluation,
    residualStd: skuData.residual_std ?? null,
    nResidualBlocks: skuData.residual_blocks
      ? skuData.residual_blocks.length
      : 0,
    warnings: skuData.warnings || [],
  });

  return {
    output,
    evidence: {
      artifactType: "forecast_run",
      artifactId: forecastRun._id.toString(),
      skuId: args.skuId,
      label: `Forecast for SKU ${args.skuId}`,
    },
  };
}
