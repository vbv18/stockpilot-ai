from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import numpy as np
from statsforecast.models import AutoETS, SeasonalNaive

from ..schemas import (
    EvaluateAggregate,
    ForecastParams,
    IntervalBand,
    IntervalMetrics,
    ModelAggregate,
    PointMetrics,
    SkuEvaluation,
)
from .bootstrap import block_cutoffs
from .classification import classify_demand
from .intermittent import fit_predict_croston, simulate_intermittent_intervals

log = logging.getLogger("stats.evaluation")
NOMINAL_COVERAGE = 0.8  # P10-P90


@dataclass
class RollingEvaluationResult:
    models: dict[str, PointMetrics]
    chosen_model: str
    mase_improvement: float
    residual_blocks: np.ndarray
    residual_cutoffs: list[int]
    actuals: list[float]
    predictions: dict[str, list[float]]
    intervals: dict[str, tuple[list[float], list[float]]]
    failed_origins: int


def evaluate_sku_rolling(
    sku_id: str,
    y: np.ndarray,
    params: ForecastParams,
    demand_class: Optional[str] = None,
) -> Optional[RollingEvaluationResult]:
    """
    Evaluates candidate models across the 8 rolling origins:
      - SeasonalNaive and AutoETS for all SKUs
      - Plus CrostonSBA for intermittent/lumpy SKUs
    For each, computes MAE, RMSE, WAPE (null if sum is 0), MASE (scaled by
    seasonal-naive in-sample error, m=7) and P10-P90 coverage (nominal 80%).
    Chooses model by lowest rolling MASE.
    Returns evaluation metrics, chosen model, % MASE improvement, and residual blocks.
    """
    y_arr = np.asarray(y, dtype=float)
    n = len(y_arr)
    cutoffs = block_cutoffs(n, params.min_history, params.block_size, params.origin_step)
    if len(cutoffs) < params.min_residual_blocks:
        return None

    origins = cutoffs[-8:]
    if demand_class is None:
        demand_class, _, _ = classify_demand(y_arr)

    candidate_models = ["SeasonalNaive", "AutoETS"]
    if demand_class in ("intermittent", "lumpy"):
        candidate_models.append("CrostonSBA")

    actual_blocks: list[np.ndarray] = []
    preds: dict[str, list[np.ndarray]] = {m: [] for m in candidate_models}
    lo_bounds: dict[str, list[np.ndarray]] = {m: [] for m in candidate_models}
    hi_bounds: dict[str, list[np.ndarray]] = {m: [] for m in candidate_models}
    resid_blocks: dict[str, list[np.ndarray]] = {m: [] for m in candidate_models}
    scales: list[float] = []
    failed_origins = 0
    m_season = params.season_length

    for c in origins:
        y_train = y_arr[:c]
        y_val = y_arr[c : c + params.block_size]
        actual_blocks.append(y_val)

        # In-sample seasonal naive differences (m=7)
        if len(y_train) > m_season:
            diffs = np.abs(y_train[m_season:] - y_train[:-m_season])
            scale_c = float(np.mean(diffs))
        else:
            scale_c = 1.0
        scales.append(max(scale_c, 1e-9))

        # 1. SeasonalNaive
        try:
            sn = SeasonalNaive(season_length=params.season_length)
            sn.fit(y=y_train)
            p_sn = sn.predict(h=params.block_size, level=[80])
            mean_sn = np.clip(np.asarray(p_sn["mean"], dtype=float), 0.0, None)
            lo_sn = np.clip(np.asarray(p_sn.get("lo-80", mean_sn), dtype=float), 0.0, None)
            hi_sn = np.clip(np.asarray(p_sn.get("hi-80", mean_sn), dtype=float), 0.0, None)
        except Exception as exc:
            failed_origins += 1
            log.warning("SeasonalNaive rolling fit failed for %s at cutoff %s: %s", sku_id, c, exc)
            mean_sn = np.full(params.block_size, float(np.mean(y_train)))
            lo_sn, hi_sn = mean_sn, mean_sn
        preds["SeasonalNaive"].append(mean_sn)
        lo_bounds["SeasonalNaive"].append(lo_sn)
        hi_bounds["SeasonalNaive"].append(hi_sn)
        resid_blocks["SeasonalNaive"].append(y_val - mean_sn)

        # 2. AutoETS
        try:
            ets = AutoETS(season_length=params.season_length)
            ets.fit(y=np.ascontiguousarray(y_train, dtype=np.float64))
            p_ets = ets.predict(h=params.block_size, level=[80])
            mean_ets = np.clip(np.asarray(p_ets["mean"], dtype=float), 0.0, None)
            lo_ets = np.clip(np.asarray(p_ets.get("lo-80", mean_ets), dtype=float), 0.0, None)
            hi_ets = np.clip(np.asarray(p_ets.get("hi-80", mean_ets), dtype=float), 0.0, None)
        except Exception as exc:
            failed_origins += 1
            log.warning("AutoETS rolling fit failed for %s at cutoff %s: %s", sku_id, c, exc)
            mean_ets = mean_sn
            lo_ets, hi_ets = lo_sn, hi_sn
        preds["AutoETS"].append(mean_ets)
        lo_bounds["AutoETS"].append(lo_ets)
        hi_bounds["AutoETS"].append(hi_ets)
        resid_blocks["AutoETS"].append(y_val - mean_ets)

        # 3. CrostonSBA (if applicable)
        if "CrostonSBA" in candidate_models:
            try:
                mean_cr, _ = fit_predict_croston(y_train, params.block_size)
                p10, _, p90, _ = simulate_intermittent_intervals(
                    f"{sku_id}_{c}", y_train, params.block_size, n_sim=500, history_days=90
                )
                lo_cr, hi_cr = p10, p90
            except Exception as exc:
                failed_origins += 1
                log.warning("CrostonSBA rolling fit failed for %s at cutoff %s: %s", sku_id, c, exc)
                mean_cr = mean_sn
                lo_cr, hi_cr = lo_sn, hi_sn
            preds["CrostonSBA"].append(mean_cr)
            lo_bounds["CrostonSBA"].append(lo_cr)
            hi_bounds["CrostonSBA"].append(hi_cr)
            resid_blocks["CrostonSBA"].append(y_val - mean_cr)

    all_actuals = np.concatenate(actual_blocks)
    mean_scale = float(np.mean(scales))
    sum_actual = float(np.sum(all_actuals))

    model_metrics: dict[str, PointMetrics] = {}
    model_predictions: dict[str, list[float]] = {}
    model_intervals: dict[str, tuple[list[float], list[float]]] = {}

    for m in candidate_models:
        all_m_preds = np.concatenate(preds[m])
        all_m_lo = np.concatenate(lo_bounds[m])
        all_m_hi = np.concatenate(hi_bounds[m])
        model_predictions[m] = all_m_preds.tolist()
        model_intervals[m] = (all_m_lo.tolist(), all_m_hi.tolist())

        err = all_actuals - all_m_preds
        abs_err = np.abs(err)
        sum_abs_err = float(np.sum(abs_err))
        mae = float(np.mean(abs_err))
        rmse = float(np.sqrt(np.mean(err ** 2)))
        wape = float(sum_abs_err / sum_actual) if sum_actual > 0.0 else None
        mase = float(mae / mean_scale) if mean_scale > 0.0 else (0.0 if mae == 0.0 else 1.0)
        coverage = float(np.mean((all_actuals >= all_m_lo) & (all_actuals <= all_m_hi)))

        model_metrics[m] = PointMetrics(
            mae=mae,
            rmse=rmse,
            wape=wape,
            wape_status="ok" if wape is not None else "zero_denominator",
            sum_abs_error=sum_abs_err,
            sum_actual=sum_actual,
            mase=mase,
            coverage=coverage,
        )

    # Choose model by lowest rolling MASE
    chosen_model = min(
        candidate_models,
        key=lambda mod: (model_metrics[mod].mase if model_metrics[mod].mase is not None else float("inf")),
    )

    sn_mase = model_metrics["SeasonalNaive"].mase
    chosen_mase = model_metrics[chosen_model].mase
    if sn_mase is not None and sn_mase > 0 and chosen_mase is not None:
        mase_improvement = float((sn_mase - chosen_mase) / sn_mase * 100.0)
    else:
        mase_improvement = 0.0

    chosen_residual_blocks = np.vstack(resid_blocks[chosen_model])

    return RollingEvaluationResult(
        models=model_metrics,
        chosen_model=chosen_model,
        mase_improvement=mase_improvement,
        residual_blocks=chosen_residual_blocks,
        residual_cutoffs=origins,
        actuals=all_actuals.tolist(),
        predictions=model_predictions,
        intervals=model_intervals,
        failed_origins=failed_origins,
    )


def evaluate_series(sku_id: str, start_date: date, y: np.ndarray, params: ForecastParams) -> SkuEvaluation:
    y_arr = np.asarray(y, dtype=float)
    n = len(y_arr)
    demand_class, _, _ = classify_demand(y_arr)

    eval_result = evaluate_sku_rolling(sku_id, y_arr, params, demand_class)
    if eval_result is None:
        return SkuEvaluation(
            sku_id=sku_id,
            status="insufficient_history",
            interval_status="not_computed",
            message=f"Needs at least {params.min_history + 8 * params.origin_step} days of history for 8-origin rolling evaluation; got {n}.",
            n_observations=n,
            n_train=max(n - 8 * params.block_size, 0),
            n_residual_blocks=0,
        )

    first_origin = eval_result.residual_cutoffs[0]
    holdout_start_date = start_date + timedelta(days=int(first_origin))

    chosen = eval_result.chosen_model
    chosen_preds = eval_result.predictions[chosen]
    chosen_lo, chosen_hi = eval_result.intervals[chosen]
    intervals = IntervalBand(p10=chosen_lo, p50=chosen_preds, p90=chosen_hi)

    inside = (np.array(eval_result.actuals) >= np.array(chosen_lo)) & (np.array(eval_result.actuals) <= np.array(chosen_hi))
    interval_metrics = IntervalMetrics(
        nominal_coverage=NOMINAL_COVERAGE,
        coverage=float(np.mean(inside)),
        mean_width=float(np.mean(np.array(chosen_hi) - np.array(chosen_lo))),
    )

    warnings: list[str] = []
    if eval_result.failed_origins > 0:
        warnings.append(f"{eval_result.failed_origins} origin model fit(s) encountered exceptions and fell back.")

    return SkuEvaluation(
        sku_id=sku_id,
        status="ok",
        interval_status="ok",
        message=None,
        n_observations=n,
        n_train=int(first_origin),
        holdout_start_date=holdout_start_date,
        actual=eval_result.actuals,
        autoets_mean=chosen_preds,
        seasonal_naive_mean=eval_result.predictions.get("SeasonalNaive"),
        intervals=intervals,
        autoets=eval_result.models.get("AutoETS"),
        seasonal_naive=eval_result.models.get("SeasonalNaive"),
        croston_sba=eval_result.models.get("CrostonSBA"),
        chosen_model=chosen,
        mase_improvement=eval_result.mase_improvement,
        models=eval_result.models,
        interval_metrics=interval_metrics,
        n_residual_blocks=int(eval_result.residual_blocks.shape[0]),
        warnings=warnings,
    )


def _model_aggregate(metrics: list[PointMetrics]) -> ModelAggregate:
    if not metrics:
        return ModelAggregate(n_skus=0)
    abs_sum = sum(m.sum_abs_error for m in metrics)
    act_sum = sum(m.sum_actual for m in metrics)
    mases = [m.mase for m in metrics if m.mase is not None]
    covs = [m.coverage for m in metrics if m.coverage is not None]
    return ModelAggregate(
        n_skus=len(metrics),
        mae_mean=float(np.mean([m.mae for m in metrics])),
        rmse_mean=float(np.mean([m.rmse for m in metrics])),
        wape_pooled=(abs_sum / act_sum) if act_sum > 0 else None,
        mase_mean=float(np.mean(mases)) if mases else None,
        coverage_mean=float(np.mean(covs)) if covs else None,
    )


def aggregate(evals: list[SkuEvaluation]) -> EvaluateAggregate:
    ets = [e.autoets for e in evals if e.autoets is not None]
    sn = [e.seasonal_naive for e in evals if e.seasonal_naive is not None]
    croston = [e.croston_sba for e in evals if e.croston_sba is not None]
    iv = [e.interval_metrics for e in evals if e.interval_metrics is not None]

    return EvaluateAggregate(
        autoets=_model_aggregate(ets),
        seasonal_naive=_model_aggregate(sn),
        croston_sba=_model_aggregate(croston) if croston else None,
        n_skus_with_intervals=len(iv),
        coverage_mean=float(np.mean([m.coverage for m in iv])) if iv else None,
        mean_width_mean=float(np.mean([m.mean_width for m in iv])) if iv else None,
    )
