from __future__ import annotations

import logging
import zlib
from typing import Any

import numpy as np
from statsforecast.models import CrostonSBA, SeasonalNaive

from ..schemas import ForecastParams
from .bootstrap import block_cutoffs

log = logging.getLogger("stats.intermittent")


def fit_predict_croston(y: np.ndarray, h: int) -> tuple[np.ndarray, Any]:
    """Fits CrostonSBA and returns h-step point forecasts."""
    model = CrostonSBA()
    model.fit(y=np.ascontiguousarray(y, dtype=np.float64))
    out = model.predict(h=h)
    mean = np.asarray(out["mean"], dtype=float)
    if mean.shape != (h,) or not np.all(np.isfinite(mean)):
        raise ValueError("CrostonSBA returned a non-finite or wrongly shaped forecast")
    return np.clip(mean, 0.0, None), model


def simulate_intermittent_intervals(
    sku_id: str,
    y: np.ndarray,
    horizon: int,
    n_sim: int = 500,
    history_days: int = 90,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Estimates p = P(demand > 0) and non-zero demand sizes from the last 90 days.
    Simulates 500 paths over the horizon as Bernoulli(p) * resampled non-zero size.
    Seeds deterministically per SKU with zlib.crc32(sku_id), never Python hash().
    Returns (p10, p50, p90, paths).
    """
    seed = zlib.crc32(sku_id.encode("utf-8"))
    rng = np.random.default_rng(seed)

    y_arr = np.asarray(y, dtype=float)
    window = y_arr[-history_days:] if len(y_arr) >= history_days else y_arr
    nonzero = window[window > 0]

    if len(nonzero) == 0:
        # Fall back to entire series if no positive demand in the last 90 days
        nonzero = y_arr[y_arr > 0]
        p = float(len(nonzero) / len(y_arr)) if len(y_arr) > 0 else 0.0
    else:
        p = float(len(nonzero) / len(window))

    if len(nonzero) == 0:
        # If the entire series has no positive demand
        paths = np.zeros((n_sim, horizon), dtype=float)
    else:
        bernoulli_mask = rng.random(size=(n_sim, horizon)) < p
        sampled_sizes = rng.choice(nonzero, size=(n_sim, horizon), replace=True)
        paths = bernoulli_mask * sampled_sizes

    p10, p50, p90 = np.percentile(paths, [10, 50, 90], axis=0)
    return p10, p50, p90, paths


def collect_residual_blocks_croston(y: np.ndarray, params: ForecastParams):
    """Collects rolling-origin residual blocks using CrostonSBA."""
    cutoffs = block_cutoffs(len(y), params.min_history, params.block_size, params.origin_step)
    blocks: list[np.ndarray] = []
    used: list[int] = []
    failed = 0
    for c in cutoffs:
        try:
            forecast, _ = fit_predict_croston(y[:c], params.block_size)
            resid = y[c : c + params.block_size] - forecast
            if resid.shape[0] != params.block_size or not np.all(np.isfinite(resid)):
                raise ValueError("invalid residual block")
            blocks.append(resid)
            used.append(c)
        except Exception as exc:
            failed += 1
            log.warning("rolling-origin croston fit failed at cutoff=%s: %s", c, type(exc).__name__)
    return blocks, used, failed
