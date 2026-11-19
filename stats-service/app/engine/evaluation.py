from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import numpy as np

from ..schemas import (EvaluateAggregate, IntervalBand, IntervalMetrics, ModelAggregate,
                       PointMetrics, ForecastParams, SkuEvaluation)
from .forecasting import fit_sku

NOMINAL_COVERAGE = 0.8  # P10-P90


def point_metrics(actual: np.ndarray, pred: np.ndarray) -> PointMetrics:
    err = actual - pred
    abs_sum = float(np.abs(err).sum())
    denom = float(actual.sum())
    wape = None if denom <= 0.0 else abs_sum / denom
    return PointMetrics(
        mae=float(np.abs(err).mean()),
        rmse=float(np.sqrt(np.mean(err ** 2))),
        wape=wape,
        wape_status="zero_denominator" if wape is None else "ok",
        sum_abs_error=abs_sum,
        sum_actual=denom,
    )


def evaluate_series(sku_id: str, start_date: date, y: np.ndarray, params: ForecastParams) -> SkuEvaluation:
    h = params.horizon
    n = int(len(y))
    n_train = n - h
    if n_train < params.min_history:
        return SkuEvaluation(
            sku_id=sku_id, status="insufficient_history", interval_status="not_computed",
            message=f"Needs at least {params.min_history + h} days of history for a {h}-day holdout evaluation; got {n}.",
            n_observations=n, n_train=max(n_train, 0), n_residual_blocks=0,
        )
    train, actual = y[:n_train], y[n_train:]
    fit = fit_sku(sku_id, train, params)  # trains ONLY on pre-holdout data (no leakage)
    base = dict(sku_id=sku_id, status=fit.status, interval_status=fit.interval_status, message=fit.message,
                n_observations=n, n_train=n_train, n_residual_blocks=0, warnings=fit.warnings)
    if fit.status != "ok":
        return SkuEvaluation(**base)

    ev = SkuEvaluation(
        **{**base, "n_residual_blocks": int(fit.residual_blocks.shape[0]) if fit.residual_blocks is not None else 0},
        holdout_start_date=start_date + timedelta(days=n_train),
        actual=actual.tolist(),
        autoets_mean=fit.autoets_mean.tolist(),
        seasonal_naive_mean=fit.seasonal_naive_mean.tolist(),
        autoets=point_metrics(actual, fit.autoets_mean),
        seasonal_naive=point_metrics(actual, fit.seasonal_naive_mean),
    )
    if fit.interval_status == "ok":
        ev.intervals = IntervalBand(p10=fit.p10.tolist(), p50=fit.p50.tolist(), p90=fit.p90.tolist())
        inside = (actual >= fit.p10) & (actual <= fit.p90)
        ev.interval_metrics = IntervalMetrics(
            nominal_coverage=NOMINAL_COVERAGE,
            coverage=float(np.mean(inside)),
            mean_width=float(np.mean(fit.p90 - fit.p10)),
        )
    return ev


def _model_aggregate(metrics: list[PointMetrics]) -> ModelAggregate:
    if not metrics:
        return ModelAggregate(n_skus=0)
    abs_sum = sum(m.sum_abs_error for m in metrics)
    act_sum = sum(m.sum_actual for m in metrics)
    return ModelAggregate(
        n_skus=len(metrics),
        mae_mean=float(np.mean([m.mae for m in metrics])),
        rmse_mean=float(np.mean([m.rmse for m in metrics])),
        wape_pooled=(abs_sum / act_sum) if act_sum > 0 else None,
    )


def aggregate(evals: list[SkuEvaluation]) -> EvaluateAggregate:
    ets = [e.autoets for e in evals if e.autoets is not None]
    sn = [e.seasonal_naive for e in evals if e.seasonal_naive is not None]
    iv = [e.interval_metrics for e in evals if e.interval_metrics is not None]
    return EvaluateAggregate(
        autoets=_model_aggregate(ets),
        seasonal_naive=_model_aggregate(sn),
        n_skus_with_intervals=len(iv),
        coverage_mean=float(np.mean([m.coverage for m in iv])) if iv else None,
        mean_width_mean=float(np.mean([m.mean_width for m in iv])) if iv else None,
    )
