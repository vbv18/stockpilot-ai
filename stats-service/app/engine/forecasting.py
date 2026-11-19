from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

import numpy as np
from statsforecast.models import AutoETS, SeasonalNaive

from ..schemas import ForecastParams, IntervalBand, SkuForecast
from .bootstrap import block_cutoffs, generate_paths
from .seeds import derive_seed

log = logging.getLogger("stats.forecast")


@dataclass
class SkuFit:
    sku_id: str
    status: str
    interval_status: str
    message: Optional[str]
    n_observations: int
    autoets_mean: Optional[np.ndarray] = None
    seasonal_naive_mean: Optional[np.ndarray] = None
    p10: Optional[np.ndarray] = None
    p50: Optional[np.ndarray] = None
    p90: Optional[np.ndarray] = None
    residual_blocks: Optional[np.ndarray] = None
    residual_cutoffs: list[int] = field(default_factory=list)
    residual_std: Optional[float] = None
    n_failed_origins: int = 0
    model_spec: Optional[str] = None
    warnings: list[str] = field(default_factory=list)


def fit_predict(model_cls, y: np.ndarray, h: int, season_length: int):
    model = model_cls(season_length=season_length)
    model.fit(y=np.ascontiguousarray(y, dtype=np.float64))
    out = model.predict(h=h)
    mean = np.asarray(out["mean"], dtype=float)
    if mean.shape != (h,) or not np.all(np.isfinite(mean)):
        raise ValueError("model returned a non-finite or wrongly shaped forecast")
    return np.clip(mean, 0.0, None), model


def _model_spec(model) -> Optional[str]:
    try:
        fitted = getattr(model, "model_", None)
        if isinstance(fitted, dict) and "method" in fitted:
            return str(fitted["method"])
    except Exception:  # pragma: no cover - cosmetic only
        return None
    return None


def collect_residual_blocks(y: np.ndarray, params: ForecastParams):
    cutoffs = block_cutoffs(len(y), params.min_history, params.block_size, params.origin_step)
    blocks: list[np.ndarray] = []
    used: list[int] = []
    failed = 0
    for c in cutoffs:
        try:
            forecast, _ = fit_predict(AutoETS, y[:c], params.block_size, params.season_length)
            resid = y[c : c + params.block_size] - forecast
            if resid.shape[0] != params.block_size or not np.all(np.isfinite(resid)):
                raise ValueError("invalid residual block")
            blocks.append(resid)
            used.append(c)
        except Exception as exc:  # one failed origin must not fail the SKU
            failed += 1
            log.warning("rolling-origin fit failed at cutoff=%s: %s", c, type(exc).__name__)
    return blocks, used, failed


def fit_sku(sku_id: str, y: np.ndarray, params: ForecastParams) -> SkuFit:
    n = int(len(y))
    if n < params.min_history:
        return SkuFit(sku_id, "insufficient_history", "not_computed",
                      f"Needs at least {params.min_history} days of history; got {n}.", n)
    if float(np.sum(y)) <= 0.0:
        return SkuFit(sku_id, "no_demand", "not_computed", "All observed demand is zero.", n)

    try:
        ets_mean, ets_model = fit_predict(AutoETS, y, params.horizon, params.season_length)
        sn_mean, _ = fit_predict(SeasonalNaive, y, params.horizon, params.season_length)
    except Exception as exc:
        log.warning("model fit failed for %s: %s", sku_id, type(exc).__name__)
        return SkuFit(sku_id, "model_failed", "not_computed", f"Model fitting failed ({type(exc).__name__}).", n)

    fit = SkuFit(sku_id, "ok", "not_computed", None, n,
                 autoets_mean=ets_mean, seasonal_naive_mean=sn_mean, model_spec=_model_spec(ets_model))

    if float(np.mean(np.asarray(y) == 0.0)) > 0.5:
        fit.warnings.append("More than half of observed days have zero demand; intervals and normal approximations may be unreliable.")

    blocks_list, used, failed = collect_residual_blocks(y, params)
    fit.n_failed_origins = failed
    if failed:
        fit.warnings.append(f"{failed} rolling-origin fit(s) failed and were skipped.")

    if len(blocks_list) < params.min_residual_blocks:
        fit.interval_status = "insufficient_residuals"
        fit.warnings.append(
            f"Only {len(blocks_list)} residual block(s) available; at least {params.min_residual_blocks} are required. "
            "Prediction intervals were not computed."
        )
        return fit

    blocks = np.vstack(blocks_list)
    rng = np.random.default_rng(derive_seed(params.seed, sku_id, "bootstrap"))
    paths = generate_paths(ets_mean, blocks, params.n_bootstrap, params.horizon, params.block_size, rng)
    p10, p50, p90 = np.percentile(paths, [10, 50, 90], axis=0)
    fit.interval_status = "ok"
    fit.p10, fit.p50, fit.p90 = p10, p50, p90
    fit.residual_blocks = blocks
    fit.residual_cutoffs = used
    fit.residual_std = float(np.std(blocks.ravel(), ddof=1))
    return fit


def to_sku_forecast(fit: SkuFit, start_date: date, n_obs: int) -> SkuForecast:
    ok = fit.status == "ok"
    intervals = None
    if ok and fit.interval_status == "ok":
        intervals = IntervalBand(p10=fit.p10.tolist(), p50=fit.p50.tolist(), p90=fit.p90.tolist())
    return SkuForecast(
        sku_id=fit.sku_id,
        status=fit.status,
        interval_status=fit.interval_status,
        message=fit.message,
        n_observations=n_obs,
        forecast_start_date=(start_date + timedelta(days=n_obs)) if ok else None,
        autoets_mean=fit.autoets_mean.tolist() if ok else None,
        seasonal_naive_mean=fit.seasonal_naive_mean.tolist() if ok else None,
        intervals=intervals,
        residual_blocks=fit.residual_blocks.tolist() if intervals is not None else None,
        residual_block_cutoffs=list(fit.residual_cutoffs) if intervals is not None else None,
        residual_std=fit.residual_std if intervals is not None else None,
        n_residual_blocks=int(fit.residual_blocks.shape[0]) if fit.residual_blocks is not None else len(fit.residual_cutoffs),
        n_failed_origins=fit.n_failed_origins,
        autoets_model_spec=fit.model_spec if ok else None,
        warnings=fit.warnings,
    )
