import { z } from "zod";
import { IsoDate, Seed, SkuId } from "./common.js";

const fin = z.number().finite();
const nonNeg = z.number().finite().nonnegative();
const finArr = z.array(fin);
const nonNegArr = z.array(nonNeg);

export const PySkuStatus = z.enum(["ok", "insufficient_history", "no_demand", "model_failed"]);
export const PyIntervalStatus = z.enum(["ok", "insufficient_residuals", "not_computed"]);

export const PySkuSeries = z.object({ sku_id: SkuId, start_date: IsoDate, values: z.array(nonNeg).min(1).max(5000) }).strict();

export const PyForecastParams = z
  .object({
    horizon: z.number().int().min(7).max(56),
    season_length: z.number().int().min(2).max(14),
    n_bootstrap: z.number().int().min(100).max(2000),
    block_size: z.number().int().min(1).max(14),
    min_history: z.number().int().min(28).max(365),
    origin_step: z.number().int().min(1).max(28),
    min_residual_blocks: z.number().int().min(2).max(100),
    seed: Seed,
  })
  .strict();

export const PyForecastRequest = z.object({ series: z.array(PySkuSeries).min(1).max(100), params: PyForecastParams }).strict();
export const PyEvaluateRequest = PyForecastRequest;

export const PyRunMeta = z
  .object({
    service_version: z.string(),
    python_version: z.string(),
    numpy_version: z.string(),
    statsforecast_version: z.string(),
    seed: Seed,
    started_at: z.string(),
    finished_at: z.string(),
    duration_ms: z.number().int().nonnegative(),
  })
  .strict();

export const PyIntervalBand = z.object({ p10: nonNegArr, p50: nonNegArr, p90: nonNegArr }).strict();

export const PySkuForecast = z
  .object({
    sku_id: SkuId,
    status: PySkuStatus,
    interval_status: PyIntervalStatus,
    message: z.string().nullable(),
    n_observations: z.number().int().nonnegative(),
    forecast_start_date: IsoDate.nullable(),
    autoets_mean: nonNegArr.nullable(),
    seasonal_naive_mean: nonNegArr.nullable(),
    intervals: PyIntervalBand.nullable(),
    residual_blocks: z.array(finArr).nullable(),
    residual_block_cutoffs: z.array(z.number().int()).nullable(),
    residual_std: nonNeg.nullable(),
    n_residual_blocks: z.number().int().nonnegative(),
    n_failed_origins: z.number().int().nonnegative(),
    autoets_model_spec: z.string().nullable(),
    warnings: z.array(z.string()),
  })
  .strict();

export const PyForecastResponse = z.object({ run_meta: PyRunMeta, params: PyForecastParams, skus: z.array(PySkuForecast) }).strict();

export const PyPointMetrics = z
  .object({
    mae: nonNeg, rmse: nonNeg, wape: nonNeg.nullable(),
    wape_status: z.enum(["ok", "zero_denominator"]),
    sum_abs_error: nonNeg, sum_actual: nonNeg,
  })
  .strict();
export const PyIntervalMetrics = z.object({ nominal_coverage: fin, coverage: nonNeg, mean_width: nonNeg }).strict();

export const PySkuEvaluation = z
  .object({
    sku_id: SkuId,
    status: PySkuStatus,
    interval_status: PyIntervalStatus,
    message: z.string().nullable(),
    n_observations: z.number().int().nonnegative(),
    n_train: z.number().int().nonnegative(),
    holdout_start_date: IsoDate.nullable(),
    actual: nonNegArr.nullable(),
    autoets_mean: nonNegArr.nullable(),
    seasonal_naive_mean: nonNegArr.nullable(),
    intervals: PyIntervalBand.nullable(),
    autoets: PyPointMetrics.nullable(),
    seasonal_naive: PyPointMetrics.nullable(),
    interval_metrics: PyIntervalMetrics.nullable(),
    n_residual_blocks: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
  })
  .strict();

export const PyModelAggregate = z
  .object({ n_skus: z.number().int().nonnegative(), mae_mean: fin.nullable(), rmse_mean: fin.nullable(), wape_pooled: fin.nullable() })
  .strict();
export const PyEvaluateAggregate = z
  .object({
    autoets: PyModelAggregate,
    seasonal_naive: PyModelAggregate,
    n_skus_with_intervals: z.number().int().nonnegative(),
    coverage_mean: fin.nullable(),
    mean_width_mean: fin.nullable(),
  })
  .strict();
export const PyEvaluateResponse = z
  .object({ run_meta: PyRunMeta, params: PyForecastParams, skus: z.array(PySkuEvaluation), aggregate: PyEvaluateAggregate })
  .strict();

// ---------- optimize ----------
export const PyOptimizeSkuInput = z
  .object({
    sku_id: SkuId,
    forecast_mean: z.array(nonNeg).min(1).max(56),
    residual_blocks: z.array(finArr).min(1).max(500),
    residual_std: nonNeg,
  })
  .strict();

export const PyOptimizeParams = z
  .object({
    ordering_cost: z.number().finite().positive().max(1e9),
    holding_cost_daily: z.number().finite().positive().max(1e9),
    shortage_penalty: z.number().finite().positive().max(1e9),
    lead_time_days: z.number().int().min(1).max(28),
    target_service_level: z.number().finite().gt(0).lt(1),
    n_bootstrap: z.number().int().min(100).max(2000),
    block_size: z.number().int().min(1).max(14),
    bootstrap_seed: Seed,
  })
  .strict();

export const PyOptimizeRequest = z.object({ skus: z.array(PyOptimizeSkuInput).min(1).max(100), params: PyOptimizeParams }).strict();

export const PyLeadTimeDemandStats = z
  .object({ mean: fin, std: nonNeg, p10: fin, p50: fin, p90: fin, skewness: fin })
  .strict();

export const PySkuOptimization = z
  .object({
    sku_id: SkuId,
    status: z.enum(["ok", "ineligible"]),
    ineligible_reason: z.enum(["no_forecast_demand", "forecast_shorter_than_lead_time"]).nullable(),
    avg_daily_forecast: fin.nullable(),
    annual_demand: fin.nullable(),
    holding_cost_annual: fin.nullable(),
    eoq_raw: fin.nullable(),
    eoq: z.number().int().nullable(),
    mu_l: fin.nullable(),
    sigma_daily_error: fin.nullable(),
    sigma_l: fin.nullable(),
    z_score: fin.nullable(),
    safety_stock_deterministic: fin.nullable(),
    rop_deterministic_raw: fin.nullable(),
    rop_deterministic: z.number().int().nullable(),
    ltd: PyLeadTimeDemandStats.nullable(),
    rop_uncertainty_aware_raw: fin.nullable(),
    rop_uncertainty_aware: z.number().int().nullable(),
    safety_stock_uncertainty_aware: fin.nullable(),
    rop_gap: z.number().int().nullable(),
    warnings: z.array(z.string()),
  })
  .strict();

export const PyOptimizeResponse = z.object({ run_meta: PyRunMeta, params: PyOptimizeParams, skus: z.array(PySkuOptimization) }).strict();

// ---------- simulate ----------
export const PySimulateSkuInput = z
  .object({
    sku_id: SkuId,
    forecast_mean: z.array(nonNeg).min(1).max(56),
    residual_blocks: z.array(finArr).min(1).max(500),
    eoq: z.number().int().min(1),
    rop_deterministic: z.number().int().min(0),
    rop_uncertainty_aware: z.number().int().min(0),
  })
  .strict();

export const PySimulateParams = z
  .object({
    ordering_cost: z.number().finite().positive().max(1e9),
    holding_cost_daily: z.number().finite().positive().max(1e9),
    shortage_penalty: z.number().finite().positive().max(1e9),
    lead_time_days: z.number().int().min(1).max(28),
    n_scenarios: z.number().int().min(100).max(2000),
    horizon_days: z.number().int().min(30).max(180),
    block_size: z.number().int().min(1).max(14),
    seed: Seed,
  })
  .strict();

export const PySimulateRequest = z.object({ skus: z.array(PySimulateSkuInput).min(1).max(100), params: PySimulateParams }).strict();

export const PyPolicyMetrics = z
  .object({
    total_cost_mean: fin, total_cost_std: nonNeg, total_cost_p05: fin, total_cost_p95: fin,
    ordering_cost_mean: fin, holding_cost_mean: fin, shortage_cost_mean: fin,
    avg_inventory_mean: fin, stockout_units_mean: fin, stockout_rate_mean: fin,
    service_level_mean: fin, service_level_p05: fin, order_count_mean: fin,
  })
  .strict();

export const PyPairedComparison = z
  .object({
    mean_total_cost_diff: fin,
    share_scenarios_uncertainty_aware_cheaper: fin,
    share_scenarios_equal: fin,
  })
  .strict();

export const PySkuSimulation = z
  .object({
    sku_id: SkuId,
    start_inventory: z.number().int().nonnegative(),
    mean_total_demand: nonNeg,
    deterministic: PyPolicyMetrics,
    uncertainty_aware: PyPolicyMetrics,
    paired: PyPairedComparison,
  })
  .strict();

export const PyAggregatePolicyMetrics = z
  .object({
    total_cost: fin, ordering_cost: fin, holding_cost: fin, shortage_cost: fin,
    avg_inventory: fin, stockout_units: fin, stockout_rate_mean: fin, service_level: fin, order_count: fin,
  })
  .strict();

export const PySimulateAggregate = z
  .object({
    deterministic: PyAggregatePolicyMetrics,
    uncertainty_aware: PyAggregatePolicyMetrics,
    mean_total_cost_diff_sum: fin,
  })
  .strict();

export const PySimulateResponse = z
  .object({ run_meta: PyRunMeta, params: PySimulateParams, skus: z.array(PySkuSimulation), aggregate: PySimulateAggregate })
  .strict();
