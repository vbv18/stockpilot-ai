import { RISK_THRESHOLDS } from "../config/constants.js";

export const RISK_FLAG_CODES = [
  "high_demand_uncertainty",
  "policy_divergence",
  "poor_forecast_accuracy",
  "interval_undercoverage",
  "normal_approximation_unsuitable",
  "deterministic_stockout_rate_above_tolerance",
  "uncertainty_aware_stockout_rate_above_tolerance",
];

export function computeSkuRisk(input) {
  const { opt, evaluation, simulation, targetServiceLevel } = input;
  const T = RISK_THRESHOLDS;
  const flags = [];

  if (opt.status === "ok" && opt.ltd && opt.ltd.mean > 0) {
    const cv = opt.ltd.std / opt.ltd.mean;
    if (cv >= T.ltdCvHigh) {
      flags.push({
        code: "high_demand_uncertainty",
        message: `Lead-time demand varies a lot (coefficient of variation ${cv.toFixed(2)} >= ${T.ltdCvHigh}).`,
        metricKeys: ["ltd.std", "ltd.mean"],
        values: { ltd_cv: cv, ltd_std: opt.ltd.std, ltd_mean: opt.ltd.mean },
      });
    }
  }
  if (
    opt.status === "ok" &&
    opt.rop_deterministic !== null &&
    opt.rop_gap !== null
  ) {
    const rel = Math.abs(opt.rop_gap) / Math.max(opt.rop_deterministic, 1);
    if (rel >= T.policyDivergence) {
      flags.push({
        code: "policy_divergence",
        message: `The two reorder points differ by ${(rel * 100).toFixed(0)}% (threshold ${(T.policyDivergence * 100).toFixed(0)}%).`,
        metricKeys: ["rop_deterministic", "rop_uncertainty_aware", "rop_gap"],
        values: {
          rop_deterministic: opt.rop_deterministic,
          rop_uncertainty_aware: opt.rop_uncertainty_aware,
          rop_gap: opt.rop_gap,
          relative_gap: rel,
        },
      });
    }
  }
  const wape = evaluation?.autoets?.wape ?? null;
  if (wape !== null && wape >= T.wapeHigh) {
    flags.push({
      code: "poor_forecast_accuracy",
      message: `Holdout forecast error is high (WAPE ${(wape * 100).toFixed(0)}% >= ${(T.wapeHigh * 100).toFixed(0)}%).`,
      metricKeys: ["autoets.wape"],
      values: { wape },
    });
  }
  const cov = evaluation?.interval_metrics?.coverage ?? null;
  if (cov !== null && cov < T.coverageLow) {
    flags.push({
      code: "interval_undercoverage",
      message: `The P10-P90 interval covered only ${(cov * 100).toFixed(0)}% of holdout days (nominal 80%, threshold ${(T.coverageLow * 100).toFixed(0)}%).`,
      metricKeys: ["interval_metrics.coverage"],
      values: { coverage: cov },
    });
  }
  if (opt.status === "ok" && opt.mu_l !== null && opt.ltd) {
    if (
      opt.mu_l < T.normalApproxMinMuL ||
      Math.abs(opt.ltd.skewness) > T.normalApproxMaxAbsSkew
    ) {
      flags.push({
        code: "normal_approximation_unsuitable",
        message:
          "Expected lead-time demand is small or skewed, so the normal-approximation reorder point may be unreliable.",
        metricKeys: ["mu_l", "ltd.skewness"],
        values: { mu_l: opt.mu_l, skewness: opt.ltd.skewness },
      });
    }
  }
  if (simulation) {
    const tol = 1 - targetServiceLevel;
    if (simulation.deterministic.stockout_rate_mean > tol) {
      flags.push({
        code: "deterministic_stockout_rate_above_tolerance",
        message: `Simulated stockout-day rate under the deterministic policy (${(simulation.deterministic.stockout_rate_mean * 100).toFixed(1)}%) exceeds the tolerance of ${(tol * 100).toFixed(1)}%.`,
        metricKeys: ["deterministic.stockout_rate_mean"],
        values: {
          stockout_rate: simulation.deterministic.stockout_rate_mean,
          tolerance: tol,
        },
      });
    }
    if (simulation.uncertainty_aware.stockout_rate_mean > tol) {
      flags.push({
        code: "uncertainty_aware_stockout_rate_above_tolerance",
        message: `Simulated stockout-day rate under the uncertainty-aware policy (${(simulation.uncertainty_aware.stockout_rate_mean * 100).toFixed(1)}%) exceeds the tolerance of ${(tol * 100).toFixed(1)}%.`,
        metricKeys: ["uncertainty_aware.stockout_rate_mean"],
        values: {
          stockout_rate: simulation.uncertainty_aware.stockout_rate_mean,
          tolerance: tol,
        },
      });
    }
  }
  const score = flags.length;
  return {
    skuId: opt.sku_id,
    flags,
    score,
    level: score === 0 ? "low" : score === 1 ? "medium" : "high",
  };
}

export function buildSessionRisk(optRun, simRun = null, assumptions = null) {
  if (!optRun || !optRun.result?.skus) return [];
  const targetServiceLevel = assumptions?.values?.targetServiceLevel ?? 0.95;
  const simSkus = simRun?.result?.skus || {};
  const risks = [];

  for (const [skuId, skuOpt] of Object.entries(optRun.result.skus)) {
    const skuSim = simSkus[skuId] || null;
    const r = computeSkuRisk({
      opt: skuOpt,
      evaluation: null,
      simulation: skuSim,
      targetServiceLevel,
    });
    risks.push({
      ...r,
      skuId,
      stockoutUnitsDeterministic:
        skuSim?.deterministic?.mean_stockout_units ?? null,
      stockoutUnitsUncertaintyAware:
        skuSim?.uncertainty_aware?.mean_stockout_units ?? null,
    });
  }
  return risks;
}
