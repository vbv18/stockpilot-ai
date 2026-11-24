from __future__ import annotations

import hashlib
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
    annual_holding_cost,
)
from .bootstrap import generate_paths
from .forecasting import fit_sku
from .inventory import optimize_sku
from .simulation import simulate_policy


def _sku_seed_sequence(global_seed: int, sku_id: str, stream: str | int = 0) -> np.random.SeedSequence:
    sku_hash = int.from_bytes(hashlib.blake2b(sku_id.encode("utf-8"), digest_size=8).digest(), "big")
    if isinstance(stream, str):
        stream_hash = int.from_bytes(hashlib.blake2b(stream.encode("utf-8"), digest_size=8).digest(), "big")
    else:
        stream_hash = int(stream)
    return np.random.SeedSequence([int(global_seed), sku_hash, stream_hash])


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

    # Hold out the last holdout_days of actual demand; fit and classify strictly on pre-cutoff data
    y_train = y[:-holdout_days]
    warmup_days = 30 if len(y) >= holdout_days + 30 + params.min_history else 0
    total_eval_window = holdout_days + warmup_days
    y_actual = y[-total_eval_window:]

    # Fit the forecast on earlier days only
    fc_seed = int(_sku_seed_sequence(params.seed, sku.sku_id, "replay_fc").generate_state(1)[0] % 2_147_483_647)
    fc_params = ForecastParams(
        horizon=holdout_days,
        season_length=params.season_length,
        n_bootstrap=params.n_bootstrap,
        block_size=params.block_size,
        min_history=params.min_history,
        origin_step=params.origin_step,
        min_residual_blocks=params.min_residual_blocks,
        seed=fc_seed,
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
    opt_seed = int(_sku_seed_sequence(params.seed, sku.sku_id, "replay_opt").generate_state(1)[0] % 2_147_483_647)
    opt_params = OptimizeParams(
        n_bootstrap=params.n_bootstrap,
        block_size=params.block_size,
        bootstrap_seed=opt_seed,
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
    demand = y_actual.reshape(1, -1)
    lead = max(1, int(round(a.lead_time_mean)))
    h_annual = annual_holding_cost(a)
    holding_daily = h_annual / 365.0
    order_cost = a.order_cost
    penalty = a.shortage_cost

    init_stock = getattr(a, "initial_stock", None)
    if init_stock is None:
        init_stock = getattr(sku, "initial_stock", None)
    start_det = float(init_stock) if init_stock is not None else float(rop_det + eoq)
    start_unc = float(init_stock) if init_stock is not None else float(rop_unc + eoq)
    start_qua = float(init_stock) if init_stock is not None else float(rop_qua + eoq)

    # Deterministic policy
    det_res = simulate_policy(
        demand,
        rop=float(rop_det),
        q=eoq,
        lead=lead,
        start_inv=start_det,
        holding_daily=holding_daily,
        order_cost=order_cost,
        penalty=penalty,
        lead_times=None,
        warmup_days=warmup_days,
    )

    # Uncertainty-aware policy
    unc_res = simulate_policy(
        demand,
        rop=float(rop_unc),
        q=eoq,
        lead=lead,
        start_inv=start_unc,
        holding_daily=holding_daily,
        order_cost=order_cost,
        penalty=penalty,
        lead_times=None,
        warmup_days=warmup_days,
    )

    # Quantile policy
    qua_res = simulate_policy(
        demand,
        rop=float(rop_qua),
        q=eoq,
        lead=lead,
        start_inv=start_qua,
        holding_daily=holding_daily,
        order_cost=order_cost,
        penalty=penalty,
        lead_times=None,
        warmup_days=warmup_days,
    )

    # Fresh-path LTD calibration
    cal_rng = np.random.default_rng(_sku_seed_sequence(params.seed, sku.sku_id, "replay_ltd_cal"))
    cal_paths = generate_paths(fit.autoets_mean, fit.residual_blocks, params.n_bootstrap, lead, params.block_size, cal_rng)
    ltd_fresh = cal_paths.sum(axis=1)
    cal_det = float(np.mean(ltd_fresh <= rop_det))
    cal_unc = float(np.mean(ltd_fresh <= rop_unc))
    cal_qua = float(np.mean(ltd_fresh <= rop_qua))

    m_det = ReplayPolicyMetrics(
        fill_rate=float(det_res["fill_rate"][0]),
        csl=float(det_res["csl"][0]),
        CSL=float(det_res["csl"][0]),
        stockout_day_rate=float(det_res["stockout_day_rate"][0]),
        total_cost=float(det_res["total_cost"][0]),
        stockout_days=int(det_res["stockout_days"][0]),
        ltd_calibration=cal_det,
    )
    m_unc = ReplayPolicyMetrics(
        fill_rate=float(unc_res["fill_rate"][0]),
        csl=float(unc_res["csl"][0]),
        CSL=float(unc_res["csl"][0]),
        stockout_day_rate=float(unc_res["stockout_day_rate"][0]),
        total_cost=float(unc_res["total_cost"][0]),
        stockout_days=int(unc_res["stockout_days"][0]),
        ltd_calibration=cal_unc,
    )
    m_qua = ReplayPolicyMetrics(
        fill_rate=float(qua_res["fill_rate"][0]),
        csl=float(qua_res["csl"][0]),
        CSL=float(qua_res["csl"][0]),
        stockout_day_rate=float(qua_res["stockout_day_rate"][0]),
        total_cost=float(qua_res["total_cost"][0]),
        stockout_days=int(qua_res["stockout_days"][0]),
        ltd_calibration=cal_qua,
    )

    return SkuReplay(
        sku_id=sku.sku_id,
        status="ok",
        deterministic=m_det,
        uncertainty_aware=m_unc,
        quantile=m_qua,
        det=m_det,
        unc=m_unc,
        s_det=m_det,
        s_quant=m_qua,
        s_emp=m_unc,
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
        csl_vals = [m.csl for m in items if m.csl is not None]
        csl_mean = float(np.mean(csl_vals)) if csl_vals else 1.0
        stk_rates = [m.stockout_day_rate for m in items if m.stockout_day_rate is not None]
        stk_rate_mean = float(np.mean(stk_rates)) if stk_rates else 0.0
        ltd_cal_vals = [m.ltd_calibration for m in items if m.ltd_calibration is not None]
        ltd_cal_mean = float(np.mean(ltd_cal_vals)) if ltd_cal_vals else None
        return ReplayPolicyMetrics(
            fill_rate=float(np.mean([m.fill_rate for m in items])),
            csl=csl_mean,
            CSL=csl_mean,
            stockout_day_rate=stk_rate_mean,
            total_cost=float(sum(m.total_cost for m in items)),
            stockout_days=int(sum(m.stockout_days for m in items)),
            ltd_calibration=ltd_cal_mean,
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
        s_det=det_agg,
        s_quant=qua_agg,
        s_emp=unc_agg,
    )
