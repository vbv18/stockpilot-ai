from __future__ import annotations

import numpy as np

from ..schemas import (
    ForecastParams,
    OptimizeParams,
    OptimizeSkuInput,
    ReplayAggregate,
    ReplayParams,
    ReplayPolicyMetrics,
    SkuAssumptions,
    SkuReplay,
    SkuSeries,
)
from .forecasting import fit_sku
from .inventory import optimize_sku
from .seeds import derive_seed
from .simulation import simulate_policy


def replay_sku(sku: SkuSeries, params: ReplayParams, a: SkuAssumptions) -> SkuReplay:
    y = np.asarray(sku.values, dtype=float)
    holdout_days = params.holdout_days

    # We need enough history for holdout + training
    if len(y) < holdout_days + params.min_history:
        return SkuReplay(
            sku_id=sku.sku_id,
            status="insufficient_history",
            message=f"Series length {len(y)} is less than required {holdout_days + params.min_history} days.",
        )

    # Hold out the last 28 days of actual demand
    y_train = y[:-holdout_days]
    y_actual = y[-holdout_days:]

    # Fit the forecast on earlier days only
    fc_params = ForecastParams(
        horizon=holdout_days,
        season_length=params.season_length,
        n_bootstrap=params.n_bootstrap,
        block_size=params.block_size,
        min_history=params.min_history,
        origin_step=params.origin_step,
        min_residual_blocks=params.min_residual_blocks,
        seed=int(derive_seed(params.seed, sku.sku_id, "replay_fc") % 2_147_483_647),
    )
    fit = fit_sku(sku.sku_id, y_train, fc_params)
    if fit.status != "ok" or fit.autoets_mean is None or fit.residual_blocks is None:
        return SkuReplay(
            sku_id=sku.sku_id,
            status=fit.status if fit.status != "ok" else "ineligible",
            message=fit.message or "Could not extract forecast and residual blocks on earlier days.",
        )

    # Set EOQ and each policy on earlier days only
    residual_std = (
        fit.residual_std
        if fit.residual_std is not None
        else float(np.std(fit.residual_blocks.ravel(), ddof=1))
    )
    opt_input = OptimizeSkuInput(
        sku_id=sku.sku_id,
        forecast_mean=fit.autoets_mean.tolist(),
        residual_blocks=fit.residual_blocks.tolist(),
        residual_std=residual_std,
    )
    opt_params = OptimizeParams(
        n_bootstrap=params.n_bootstrap,
        block_size=params.block_size,
        bootstrap_seed=int(derive_seed(params.seed, sku.sku_id, "replay_opt") % 2_147_483_647),
    )
    opt = optimize_sku(opt_input, opt_params, a)
    if (
        opt.status != "ok"
        or opt.eoq is None
        or opt.rop_deterministic is None
        or opt.rop_uncertainty_aware is None
    ):
        return SkuReplay(
            sku_id=sku.sku_id,
            status="ineligible",
            message=opt.warnings[0] if opt.warnings else "Policy optimization ineligible on earlier days.",
        )

    eoq = opt.eoq
    rop_det = opt.rop_deterministic
    rop_unc = opt.rop_uncertainty_aware
    rop_qua = opt.rop_quantile if opt.rop_quantile is not None else rop_unc

    # Simulate each policy once on the ACTUAL held-out demand
    # using each SKU's lead_time_mean (rounded) and starting inventory = its ROP
    demand = y_actual.reshape(1, -1)
    lead = max(1, int(round(a.lead_time_mean)))
    holding_daily = a.holding_cost_annual / 365.0
    order_cost = a.ordering_cost
    penalty = a.shortage_penalty

    # Deterministic policy
    det_res = simulate_policy(
        demand,
        rop=float(rop_det),
        q=eoq,
        lead=lead,
        start_inv=float(rop_det),
        holding_daily=holding_daily,
        order_cost=order_cost,
        penalty=penalty,
        lead_times=None,
    )
    m_det = ReplayPolicyMetrics(
        fill_rate=float(det_res["service_level"][0]),
        total_cost=float(det_res["total_cost"][0]),
        stockout_days=int(det_res["stockout_days"][0]),
    )

    # Uncertainty-aware policy
    unc_res = simulate_policy(
        demand,
        rop=float(rop_unc),
        q=eoq,
        lead=lead,
        start_inv=float(rop_unc),
        holding_daily=holding_daily,
        order_cost=order_cost,
        penalty=penalty,
        lead_times=None,
    )
    m_unc = ReplayPolicyMetrics(
        fill_rate=float(unc_res["service_level"][0]),
        total_cost=float(unc_res["total_cost"][0]),
        stockout_days=int(unc_res["stockout_days"][0]),
    )

    # Quantile policy
    qua_res = simulate_policy(
        demand,
        rop=float(rop_qua),
        q=eoq,
        lead=lead,
        start_inv=float(rop_qua),
        holding_daily=holding_daily,
        order_cost=order_cost,
        penalty=penalty,
        lead_times=None,
    )
    m_qua = ReplayPolicyMetrics(
        fill_rate=float(qua_res["service_level"][0]),
        total_cost=float(qua_res["total_cost"][0]),
        stockout_days=int(qua_res["stockout_days"][0]),
    )

    return SkuReplay(
        sku_id=sku.sku_id,
        status="ok",
        deterministic=m_det,
        uncertainty_aware=m_unc,
        quantile=m_qua,
        det=m_det,
        unc=m_unc,
        message=None,
    )


def aggregate_replay(results: list[SkuReplay]) -> ReplayAggregate | None:
    ok_skus = [r for r in results if r.status == "ok"]
    if not ok_skus:
        return None

    def _agg(policy_name: str) -> ReplayPolicyMetrics | None:
        items = [getattr(r, policy_name) for r in ok_skus if getattr(r, policy_name) is not None]
        if not items:
            return None
        return ReplayPolicyMetrics(
            fill_rate=float(np.mean([m.fill_rate for m in items])),
            total_cost=float(sum(m.total_cost for m in items)),
            stockout_days=int(sum(m.stockout_days for m in items)),
        )

    det_agg = _agg("deterministic")
    unc_agg = _agg("uncertainty_aware")
    qua_agg = _agg("quantile")

    return ReplayAggregate(
        deterministic=det_agg,
        uncertainty_aware=unc_agg,
        quantile=qua_agg,
        det=det_agg,
        unc=unc_agg,
    )
