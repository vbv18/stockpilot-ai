from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Optional

import lightgbm
import numpy as np
import pandas as pd
from statsforecast.models import AutoETS, SeasonalNaive

from ..schemas import ForecastParams, IntervalBand, SkuForecast
from .bootstrap import block_cutoffs, generate_paths
from .classification import classify_demand
from .evaluation import evaluate_sku_rolling
from .global_lgbm import fit_predict_global_quantile
from .intermittent import (
    collect_residual_blocks_croston,
    fit_predict_croston,
    simulate_intermittent_intervals,
)
from .seeds import derive_seed

log = logging.getLogger("stats.forecast")


def naive_last(y: np.ndarray, h: int) -> np.ndarray:
    """Repeat the last observed value for h horizon steps."""
    if len(y) == 0:
        return np.zeros(h, dtype=float)
    return np.full(h, max(0.0, float(y[-1])), dtype=float)


@dataclass
class SkuFit:
    sku_id: str
    status: str
    interval_status: str
    message: Optional[str]
    n_observations: int
    demand_class: str = "smooth"
    adi: float = 1.0
    cv2: float = 0.0
    chosen_model: Optional[str] = None
    mase_improvement: Optional[float] = None
    autoets_mean: Optional[np.ndarray] = None
    seasonal_naive_mean: Optional[np.ndarray] = None
    naive_mean: Optional[np.ndarray] = None
    global_lgbm_mean: Optional[np.ndarray] = None
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


def fit_intermittent_sku(
    sku_id: str,
    y: np.ndarray,
    params: ForecastParams,
    demand_class: str,
    adi: float,
    cv2: float,
) -> SkuFit:
    n = int(len(y))
    try:
        croston_mean, _ = fit_predict_croston(y, params.horizon)
        sn_mean, _ = fit_predict(SeasonalNaive, y, params.horizon, params.season_length)
    except Exception as exc:
        log.warning("croston model fit failed for %s: %s", sku_id, type(exc).__name__)
        return SkuFit(
            sku_id, "model_failed", "not_computed", f"Model fitting failed ({type(exc).__name__}).", n,
            demand_class=demand_class, adi=adi, cv2=cv2,
        )

    p10, p50, p90, _ = simulate_intermittent_intervals(sku_id, y, params.horizon, n_sim=500, history_days=90)

    fit = SkuFit(
        sku_id=sku_id,
        status="ok",
        interval_status="ok",
        message=None,
        n_observations=n,
        demand_class=demand_class,
        adi=adi,
        cv2=cv2,
        autoets_mean=croston_mean,
        seasonal_naive_mean=sn_mean,
        p10=p10,
        p50=p50,
        p90=p90,
        model_spec="CrostonSBA",
        warnings=[f"Demand classified as {demand_class} (ADI={adi:.2f}, CV²={cv2:.2f}); using Croston SBA point forecast and non-parametric simulation."],
    )

    blocks_list, used, failed = collect_residual_blocks_croston(y, params)
    fit.n_failed_origins = failed
    if failed:
        fit.warnings.append(f"{failed} rolling-origin fit(s) failed and were skipped.")

    if len(blocks_list) >= params.min_residual_blocks:
        blocks = np.vstack(blocks_list)
        fit.residual_blocks = blocks
        fit.residual_cutoffs = used
        fit.residual_std = float(np.std(blocks.ravel(), ddof=1))
    else:
        fit.warnings.append(
            f"Only {len(blocks_list)} residual block(s) available; at least {params.min_residual_blocks} are required for downstream optimization."
        )

    return fit


def fit_sku(
    sku_id: str,
    y: np.ndarray,
    params: ForecastParams,
    start_date: Optional[date] = None,
    panel_df: Optional[pd.DataFrame] = None,
) -> SkuFit:
    n = int(len(y))
    demand_class, adi, cv2 = classify_demand(y)
    if n < params.min_history:
        return SkuFit(
            sku_id, "insufficient_history", "not_computed",
            f"Needs at least {params.min_history} days of history; got {n}.", n,
            demand_class=demand_class, adi=adi, cv2=cv2,
        )
    if float(np.sum(y)) <= 0.0:
        return SkuFit(
            sku_id, "no_demand", "not_computed", "All observed demand is zero.", n,
            demand_class=demand_class, adi=adi, cv2=cv2,
        )

    eval_result = evaluate_sku_rolling(
        sku_id, y, params, demand_class, start_date=start_date, panel_df=panel_df
    )
    if eval_result is None:
        return SkuFit(
            sku_id, "insufficient_history", "not_computed",
            f"Needs at least {params.min_history + 8 * params.origin_step} days of history for 8-origin rolling evaluation; got {n}.", n,
            demand_class=demand_class, adi=adi, cv2=cv2,
        )

    chosen_model = eval_result.chosen_model
    mase_improvement = eval_result.mase_improvement
    chosen_blocks = eval_result.residual_blocks
    rng = np.random.default_rng(derive_seed(params.seed, sku_id, "bootstrap"))

    global_lgbm_mean: Optional[np.ndarray] = None
    naive_baseline_mean = naive_last(y, params.horizon)

    # Fit chosen model on the full historical series
    try:
        if chosen_model == "AutoETS":
            fc_mean, model_obj = fit_predict(AutoETS, y, params.horizon, params.season_length)
            model_spec = _model_spec(model_obj) or "AutoETS"
            paths = generate_paths(fc_mean, chosen_blocks, params.n_bootstrap, params.horizon, params.block_size, rng)
            p10, p50, p90 = np.percentile(paths, [10, 50, 90], axis=0)
        elif chosen_model == "SeasonalNaive":
            fc_mean, _ = fit_predict(SeasonalNaive, y, params.horizon, params.season_length)
            model_spec = "SeasonalNaive"
            paths = generate_paths(fc_mean, chosen_blocks, params.n_bootstrap, params.horizon, params.block_size, rng)
            p10, p50, p90 = np.percentile(paths, [10, 50, 90], axis=0)
        elif chosen_model == "Naive":
            fc_mean = naive_baseline_mean
            model_spec = "Naive"
            paths = generate_paths(fc_mean, chosen_blocks, params.n_bootstrap, params.horizon, params.block_size, rng)
            p10, p50, p90 = np.percentile(paths, [10, 50, 90], axis=0)
        elif chosen_model == "GlobalLGBM":
            # Native quantiles for GlobalLGBM
            lgbm_seed = int(derive_seed(params.seed, sku_id, "global_lgbm_fit") % 2_147_483_647)
            if panel_df is None:
                start_dt = pd.to_datetime(start_date) if start_date is not None else pd.Timestamp("2024-01-01")
                dates = pd.date_range(start=start_dt, periods=len(y), freq="D")
                panel = pd.DataFrame({"sku_id": sku_id, "date": dates, "y": y})
            else:
                panel = panel_df
            lgbm_res = fit_predict_global_quantile(panel, params.horizon, lgbm_seed)
            if sku_id in lgbm_res:
                p10 = lgbm_res[sku_id]["p10"]
                p50 = lgbm_res[sku_id]["p50"]
                p90 = lgbm_res[sku_id]["p90"]
                fc_mean = p50
            else:
                fc_mean, _ = fit_predict(SeasonalNaive, y, params.horizon, params.season_length)
                paths = generate_paths(fc_mean, chosen_blocks, params.n_bootstrap, params.horizon, params.block_size, rng)
                p10, p50, p90 = np.percentile(paths, [10, 50, 90], axis=0)
            global_lgbm_mean = fc_mean
            model_spec = "GlobalLGBM"
        else:  # CrostonSBA
            fc_mean, _ = fit_predict_croston(y, params.horizon)
            model_spec = "CrostonSBA"
            p10, p50, p90, _ = simulate_intermittent_intervals(sku_id, y, params.horizon, n_sim=500, history_days=90)
    except Exception as exc:
        log.warning("model fit failed for %s with chosen model %s: %s", sku_id, chosen_model, type(exc).__name__)
        return SkuFit(
            sku_id, "model_failed", "not_computed", f"Model fitting failed ({type(exc).__name__}).", n,
            demand_class=demand_class, adi=adi, cv2=cv2, chosen_model=chosen_model, mase_improvement=mase_improvement,
        )

    # Seasonal naive baseline for comparison
    try:
        sn_mean, _ = fit_predict(SeasonalNaive, y, params.horizon, params.season_length)
    except Exception:
        sn_mean = fc_mean

    fit = SkuFit(
        sku_id=sku_id,
        status="ok",
        interval_status="ok",
        message=None,
        n_observations=n,
        demand_class=demand_class,
        adi=adi,
        cv2=cv2,
        chosen_model=chosen_model,
        mase_improvement=mase_improvement,
        autoets_mean=fc_mean,
        seasonal_naive_mean=sn_mean,
        naive_mean=naive_baseline_mean,
        global_lgbm_mean=global_lgbm_mean,
        p10=p10,
        p50=p50,
        p90=p90,
        residual_blocks=chosen_blocks,
        residual_cutoffs=eval_result.residual_cutoffs,
        residual_std=float(np.std(chosen_blocks.ravel(), ddof=1)),
        n_failed_origins=eval_result.failed_origins,
        model_spec=model_spec,
        warnings=[
            f"Model chosen by lowest rolling MASE: {chosen_model} ({mase_improvement:+.1f}% vs SeasonalNaive).",
            f"Demand classified as {demand_class} (ADI={adi:.2f}, CV²={cv2:.2f}).",
        ],
    )
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
        demand_class=fit.demand_class,
        adi=fit.adi,
        cv2=fit.cv2,
        chosen_model=fit.chosen_model,
        mase_improvement=fit.mase_improvement,
        message=fit.message,
        n_observations=n_obs,
        forecast_start_date=(start_date + timedelta(days=n_obs)) if ok else None,
        autoets_mean=fit.autoets_mean.tolist() if ok and fit.autoets_mean is not None else None,
        seasonal_naive_mean=fit.seasonal_naive_mean.tolist() if ok and fit.seasonal_naive_mean is not None else None,
        naive_mean=fit.naive_mean.tolist() if ok and fit.naive_mean is not None else None,
        global_lgbm_mean=fit.global_lgbm_mean.tolist() if ok and fit.global_lgbm_mean is not None else None,
        intervals=intervals,
        residual_blocks=fit.residual_blocks.tolist() if intervals is not None and fit.residual_blocks is not None else None,
        residual_block_cutoffs=list(fit.residual_cutoffs) if intervals is not None and fit.residual_cutoffs is not None else None,
        residual_std=fit.residual_std if intervals is not None and fit.residual_blocks is not None else None,
        n_residual_blocks=int(fit.residual_blocks.shape[0]) if fit.residual_blocks is not None else len(fit.residual_cutoffs),
        n_failed_origins=fit.n_failed_origins,
        autoets_model_spec=fit.model_spec if ok else None,
        warnings=fit.warnings,
    )
