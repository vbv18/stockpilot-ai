from __future__ import annotations

import hashlib
import math
from statistics import NormalDist

import numpy as np
from scipy.stats import truncnorm

from ..schemas import (
    LeadTimeDemandStats,
    OptimizeParams,
    OptimizeSkuInput,
    SkuAssumptions,
    SkuOptimization,
    annual_holding_cost,
)
from .bootstrap import generate_paths

DAYS_PER_YEAR = 365
NORMAL_APPROX_MIN_MU_L = 10.0
NORMAL_APPROX_MAX_ABS_SKEW = 1.0


def _sku_seed_sequence(global_seed: int, sku_id: str, stream: str | int = 0) -> np.random.SeedSequence:
    sku_hash = int.from_bytes(hashlib.blake2b(sku_id.encode("utf-8"), digest_size=8).digest(), "big")
    if isinstance(stream, str):
        stream_hash = int.from_bytes(hashlib.blake2b(stream.encode("utf-8"), digest_size=8).digest(), "big")
    else:
        stream_hash = int(stream)
    return np.random.SeedSequence([int(global_seed), sku_hash, stream_hash])


def _ceil(x: float) -> int:
    return int(math.ceil(x - 1e-9))


def _skewness(x: np.ndarray) -> float:
    s = float(x.std())
    if s == 0.0:
        return 0.0
    m = float(x.mean())
    return float(np.mean(((x - m) / s) ** 3))


def sample_lead_times(
    mean: float, std: float, size: int | tuple[int, ...], rng: np.random.Generator
) -> np.ndarray:
    if std > 0:
        a_std = (1.0 - mean) / std
        vals = truncnorm.rvs(a_std, np.inf, loc=mean, scale=std, size=size, random_state=rng)
        return np.maximum(1, np.rint(vals).astype(int))
    return np.full(size, max(1, int(round(mean))), dtype=int)


def optimize_sku(sku: OptimizeSkuInput, p: OptimizeParams, a: SkuAssumptions) -> SkuOptimization:
    lead = max(1, int(round(a.lead_time_mean)))
    mean = np.asarray(sku.forecast_mean, dtype=float)

    if mean.shape[0] < lead:
        return SkuOptimization(
            sku_id=sku.sku_id, status="ineligible", ineligible_reason="forecast_shorter_than_lead_time",
            warnings=[f"Forecast covers {mean.shape[0]} days, shorter than the {lead}-day lead time."],
        )

    avg_daily = float(mean.mean())
    annual = avg_daily * DAYS_PER_YEAR
    if annual <= 0.0:
        return SkuOptimization(
            sku_id=sku.sku_id, status="ineligible", ineligible_reason="no_forecast_demand",
            avg_daily_forecast=avg_daily, annual_demand=annual,
            warnings=["Forecast demand is zero; no replenishment policy was computed."],
        )

    h_annual = annual_holding_cost(a)
    order_cost = a.effective_ordering_cost
    eoq_raw = math.sqrt(2.0 * annual * order_cost / h_annual)
    eoq = max(1, _ceil(eoq_raw))
    moq = a.moq or 1
    pack_size = a.pack_size or 1
    eoq = max(eoq, moq)
    if pack_size > 1:
        eoq = int(math.ceil(eoq / pack_size)) * pack_size

    blocks = np.asarray(sku.residual_blocks, dtype=float)
    mu_l = float(mean[:lead].sum())
    sigma_d = (
        float(sku.residual_std)
        if getattr(sku, "residual_std", None) is not None
        else float(np.std(blocks.ravel(), ddof=1))
    )
    sigma_sq = lead * (sigma_d ** 2) + (avg_daily ** 2) * (a.lead_time_std ** 2)
    sigma_l = math.sqrt(max(0.0, sigma_sq))
    service_level = a.effective_service_level
    z = NormalDist().inv_cdf(service_level)
    ss_det = z * sigma_l
    rop_det_raw = mu_l + ss_det
    rop_det = max(0, _ceil(rop_det_raw))

    warnings: list[str] = []
    rng = np.random.default_rng(_sku_seed_sequence(p.bootstrap_seed, sku.sku_id, "optimize_bootstrap"))
    paths = generate_paths(mean, blocks, p.n_bootstrap, mean.shape[0], p.block_size, rng)
    lead_times = sample_lead_times(a.lead_time_mean, a.lead_time_std, p.n_bootstrap, rng)
    path_len = paths.shape[1]
    if np.any(lead_times > path_len):
        lead_times = np.clip(lead_times, 1, path_len)
        warnings.append(f"Sampled lead time exceeded forecast horizon ({path_len} days); capped at horizon.")

    cum_paths = np.cumsum(paths, axis=1)
    d_l = cum_paths[np.arange(p.n_bootstrap), lead_times - 1]
    q10, q50, q90 = np.percentile(d_l, [10, 50, 90])
    ltd = LeadTimeDemandStats(
        mean=float(d_l.mean()), std=float(d_l.std(ddof=1)),
        p10=float(q10), p50=float(q50), p90=float(q90), skewness=_skewness(d_l),
    )
    rop_emp_raw = float(np.quantile(d_l, service_level, method="higher"))
    rop_emp = max(0, _ceil(rop_emp_raw))
    ss_emp = rop_emp_raw - ltd.mean

    # Quantile policy (s_quant):
    # sigma_d_quant = mean over horizon of (P90 - P10)/(2*1.2816).
    # Note: The (P90 - P10)/(2*1.2816) rule understates the tails of zero-inflated demand.
    # sigma_LTD_q = sqrt(L * sigma_dq^2 + mu_d^2 * sigma_L^2)
    if getattr(sku, "intervals", None) is not None and sku.intervals.p10 and sku.intervals.p90:
        p10_h = np.asarray(sku.intervals.p10, dtype=float)
        p90_h = np.asarray(sku.intervals.p90, dtype=float)
        p50_h = np.asarray(sku.intervals.p50, dtype=float) if sku.intervals.p50 else mean
    else:
        p10_h = np.percentile(paths, 10, axis=0)
        p90_h = np.percentile(paths, 90, axis=0)
        p50_h = np.percentile(paths, 50, axis=0)

    sigma_d_quant = float(np.mean((p90_h - p10_h) / (2.0 * 1.2816)))
    l_mean = float(a.lead_time_mean)
    l_std = float(a.lead_time_std)
    d_p50 = float(np.mean(p50_h))
    sigma_ltd_q = math.sqrt(max(0.0, l_mean * (sigma_d_quant ** 2) + (d_p50 ** 2) * (l_std ** 2)))
    ss_quant = z * sigma_ltd_q
    s_quant_raw = d_p50 * l_mean + ss_quant
    s_quant = max(0, _ceil(s_quant_raw))

    if mu_l < NORMAL_APPROX_MIN_MU_L:
        warnings.append(f"Expected lead-time demand ({mu_l:.1f} units) is small; the normal approximation behind the deterministic reorder point may be unsuitable.")
    if abs(ltd.skewness) > NORMAL_APPROX_MAX_ABS_SKEW:
        warnings.append(f"Lead-time demand is skewed (skewness {ltd.skewness:.2f}); the normal approximation may misstate required safety stock.")

    return SkuOptimization(
        sku_id=sku.sku_id, status="ok", ineligible_reason=None,
        avg_daily_forecast=avg_daily, annual_demand=annual, holding_cost_annual=h_annual,
        eoq_raw=eoq_raw, eoq=eoq,
        mu_l=mu_l, sigma_daily_error=sigma_d, sigma_l=sigma_l, z_score=z,
        safety_stock_deterministic=ss_det, rop_deterministic_raw=rop_det_raw, rop_deterministic=rop_det,
        rop_quantile_raw=s_quant_raw, rop_quantile=s_quant, safety_stock_quantile=ss_quant,
        s_det=rop_det, s_quant=s_quant, s_emp=rop_emp,
        ltd=ltd, rop_uncertainty_aware_raw=rop_emp_raw, rop_uncertainty_aware=rop_emp,
        safety_stock_uncertainty_aware=ss_emp, rop_gap=rop_emp - rop_det,
        warnings=warnings,
    )
