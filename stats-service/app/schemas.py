from __future__ import annotations

from datetime import date
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


NonNeg = Annotated[float, Field(ge=0, allow_inf_nan=False)]
Fin = Annotated[float, Field(allow_inf_nan=False)]
SkuIdT = Annotated[str, Field(min_length=1, max_length=64)]
SeedT = Annotated[int, Field(ge=0, le=2147483647)]

SkuStatus = Literal["ok", "insufficient_history", "no_demand", "model_failed"]
IntervalStatus = Literal["ok", "insufficient_residuals", "not_computed"]


class SkuSeries(Strict):
    sku_id: SkuIdT
    start_date: date
    values: list[NonNeg] = Field(min_length=1, max_length=5000)


class ForecastParams(Strict):
    horizon: int = Field(28, ge=7, le=56)
    season_length: int = Field(7, ge=2, le=14)
    n_bootstrap: int = Field(500, ge=100, le=2000)
    block_size: int = Field(7, ge=1, le=14)
    min_history: int = Field(56, ge=28, le=365)
    origin_step: int = Field(7, ge=1, le=28)
    min_residual_blocks: int = Field(8, ge=2, le=100)
    seed: SeedT


class ForecastRequest(Strict):
    series: list[SkuSeries] = Field(min_length=1, max_length=100)
    params: ForecastParams


class RunMeta(Strict):
    service_version: str
    python_version: str
    numpy_version: str
    statsforecast_version: str
    seed: SeedT
    started_at: str
    finished_at: str
    duration_ms: int


class IntervalBand(Strict):
    p10: list[NonNeg]
    p50: list[NonNeg]
    p90: list[NonNeg]


class SkuForecast(Strict):
    sku_id: SkuIdT
    status: SkuStatus
    interval_status: IntervalStatus
    message: Optional[str] = None
    n_observations: int
    forecast_start_date: Optional[date] = None
    autoets_mean: Optional[list[NonNeg]] = None
    seasonal_naive_mean: Optional[list[NonNeg]] = None
    intervals: Optional[IntervalBand] = None
    residual_blocks: Optional[list[list[Fin]]] = None
    residual_block_cutoffs: Optional[list[int]] = None
    residual_std: Optional[NonNeg] = None
    n_residual_blocks: int
    n_failed_origins: int
    autoets_model_spec: Optional[str] = None
    warnings: list[str] = Field(default_factory=list)


class ForecastResponse(Strict):
    run_meta: RunMeta
    params: ForecastParams
    skus: list[SkuForecast]


# ---------- evaluate ----------
class EvaluateRequest(ForecastRequest):
    pass


class PointMetrics(Strict):
    mae: NonNeg
    rmse: NonNeg
    wape: Optional[NonNeg] = None
    wape_status: Literal["ok", "zero_denominator"]
    sum_abs_error: NonNeg
    sum_actual: NonNeg


class IntervalMetrics(Strict):
    nominal_coverage: float
    coverage: NonNeg
    mean_width: NonNeg


class SkuEvaluation(Strict):
    sku_id: SkuIdT
    status: SkuStatus
    interval_status: IntervalStatus
    message: Optional[str] = None
    n_observations: int
    n_train: int
    holdout_start_date: Optional[date] = None
    actual: Optional[list[NonNeg]] = None
    autoets_mean: Optional[list[NonNeg]] = None
    seasonal_naive_mean: Optional[list[NonNeg]] = None
    intervals: Optional[IntervalBand] = None
    autoets: Optional[PointMetrics] = None
    seasonal_naive: Optional[PointMetrics] = None
    interval_metrics: Optional[IntervalMetrics] = None
    n_residual_blocks: int
    warnings: list[str] = Field(default_factory=list)


class ModelAggregate(Strict):
    n_skus: int
    mae_mean: Optional[Fin] = None
    rmse_mean: Optional[Fin] = None
    wape_pooled: Optional[Fin] = None


class EvaluateAggregate(Strict):
    autoets: ModelAggregate
    seasonal_naive: ModelAggregate
    n_skus_with_intervals: int
    coverage_mean: Optional[Fin] = None
    mean_width_mean: Optional[Fin] = None


class EvaluateResponse(Strict):
    run_meta: RunMeta
    params: ForecastParams
    skus: list[SkuEvaluation]
    aggregate: EvaluateAggregate


# ---------- optimize ----------
class OptimizeSkuInput(Strict):
    sku_id: SkuIdT
    forecast_mean: list[NonNeg] = Field(min_length=1, max_length=56)
    residual_blocks: list[list[Fin]] = Field(min_length=1, max_length=500)
    residual_std: NonNeg


class OptimizeParams(Strict):
    ordering_cost: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    holding_cost_daily: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    shortage_penalty: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    lead_time_days: int = Field(ge=1, le=28)
    target_service_level: float = Field(gt=0, lt=1)
    n_bootstrap: int = Field(500, ge=100, le=2000)
    block_size: int = Field(7, ge=1, le=14)
    bootstrap_seed: SeedT


class OptimizeRequest(Strict):
    skus: list[OptimizeSkuInput] = Field(min_length=1, max_length=100)
    params: OptimizeParams


class LeadTimeDemandStats(Strict):
    mean: Fin
    std: NonNeg
    p10: Fin
    p50: Fin
    p90: Fin
    skewness: Fin


class SkuOptimization(Strict):
    sku_id: SkuIdT
    status: Literal["ok", "ineligible"]
    ineligible_reason: Optional[Literal["no_forecast_demand", "forecast_shorter_than_lead_time"]] = None
    avg_daily_forecast: Optional[Fin] = None
    annual_demand: Optional[Fin] = None
    holding_cost_annual: Optional[Fin] = None
    eoq_raw: Optional[Fin] = None
    eoq: Optional[int] = None
    mu_l: Optional[Fin] = None
    sigma_daily_error: Optional[Fin] = None
    sigma_l: Optional[Fin] = None
    z_score: Optional[Fin] = None
    safety_stock_deterministic: Optional[Fin] = None
    rop_deterministic_raw: Optional[Fin] = None
    rop_deterministic: Optional[int] = None
    ltd: Optional[LeadTimeDemandStats] = None
    rop_uncertainty_aware_raw: Optional[Fin] = None
    rop_uncertainty_aware: Optional[int] = None
    safety_stock_uncertainty_aware: Optional[Fin] = None
    rop_gap: Optional[int] = None
    warnings: list[str] = Field(default_factory=list)


class OptimizeResponse(Strict):
    run_meta: RunMeta
    params: OptimizeParams
    skus: list[SkuOptimization]


# ---------- simulate ----------
class SimulateSkuInput(Strict):
    sku_id: SkuIdT
    forecast_mean: list[NonNeg] = Field(min_length=1, max_length=56)
    residual_blocks: list[list[Fin]] = Field(min_length=1, max_length=500)
    eoq: int = Field(ge=1)
    rop_deterministic: int = Field(ge=0)
    rop_uncertainty_aware: int = Field(ge=0)


class SimulateParams(Strict):
    ordering_cost: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    holding_cost_daily: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    shortage_penalty: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    lead_time_days: int = Field(ge=1, le=28)
    n_scenarios: int = Field(500, ge=100, le=2000)
    horizon_days: int = Field(90, ge=30, le=180)
    block_size: int = Field(7, ge=1, le=14)
    seed: SeedT


class SimulateRequest(Strict):
    skus: list[SimulateSkuInput] = Field(min_length=1, max_length=100)
    params: SimulateParams


class PolicyMetrics(Strict):
    total_cost_mean: Fin
    total_cost_std: NonNeg
    total_cost_p05: Fin
    total_cost_p95: Fin
    ordering_cost_mean: Fin
    holding_cost_mean: Fin
    shortage_cost_mean: Fin
    avg_inventory_mean: Fin
    stockout_units_mean: Fin
    stockout_rate_mean: Fin
    service_level_mean: Fin
    service_level_p05: Fin
    order_count_mean: Fin


class PairedComparison(Strict):
    mean_total_cost_diff: Fin  # uncertainty_aware minus deterministic
    share_scenarios_uncertainty_aware_cheaper: Fin
    share_scenarios_equal: Fin


class SkuSimulation(Strict):
    sku_id: SkuIdT
    start_inventory: int
    mean_total_demand: NonNeg
    deterministic: PolicyMetrics
    uncertainty_aware: PolicyMetrics
    paired: PairedComparison


class AggregatePolicyMetrics(Strict):
    total_cost: Fin
    ordering_cost: Fin
    holding_cost: Fin
    shortage_cost: Fin
    avg_inventory: Fin
    stockout_units: Fin
    stockout_rate_mean: Fin
    service_level: Fin
    order_count: Fin


class SimulateAggregate(Strict):
    deterministic: AggregatePolicyMetrics
    uncertainty_aware: AggregatePolicyMetrics
    mean_total_cost_diff_sum: Fin


class SimulateResponse(Strict):
    run_meta: RunMeta
    params: SimulateParams
    skus: list[SkuSimulation]
    aggregate: SimulateAggregate
