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
DemandClass = Literal["smooth", "erratic", "intermittent", "lumpy"]


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
    demand_class: DemandClass
    adi: Fin
    cv2: Fin
    chosen_model: Optional[str] = None
    mase_improvement: Optional[Fin] = None
    message: Optional[str] = None
    n_observations: int
    forecast_start_date: Optional[date] = None
    autoets_mean: Optional[list[NonNeg]] = None
    seasonal_naive_mean: Optional[list[NonNeg]] = None
    naive_mean: Optional[list[NonNeg]] = None
    global_lgbm_mean: Optional[list[NonNeg]] = None
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


class BaselineImprovement(Strict):
    mae_pct: Fin
    rmse_pct: Fin
    wape_pct: Fin
    coverage_minus_nominal: Optional[Fin] = None


class ModelComparisonRow(Strict):
    sku_id: SkuIdT
    model: str
    origin: int
    mae: NonNeg
    rmse: NonNeg
    wape: Optional[NonNeg] = None
    mase: Optional[Fin] = None
    pinball_loss: NonNeg
    coverage: NonNeg
    used_for_selection: Optional[bool] = None


class PointMetrics(Strict):
    mae: NonNeg
    rmse: NonNeg
    wape: Optional[NonNeg] = None
    wape_status: Literal["ok", "zero_denominator"]
    sum_abs_error: NonNeg
    sum_actual: NonNeg
    mase: Optional[Fin] = None
    coverage: Optional[NonNeg] = None
    pinball_loss: Optional[NonNeg] = None


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
    naive_mean: Optional[list[NonNeg]] = None
    global_lgbm_mean: Optional[list[NonNeg]] = None
    intervals: Optional[IntervalBand] = None
    autoets: Optional[PointMetrics] = None
    seasonal_naive: Optional[PointMetrics] = None
    croston_sba: Optional[PointMetrics] = None
    naive: Optional[PointMetrics] = None
    global_lgbm: Optional[PointMetrics] = None
    chosen_model: Optional[str] = None
    mase_improvement: Optional[Fin] = None
    models: Optional[dict[str, PointMetrics]] = None
    interval_metrics: Optional[IntervalMetrics] = None
    baseline_improvement: Optional[BaselineImprovement] = None
    coverage_minus_nominal: Optional[Fin] = None
    model_comparison: Optional[list[ModelComparisonRow]] = None
    n_residual_blocks: int
    warnings: list[str] = Field(default_factory=list)


class ModelAggregate(Strict):
    n_skus: int
    mae_mean: Optional[Fin] = None
    rmse_mean: Optional[Fin] = None
    wape_pooled: Optional[Fin] = None
    mase_mean: Optional[Fin] = None
    coverage_mean: Optional[Fin] = None


class EvaluateAggregate(Strict):
    autoets: ModelAggregate
    seasonal_naive: ModelAggregate
    croston_sba: Optional[ModelAggregate] = None
    naive: Optional[ModelAggregate] = None
    global_lgbm: Optional[ModelAggregate] = None
    baseline_improvement: Optional[BaselineImprovement] = None
    coverage_minus_nominal: Optional[Fin] = None
    model_comparison: Optional[list[ModelComparisonRow]] = None
    n_skus_with_intervals: int
    coverage_mean: Optional[Fin] = None
    mean_width_mean: Optional[Fin] = None


class EvaluateResponse(Strict):
    run_meta: RunMeta
    params: ForecastParams
    skus: list[SkuEvaluation]
    aggregate: EvaluateAggregate
    baseline_improvement: Optional[BaselineImprovement] = None
    model_comparison: Optional[list[ModelComparisonRow]] = None


# ---------- optimize ----------
class OptimizeSkuInput(Strict):
    sku_id: SkuIdT
    forecast_mean: list[NonNeg] = Field(min_length=1, max_length=56)
    residual_blocks: list[list[Fin]] = Field(min_length=1, max_length=500)
    residual_std: Optional[NonNeg] = None
    intervals: Optional[IntervalBand] = None


class SkuAssumptions(Strict):
    sku_id: Optional[SkuIdT] = None
    unit_cost: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    order_cost: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    holding_rate: float = Field(ge=0.0, le=1.0, allow_inf_nan=False)
    shortage_cost: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    lead_time_mean: int = Field(ge=1, le=28)
    lead_time_std: float = Field(default=0.0, ge=0, le=28, allow_inf_nan=False)
    target_service_level: float = Field(ge=0.80, le=0.99, allow_inf_nan=False)
    moq: int = Field(default=1, ge=1)
    pack_size: int = Field(default=1, ge=1)
    initial_stock: int = Field(default=0, ge=0)
    # Optional legacy alias fields for backwards compatibility
    ordering_cost: Optional[float] = Field(default=None, gt=0, le=1e9, allow_inf_nan=False)
    holding_cost_annual: Optional[float] = Field(default=None, ge=0.0, le=1e9, allow_inf_nan=False)
    shortage_penalty: Optional[float] = Field(default=None, gt=0, le=1e9, allow_inf_nan=False)
    service_level: Optional[float] = Field(default=None, ge=0.80, le=0.99, allow_inf_nan=False)

    @property
    def effective_ordering_cost(self) -> float:
        return self.order_cost if self.order_cost is not None else (self.ordering_cost or 0.0)

    @property
    def effective_holding_cost_annual(self) -> float:
        if self.holding_cost_annual is not None:
            return self.holding_cost_annual
        return self.holding_rate * self.unit_cost

    @property
    def effective_shortage_cost(self) -> float:
        return self.shortage_cost if self.shortage_cost is not None else (self.shortage_penalty or 0.0)

    @property
    def effective_service_level(self) -> float:
        return self.target_service_level if self.target_service_level is not None else (self.service_level or 0.95)


def annual_holding_cost(a: Any) -> float:
    """Helper to return annual holding cost per unit for an assumption object."""
    h_annual = getattr(a, "holding_cost_annual", None)
    if h_annual is not None:
        return float(h_annual)
    unit_cost = getattr(a, "unit_cost", 1.0)
    holding_rate = getattr(a, "holding_rate", 0.2)
    return float(holding_rate * unit_cost)


class OptimizeParams(Strict):
    n_bootstrap: int = Field(500, ge=100, le=2000)
    block_size: int = Field(7, ge=1, le=14)
    bootstrap_seed: SeedT


class DependencyPair(Strict):
    sku_i: str
    sku_j: str
    rho: float
    relation: Literal["complementary", "substitute-like"]


class DemandDependency(Strict):
    sku_order: list[str]
    correlation_matrix: list[list[float]]
    pairs: list[DependencyPair]
    pooling_ratio: float


class OptimizeRequest(Strict):
    skus: list[OptimizeSkuInput] = Field(min_length=1, max_length=100)
    params: OptimizeParams
    assumptions: dict[SkuIdT, SkuAssumptions]
    series: Optional[list[SkuSeries]] = None
    daily_matrix: Optional[dict[str, list[float]]] = None


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
    rop_quantile_raw: Optional[Fin] = None
    rop_quantile: Optional[int] = None
    safety_stock_quantile: Optional[Fin] = None
    s_det: Optional[int] = None
    s_quant: Optional[int] = None
    s_emp: Optional[int] = None
    warnings: list[str] = Field(default_factory=list)


class OptimizeResponse(Strict):
    run_meta: RunMeta
    params: OptimizeParams
    skus: list[SkuOptimization]
    dependency: Optional[DemandDependency] = None


# ---------- simulate ----------
class SweepPoint(Strict):
    service_level: Fin
    total_cost: Fin
    fill_rate: Fin
    avg_inventory: Optional[Fin] = None
    rop: Optional[int] = None


class SkuSweep(Strict):
    sku_id: SkuIdT
    deterministic: list[SweepPoint]
    uncertainty_aware: list[SweepPoint]
    quantile: Optional[list[SweepPoint]] = None


class SimulateSkuInput(Strict):
    sku_id: SkuIdT
    forecast_mean: list[NonNeg] = Field(min_length=1, max_length=56)
    residual_blocks: list[list[Fin]] = Field(min_length=1, max_length=500)
    residual_std: Optional[NonNeg] = None
    eoq: int = Field(ge=1)
    rop_deterministic: int = Field(ge=0)
    rop_uncertainty_aware: int = Field(ge=0)
    rop_quantile: Optional[int] = Field(default=None, ge=0)
    s_det: Optional[int] = Field(default=None, ge=0)
    s_quant: Optional[int] = Field(default=None, ge=0)
    s_emp: Optional[int] = Field(default=None, ge=0)


class SimulateParams(Strict):
    n_scenarios: int = Field(500, ge=100, le=2000)
    horizon_days: int = Field(90, ge=30, le=180)
    block_size: int = Field(7, ge=1, le=14)
    seed: SeedT


class SimulateRequest(Strict):
    skus: list[SimulateSkuInput] = Field(min_length=1, max_length=100)
    params: SimulateParams
    assumptions: dict[SkuIdT, SkuAssumptions]


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
    fill_rate: Optional[Fin] = None
    csl: Optional[Fin] = None
    csl_mean: Optional[Fin] = None
    CSL: Optional[Fin] = None
    stockout_day_rate: Optional[Fin] = None
    total_cost: Optional[Fin] = None
    ltd_calibration: Optional[Fin] = None


class PairedComparison(Strict):
    mean_total_cost_diff: Fin  # uncertainty_aware minus deterministic
    share_scenarios_uncertainty_aware_cheaper: Fin
    share_scenarios_equal: Fin
    ci_95_lower: Optional[Fin] = None
    ci_95_upper: Optional[Fin] = None


class SkuSimulation(Strict):
    sku_id: SkuIdT
    start_inventory: int
    mean_total_demand: NonNeg
    deterministic: PolicyMetrics
    uncertainty_aware: PolicyMetrics
    quantile: Optional[PolicyMetrics] = None
    s_det: Optional[PolicyMetrics] = None
    s_quant: Optional[PolicyMetrics] = None
    s_emp: Optional[PolicyMetrics] = None
    paired: PairedComparison
    sweep: Optional[SkuSweep] = None


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
    fill_rate: Optional[Fin] = None
    csl: Optional[Fin] = None
    CSL: Optional[Fin] = None
    stockout_day_rate: Optional[Fin] = None
    ltd_calibration: Optional[Fin] = None


class SimulateAggregate(Strict):
    deterministic: AggregatePolicyMetrics
    uncertainty_aware: AggregatePolicyMetrics
    quantile: Optional[AggregatePolicyMetrics] = None
    s_det: Optional[AggregatePolicyMetrics] = None
    s_quant: Optional[AggregatePolicyMetrics] = None
    s_emp: Optional[AggregatePolicyMetrics] = None
    mean_total_cost_diff_sum: Fin


class SimulateResponse(Strict):
    run_meta: RunMeta
    params: SimulateParams
    skus: list[SkuSimulation]
    aggregate: SimulateAggregate
    sweep: Optional[dict[SkuIdT, SkuSweep]] = None


# ---------- replay ----------
class ReplayParams(Strict):
    seed: SeedT = 42
    holdout_days: int = Field(28, ge=7, le=56)
    season_length: int = Field(7, ge=2, le=14)
    n_bootstrap: int = Field(500, ge=100, le=2000)
    block_size: int = Field(7, ge=1, le=14)
    min_history: int = Field(56, ge=28, le=365)
    origin_step: int = Field(7, ge=1, le=28)
    min_residual_blocks: int = Field(8, ge=2, le=100)


class ReplayRequest(Strict):
    series: list[SkuSeries] = Field(min_length=1, max_length=100)
    params: ReplayParams = Field(default_factory=ReplayParams)
    assumptions: dict[SkuIdT, SkuAssumptions]


class ReplayPolicyMetrics(Strict):
    fill_rate: Fin
    total_cost: Fin
    stockout_days: int
    csl: Optional[Fin] = None
    CSL: Optional[Fin] = None
    stockout_day_rate: Optional[Fin] = None
    ltd_calibration: Optional[Fin] = None


class SkuReplay(Strict):
    sku_id: SkuIdT
    status: Literal["ok", "insufficient_history", "no_demand", "model_failed", "ineligible", "failed"]
    deterministic: Optional[ReplayPolicyMetrics] = None
    uncertainty_aware: Optional[ReplayPolicyMetrics] = None
    quantile: Optional[ReplayPolicyMetrics] = None
    det: Optional[ReplayPolicyMetrics] = None
    unc: Optional[ReplayPolicyMetrics] = None
    s_det: Optional[ReplayPolicyMetrics] = None
    s_quant: Optional[ReplayPolicyMetrics] = None
    s_emp: Optional[ReplayPolicyMetrics] = None
    message: Optional[str] = None


class ReplayAggregate(Strict):
    deterministic: Optional[ReplayPolicyMetrics] = None
    uncertainty_aware: Optional[ReplayPolicyMetrics] = None
    quantile: Optional[ReplayPolicyMetrics] = None
    det: Optional[ReplayPolicyMetrics] = None
    unc: Optional[ReplayPolicyMetrics] = None
    s_det: Optional[ReplayPolicyMetrics] = None
    s_quant: Optional[ReplayPolicyMetrics] = None
    s_emp: Optional[ReplayPolicyMetrics] = None


class ReplayResponse(Strict):
    run_meta: RunMeta
    params: ReplayParams
    skus: list[SkuReplay]
    aggregate: Optional[ReplayAggregate] = None


# ---------- portfolio ----------
class PortfolioCurvePoint(Strict):
    service_level: Fin
    rop: int
    total_cost: Fin
    avg_inventory: Fin
    fill_rate: Optional[Fin] = None


class PortfolioSkuInput(Strict):
    sku_id: SkuIdT
    unit_cost: float = Field(gt=0, le=1e9, allow_inf_nan=False)
    annual_demand: float = Field(ge=0, allow_inf_nan=False)
    curve: list[PortfolioCurvePoint] = Field(min_length=1)


class PortfolioRequest(Strict):
    skus: list[PortfolioSkuInput] = Field(min_length=1)
    budget: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)
    capacity: Optional[float] = Field(default=None, gt=0, allow_inf_nan=False)


class SkuPortfolioPlan(Strict):
    sku_id: SkuIdT
    service_level: Fin
    rop: int
    avg_inventory: Fin
    inventory_investment: Fin
    total_cost: Fin
    turnover: Fin
    greedy_service_level: Optional[Fin] = None
    exact_service_level: Optional[Fin] = None
    greedy_cost: Optional[Fin] = None
    exact_cost: Optional[Fin] = None
    greedy_rop: Optional[int] = None
    exact_rop: Optional[int] = None


class PortfolioPlanSummary(Strict):
    skus: list[SkuPortfolioPlan]
    total_cost: Fin
    total_inventory_investment: Fin
    total_units: Fin
    avg_service_level: Fin
    turnover: Fin


class PortfolioResponse(Strict):
    run_meta: RunMeta
    unconstrained_plan: PortfolioPlanSummary
    constrained_plan: PortfolioPlanSummary
    total_cost_delta: Fin
    binding_constraints: list[str]
    budget_shadow_price: Fin
    budget: Optional[Fin] = None
    capacity: Optional[Fin] = None
    budget_usage_pct: Optional[Fin] = None
    capacity_usage_pct: Optional[Fin] = None
    status: str = "optimal"
    minimum_feasible_budget: Optional[Fin] = None
    greedy_cost: Optional[Fin] = None
    exact_cost: Optional[Fin] = None
    optimality_gap_pct: Optional[Fin] = None
    chosen_alphas: Optional[dict[str, Fin]] = None
    shadow_price: Optional[Fin] = None
    exact_plan: Optional[PortfolioPlanSummary] = None
    greedy_plan: Optional[PortfolioPlanSummary] = None

