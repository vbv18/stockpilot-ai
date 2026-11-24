from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

import lightgbm
import numpy as np
import pandas as pd
from statsforecast.models import AutoETS, SeasonalNaive

from ..schemas import (
    BaselineImprovement,
    EvaluateAggregate,
    ForecastParams,
    IntervalBand,
    IntervalMetrics,
    ModelAggregate,
    ModelComparisonRow,
    PointMetrics,
    SkuEvaluation,
)
from .bootstrap import block_cutoffs
from .classification import classify_demand
from .global_lgbm import fit_predict_global_quantile
from .intermittent import fit_predict_croston, simulate_intermittent_intervals
from .seeds import derive_seed

log = logging.getLogger("stats.evaluation")
NOMINAL_COVERAGE = 0.8  # P10-P90


def _pinball(y_t: np.ndarray, y_p: np.ndarray, tau: float) -> float:
    err = y_t - y_p
    return float(np.mean(np.maximum(tau * err, (tau - 1.0) * err)))


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
    model_comparison: list[ModelComparisonRow]
    baseline_improvement: BaselineImprovement
    coverage_minus_nominal: float


def evaluate_sku_rolling(
    sku_id: str,
    y: np.ndarray,
    params: ForecastParams,
    demand_class: Optional[str] = None,
    start_date: Optional[date] = None,
    panel_df: Optional[pd.DataFrame] = None,
) -> Optional[RollingEvaluationResult]:
    """
    Evaluates candidate models across the 8 rolling origins:
      - SeasonalNaive, AutoETS, and Naive for all SKUs
      - Plus GlobalLGBM for smooth/erratic SKUs
      - Plus CrostonSBA for intermittent/lumpy SKUs
    For each, computes MAE, RMSE, WAPE (null if sum is 0), MASE (scaled by
    seasonal-naive in-sample error, m=7) and P10-P90 coverage (nominal 80%).
    Chooses model by lowest rolling MASE, tie-breaking on pinball loss.
    Returns evaluation metrics, chosen model, % MASE improvement, and residual blocks.
    """
    y_arr = np.asarray(y, dtype=float)
    n = len(y_arr)
    origin_step = 28
    cutoffs = block_cutoffs(n, params.min_history, params.block_size, origin_step)
    if len(cutoffs) < 8:
        return None

    origins = cutoffs[-8:]
    if demand_class is None:
        demand_class, _, _ = classify_demand(y_arr)

    candidate_models = ["SeasonalNaive", "AutoETS", "Naive"]
    if demand_class in ("intermittent", "lumpy"):
        candidate_models.append("CrostonSBA")
    elif demand_class in ("smooth", "erratic"):
        candidate_models.append("GlobalLGBM")

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

        # 3. Naive baseline
        mean_nv = np.full(
            params.block_size,
            max(0.0, float(y_train[-1])) if len(y_train) > 0 else 0.0,
            dtype=float,
        )
        preds["Naive"].append(mean_nv)
        lo_bounds["Naive"].append(mean_nv)
        hi_bounds["Naive"].append(mean_nv)
        resid_blocks["Naive"].append(y_val - mean_nv)

        # 4. CrostonSBA (if applicable)
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

        # 5. GlobalLGBM (if applicable)
        if "GlobalLGBM" in candidate_models:
            try:
                lgbm_seed = int(derive_seed(params.seed, sku_id, f"lgbm_cutoff_{c}") % 2_147_483_647)
                if panel_df is not None:
                    sku_sub = panel_df[panel_df["sku_id"] == sku_id].sort_values("date")
                    if c <= len(sku_sub):
                        cutoff_dt = sku_sub.iloc[c - 1]["date"]
                        cutoff_panel = panel_df[panel_df["date"] <= cutoff_dt]
                    else:
                        cutoff_panel = panel_df
                else:
                    s_dt = pd.to_datetime(start_date) if start_date is not None else pd.Timestamp("2024-01-01")
                    dates = pd.date_range(start=s_dt, periods=c, freq="D")
                    cutoff_panel = pd.DataFrame({"sku_id": sku_id, "date": dates, "y": y_train})

                lgbm_map = fit_predict_global_quantile(cutoff_panel, params.block_size, lgbm_seed)
                if sku_id in lgbm_map:
                    mean_lgbm = np.asarray(lgbm_map[sku_id]["p50"], dtype=float)
                    lo_lgbm = np.asarray(lgbm_map[sku_id]["p10"], dtype=float)
                    hi_lgbm = np.asarray(lgbm_map[sku_id]["p90"], dtype=float)
                else:
                    mean_lgbm, lo_lgbm, hi_lgbm = mean_sn, lo_sn, hi_sn
            except Exception as exc:
                failed_origins += 1
                log.warning("GlobalLGBM rolling fit failed for %s at cutoff %s: %s", sku_id, c, exc)
                mean_lgbm, lo_lgbm, hi_lgbm = mean_sn, lo_sn, hi_sn
            preds["GlobalLGBM"].append(mean_lgbm)
            lo_bounds["GlobalLGBM"].append(lo_lgbm)
            hi_bounds["GlobalLGBM"].append(hi_lgbm)
            resid_blocks["GlobalLGBM"].append(y_val - mean_lgbm)

    sku_model_comparison: list[ModelComparisonRow] = []
    pinball_by_model: dict[str, list[float]] = {m: [] for m in candidate_models}

    for orig_idx, c in enumerate(origins):
        y_val = actual_blocks[orig_idx]
        scale_c = scales[orig_idx]
        sum_val = float(np.sum(y_val))
        used_for_sel = bool(orig_idx < 5)

        for m in candidate_models:
            mean_pred = preds[m][orig_idx]
            lo_pred = lo_bounds[m][orig_idx]
            hi_pred = hi_bounds[m][orig_idx]

            err_orig = y_val - mean_pred
            abs_err_orig = np.abs(err_orig)
            mae_orig = float(np.mean(abs_err_orig))
            rmse_orig = float(np.sqrt(np.mean(err_orig ** 2)))
            wape_orig = float(np.sum(abs_err_orig) / sum_val) if sum_val > 0.0 else None
            mase_orig = float(mae_orig / scale_c) if scale_c > 0.0 else (0.0 if mae_orig == 0.0 else 1.0)
            pb_orig = float(
                (
                    _pinball(y_val, lo_pred, 0.1)
                    + _pinball(y_val, mean_pred, 0.5)
                    + _pinball(y_val, hi_pred, 0.9)
                )
                / 3.0
            )
            cov_orig = float(np.mean((y_val >= lo_pred) & (y_val <= hi_pred)))
            pinball_by_model[m].append(pb_orig)

            sku_model_comparison.append(
                ModelComparisonRow(
                    sku_id=sku_id,
                    model=m,
                    origin=int(c),
                    mae=mae_orig,
                    rmse=rmse_orig,
                    wape=wape_orig,
                    mase=mase_orig,
                    pinball_loss=pb_orig,
                    coverage=cov_orig,
                    used_for_selection=used_for_sel,
                )
            )

    # Model selection on folds 1-5 by mean pinball loss (P10/P50/P90).
    # Naive and SeasonalNaive are baselines only, not selectable.
    selectable = [m for m in candidate_models if m not in ("Naive", "SeasonalNaive")]
    if not selectable:
        selectable = list(candidate_models)

    sel_pinball = {
        m: float(np.mean(pinball_by_model[m][:5])) for m in selectable
    }
    chosen_model = min(selectable, key=lambda mod: sel_pinball[mod])

    # For intermittent/lumpy SKUs, if the chosen forecast mean is 0 while the last 90 days contain demand, fall back to CrostonSBA
    if demand_class in ("intermittent", "lumpy") and "CrostonSBA" in candidate_models:
        demand_last_90 = float(np.sum(y_arr[-90:])) if len(y_arr) >= 90 else float(np.sum(y_arr))
        test_chosen_mean = float(np.mean(np.concatenate(preds[chosen_model][5:8])))
        if demand_last_90 > 0.0 and test_chosen_mean <= 1e-9:
            chosen_model = "CrostonSBA"

    # Report metrics on folds 6-8 (test folds)
    test_actuals = np.concatenate(actual_blocks[5:8])
    test_scale = float(np.mean(scales[5:8]))
    sum_test_actual = float(np.sum(test_actuals))

    model_metrics: dict[str, PointMetrics] = {}
    model_predictions: dict[str, list[float]] = {}
    model_intervals: dict[str, tuple[list[float], list[float]]] = {}
    model_pinball: dict[str, float] = {}

    for m in candidate_models:
        test_m_preds = np.concatenate(preds[m][5:8])
        test_m_lo = np.concatenate(lo_bounds[m][5:8])
        test_m_hi = np.concatenate(hi_bounds[m][5:8])
        model_predictions[m] = test_m_preds.tolist()
        model_intervals[m] = (test_m_lo.tolist(), test_m_hi.tolist())

        err = test_actuals - test_m_preds
        abs_err = np.abs(err)
        sum_abs_err = float(np.sum(abs_err))
        mae = float(np.mean(abs_err))
        rmse = float(np.sqrt(np.mean(err ** 2)))
        wape = float(sum_abs_err / sum_test_actual) if sum_test_actual > 0.0 else None
        mase = float(mae / test_scale) if test_scale > 0.0 else (0.0 if mae == 0.0 else 1.0)
        coverage = float(np.mean((test_actuals >= test_m_lo) & (test_actuals <= test_m_hi)))

        pb = float(
            (
                _pinball(test_actuals, test_m_lo, 0.1)
                + _pinball(test_actuals, test_m_preds, 0.5)
                + _pinball(test_actuals, test_m_hi, 0.9)
            )
            / 3.0
        )
        model_pinball[m] = pb

        model_metrics[m] = PointMetrics(
            mae=mae,
            rmse=rmse,
            wape=wape,
            wape_status="ok" if wape is not None else "zero_denominator",
            sum_abs_error=sum_abs_err,
            sum_actual=sum_test_actual,
            mase=mase,
            coverage=coverage,
            pinball_loss=pb,
        )

    sn_mase = model_metrics["SeasonalNaive"].mase
    chosen_mase = model_metrics[chosen_model].mase
    if sn_mase is not None and sn_mase > 0 and chosen_mase is not None:
        mase_improvement = float((sn_mase - chosen_mase) / sn_mase * 100.0)
    else:
        mase_improvement = 0.0

    naive_metric = model_metrics.get("Naive") or model_metrics.get("SeasonalNaive")
    selected_metric = model_metrics[chosen_model]
    if naive_metric and naive_metric.mae > 0:
        mae_pct = float((naive_metric.mae - selected_metric.mae) / naive_metric.mae * 100.0)
    else:
        mae_pct = 0.0

    if naive_metric and naive_metric.rmse > 0:
        rmse_pct = float((naive_metric.rmse - selected_metric.rmse) / naive_metric.rmse * 100.0)
    else:
        rmse_pct = 0.0

    if (
        naive_metric
        and naive_metric.wape is not None
        and selected_metric.wape is not None
        and naive_metric.wape > 0
    ):
        wape_pct = float((naive_metric.wape - selected_metric.wape) / naive_metric.wape * 100.0)
    else:
        wape_pct = 0.0

    sel_cov = selected_metric.coverage if selected_metric.coverage is not None else NOMINAL_COVERAGE
    cov_minus_nom = float(sel_cov - NOMINAL_COVERAGE)

    sku_baseline_improvement = BaselineImprovement(
        mae_pct=mae_pct,
        rmse_pct=rmse_pct,
        wape_pct=wape_pct,
        coverage_minus_nominal=cov_minus_nom,
    )

    chosen_residual_blocks = np.vstack(resid_blocks[chosen_model])

    return RollingEvaluationResult(
        models=model_metrics,
        chosen_model=chosen_model,
        mase_improvement=mase_improvement,
        residual_blocks=chosen_residual_blocks,
        residual_cutoffs=origins,
        actuals=test_actuals.tolist(),
        predictions=model_predictions,
        intervals=model_intervals,
        failed_origins=failed_origins,
        model_comparison=sku_model_comparison,
        baseline_improvement=sku_baseline_improvement,
        coverage_minus_nominal=cov_minus_nom,
    )


def evaluate_series(
    sku_id: str,
    start_date: date,
    y: np.ndarray,
    params: ForecastParams,
    panel_df: Optional[pd.DataFrame] = None,
) -> SkuEvaluation:
    y_arr = np.asarray(y, dtype=float)
    n = len(y_arr)
    demand_class, _, _ = classify_demand(y_arr)

    eval_result = evaluate_sku_rolling(
        sku_id, y_arr, params, demand_class, start_date=start_date, panel_df=panel_df
    )
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
        naive_mean=eval_result.predictions.get("Naive"),
        global_lgbm_mean=eval_result.predictions.get("GlobalLGBM"),
        intervals=intervals,
        autoets=eval_result.models.get("AutoETS"),
        seasonal_naive=eval_result.models.get("SeasonalNaive"),
        croston_sba=eval_result.models.get("CrostonSBA"),
        naive=eval_result.models.get("Naive"),
        global_lgbm=eval_result.models.get("GlobalLGBM"),
        chosen_model=chosen,
        mase_improvement=eval_result.mase_improvement,
        models=eval_result.models,
        interval_metrics=interval_metrics,
        baseline_improvement=eval_result.baseline_improvement,
        coverage_minus_nominal=eval_result.coverage_minus_nominal,
        model_comparison=eval_result.model_comparison,
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
    naive = [e.naive for e in evals if e.naive is not None]
    global_lgbm = [e.global_lgbm for e in evals if e.global_lgbm is not None]
    iv = [e.interval_metrics for e in evals if e.interval_metrics is not None]

    all_model_comparison: list[ModelComparisonRow] = []
    for e in evals:
        if e.model_comparison:
            all_model_comparison.extend(e.model_comparison)

    valid_improvements = [e.baseline_improvement for e in evals if e.baseline_improvement is not None]
    if valid_improvements:
        cov_delta = float(
            np.mean([
                bi.coverage_minus_nominal if bi.coverage_minus_nominal is not None else 0.0
                for bi in valid_improvements
            ])
        )
        overall_baseline_improvement = BaselineImprovement(
            mae_pct=float(np.mean([bi.mae_pct for bi in valid_improvements])),
            rmse_pct=float(np.mean([bi.rmse_pct for bi in valid_improvements])),
            wape_pct=float(np.mean([bi.wape_pct for bi in valid_improvements])),
            coverage_minus_nominal=cov_delta,
        )
        overall_cov_minus_nom = cov_delta
    else:
        overall_baseline_improvement = None
        overall_cov_minus_nom = None

    cov_mean = float(np.mean([m.coverage for m in iv])) if iv else None

    return EvaluateAggregate(
        autoets=_model_aggregate(ets),
        seasonal_naive=_model_aggregate(sn),
        croston_sba=_model_aggregate(croston) if croston else None,
        naive=_model_aggregate(naive) if naive else None,
        global_lgbm=_model_aggregate(global_lgbm) if global_lgbm else None,
        baseline_improvement=overall_baseline_improvement,
        coverage_minus_nominal=overall_cov_minus_nom,
        model_comparison=all_model_comparison if all_model_comparison else None,
        n_skus_with_intervals=len(iv),
        coverage_mean=cov_mean,
        mean_width_mean=float(np.mean([m.mean_width for m in iv])) if iv else None,
    )
