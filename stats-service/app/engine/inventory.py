from __future__ import annotations

import math
from statistics import NormalDist

import numpy as np
from scipy.stats import truncnorm

from ..schemas import LeadTimeDemandStats, OptimizeParams, OptimizeSkuInput, SkuAssumptions, SkuOptimization
from .bootstrap import generate_paths
from .seeds import derive_seed

DAYS_PER_YEAR = 365
NORMAL_APPROX_MIN_MU_L = 10.0
NORMAL_APPROX_MAX_ABS_SKEW = 1.0


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
    lead = a.lead_time_mean
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

    h_annual = a.holding_cost_annual
    eoq_raw = math.sqrt(2.0 * annual * a.ordering_cost / h_annual)
    eoq = max(1, _ceil(eoq_raw))

    mu_l = float(mean[:lead].sum())
    sigma_d = float(sku.residual_std)
    sigma_sq = lead * (sigma_d ** 2) + (avg_daily ** 2) * (a.lead_time_std ** 2)
    sigma_l = math.sqrt(max(0.0, sigma_sq))
    z = NormalDist().inv_cdf(a.service_level)
    ss_det = z * sigma_l
    rop_det_raw = mu_l + ss_det
    rop_det = max(0, _ceil(rop_det_raw))

    blocks = np.asarray(sku.residual_blocks, dtype=float)
    rng = np.random.default_rng(derive_seed(p.bootstrap_seed, sku.sku_id, "bootstrap"))
    paths = generate_paths(mean, blocks, p.n_bootstrap, mean.shape[0], p.block_size, rng)
    lead_times = sample_lead_times(a.lead_time_mean, a.lead_time_std, p.n_bootstrap, rng)
    max_l = int(lead_times.max())
    if max_l > paths.shape[1]:
        extra = generate_paths(mean, blocks, p.n_bootstrap, max_l - paths.shape[1], p.block_size, rng)
        paths = np.concatenate([paths, extra], axis=1)

    cum_paths = np.cumsum(paths, axis=1)
    d_l = cum_paths[np.arange(p.n_bootstrap), lead_times - 1]
    q10, q50, q90 = np.percentile(d_l, [10, 50, 90])
    ltd = LeadTimeDemandStats(
        mean=float(d_l.mean()), std=float(d_l.std(ddof=1)),
        p10=float(q10), p50=float(q50), p90=float(q90), skewness=_skewness(d_l),
    )
    rop_emp_raw = float(np.quantile(d_l, a.service_level, method="higher"))
    rop_emp = max(0, _ceil(rop_emp_raw))
    ss_emp = rop_emp_raw - ltd.mean

    sigma_est = (ltd.p90 - ltd.p10) / 2.563
    ss_quantile = z * sigma_est
    rop_quantile_raw = ltd.mean + ss_quantile
    rop_quantile = max(0, _ceil(rop_quantile_raw))

    warnings: list[str] = []
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
        rop_quantile_raw=rop_quantile_raw, rop_quantile=rop_quantile, safety_stock_quantile=ss_quantile,
        ltd=ltd, rop_uncertainty_aware_raw=rop_emp_raw, rop_uncertainty_aware=rop_emp,
        safety_stock_uncertainty_aware=ss_emp, rop_gap=rop_emp - rop_det,
        warnings=warnings,
    )
