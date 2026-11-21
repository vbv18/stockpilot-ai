import { buildSessionRisk } from "../risk.js";

export const ARTIFACT_TYPES = [
  "session_overview",
  "dataset_summary",
  "forecast_aggregate",
  "forecast_sku",
  "evaluation_sku",
  "assumption_set",
  "optimization_sku",
  "optimization_aggregate",
  "simulation_sku",
  "simulation_aggregate",
];

const n = (x, d = 2) =>
  x !== null && x !== undefined && !Number.isNaN(Number(x))
    ? Number(x).toFixed(d)
    : "n/a";

/**
 * Builds pure artifact docs from a loaded session bundle
 *
 * @param {import('../ai/sessionBundle.js').SessionBundle} bundle
 * @returns {Array<{ artifactType: string, artifactId: string, skuId: string|null, text: string }>}
 */
export function buildArtifactDocs(bundle) {
  const {
    session,
    dataset,
    forecastRun,
    assumptions,
    optimizationRun,
    simulationRun,
    history,
  } = bundle;
  const docs = [];

  const sessionId = session._id.toString();

  // 1. session_overview
  let overviewParts = [
    `Session overview for "${session.name}" (session ${sessionId}). Status: ${session.status}.`,
  ];
  if (dataset && dataset.summary) {
    const k = dataset.summary.skuCount ?? "n/a";
    const min = dataset.summary.dateRange?.min ?? "n/a";
    const max = dataset.summary.dateRange?.max ?? "n/a";
    overviewParts.push(`Dataset: ${k} SKUs, daily data from ${min} to ${max}.`);
  }
  if (forecastRun) {
    const nEligible = forecastRun.result?.eligible_sku_ids?.length ?? "n/a";
    const k = dataset?.summary?.skuCount ?? nEligible;
    overviewParts.push(
      `Forecast run ${forecastRun._id}: AutoETS with Seasonal Naive baseline, 28-day horizon, ${nEligible} of ${k} SKUs eligible for prediction intervals.`,
    );
  }
  if (assumptions) {
    const a = assumptions.values || {};
    const v = assumptions.version ?? 1;
    overviewParts.push(
      `Assumptions version ${v}: ordering cost ${n(a.orderingCost)} INR per order, holding cost ${n(a.holdingCost)} INR ${a.holdingCostUnit || "per_unit_per_day"}, shortage penalty ${n(a.shortagePenalty)} INR per unit, lead time ${a.leadTimeDays ?? "n/a"} days, target service level ${n((a.targetServiceLevel ?? 0) * 100, 1)}%.`,
    );
  }
  if (optimizationRun) {
    const nOk = optimizationRun.result?.skus
      ? Object.keys(optimizationRun.result.skus).length
      : 0;
    overviewParts.push(
      `Optimization run ${optimizationRun._id} produced policies for ${nOk} SKUs.`,
    );
  }
  if (simulationRun) {
    const sc = simulationRun.scenarioCount ?? "n/a";
    const hz = simulationRun.horizonDays ?? "n/a";
    const sd = simulationRun.seed ?? "n/a";
    overviewParts.push(
      `Simulation run ${simulationRun._id}: ${sc} scenarios over ${hz} days, seed ${sd}.`,
    );
  }
  docs.push({
    artifactType: "session_overview",
    artifactId: sessionId,
    skuId: null,
    text: overviewParts.join(" ").slice(0, 1500),
  });

  // 2. dataset_summary
  if (dataset && dataset.validationSummary) {
    const val = dataset.validationSummary;
    const accepted = val.acceptedRows ?? "n/a";
    const total = val.totalRows ?? "n/a";
    const rejected = val.rejectedRows ?? "n/a";
    const dups = val.duplicateRowsSummed ?? 0;
    const dropNeg = val.droppedNegativeRows ?? 0;
    const min = val.dateRange?.min ?? "n/a";
    const max = val.dateRange?.max ?? "n/a";
    const missing = val.missingDaysFilled ?? 0;
    const skusList = (val.skuIds || []).slice(0, 50).join(", ");

    docs.push({
      artifactType: "dataset_summary",
      artifactId: dataset._id.toString(),
      skuId: null,
      text: `Dataset summary: ${accepted} accepted rows of ${total}; ${rejected} rejected; ${dups} duplicate SKU/date records summed; ${dropNeg} negative-quantity rows excluded (treated as returns, not demand); date range ${min} to ${max}; ${missing} calendar days with no records for any SKU (treated as zero demand under the confirmed coverage assumption). SKU ids used: ${skusList}.`.slice(
        0,
        1500,
      ),
    });
  }

  // Helper map for history observations
  const historyBySku = new Map();
  if (history && Array.isArray(history)) {
    for (const item of history) {
      historyBySku.set(item.skuId, item.series || []);
    }
  }

  // 3. forecast_aggregate
  if (forecastRun && forecastRun.result?.evaluation?.aggregate) {
    const agg = forecastRun.result.evaluation.aggregate;
    const a = agg.autoets || {};
    const sn = agg.seasonal_naive || {};
    const im = agg.interval_metrics || {};
    const nSkus = forecastRun.result.skus
      ? Object.keys(forecastRun.result.skus).length
      : 0;

    docs.push({
      artifactType: "forecast_aggregate",
      artifactId: forecastRun._id.toString(),
      skuId: null,
      text: `Forecast evaluation aggregate (last 28 days holdout): AutoETS mean MAE ${n(a.mae)}, mean RMSE ${n(a.rmse)}, pooled WAPE ${n((a.wape ?? 0) * 100, 1)}%; Seasonal Naive mean MAE ${n(sn.mae)}, mean RMSE ${n(sn.rmse)}, pooled WAPE ${n((sn.wape ?? 0) * 100, 1)}%. P10-P90 interval coverage averages ${n((im.coverage_p10_p90 ?? 0) * 100, 1)}% (nominal 80%) with mean width ${n(im.mean_width)} units across ${nSkus} SKUs.`.slice(
        0,
        1500,
      ),
    });
  }

  // 4. forecast_sku & 5. evaluation_sku
  if (forecastRun && forecastRun.result?.skus) {
    const forecastRunId = forecastRun._id.toString();
    const skusMap = forecastRun.result.skus;
    const evalMap = forecastRun.result.evaluation?.skus || {};

    for (const [skuId, skuData] of Object.entries(skusMap)) {
      if (skuData.status !== "ok") {
        docs.push({
          artifactType: "forecast_sku",
          artifactId: forecastRunId,
          skuId,
          text: `SKU ${skuId}: status ${skuData.status}, interval status ${skuData.interval_status}, ${skuData.n_observations ?? 0} observations. ${skuData.message || ""}`.slice(
            0,
            1500,
          ),
        });
      } else {
        const meanArr = skuData.autoets_mean || [];
        const avg =
          meanArr.length > 0
            ? meanArr.reduce((a, b) => a + b, 0) / meanArr.length
            : 0;
        const total = meanArr.reduce((a, b) => a + b, 0);
        const p10Arr = skuData.p10 || [];
        const p90Arr = skuData.p90 || [];
        const p10avg =
          p10Arr.length > 0
            ? p10Arr.reduce((a, b) => a + b, 0) / p10Arr.length
            : 0;
        const p90avg =
          p90Arr.length > 0
            ? p90Arr.reduce((a, b) => a + b, 0) / p90Arr.length
            : 0;

        const rs = n(skuData.residual_std);
        const blocks = skuData.residual_blocks
          ? skuData.residual_blocks.length
          : 0;

        // History calculations for last 28, prior 28, zero days
        const sHistory = historyBySku.get(skuId) || [];
        let r28 = "n/a";
        let p28 = "n/a";
        let z = "n/a";
        if (sHistory.length >= 28) {
          const l28 = sHistory.slice(-28).map((pt) => pt.quantity);
          r28 = n(l28.reduce((a, b) => a + b, 0) / 28);
        }
        if (sHistory.length >= 56) {
          const pr28 = sHistory.slice(-56, -28).map((pt) => pt.quantity);
          p28 = n(pr28.reduce((a, b) => a + b, 0) / 28);
          const last56 = sHistory.slice(-56).map((pt) => pt.quantity);
          z = last56.filter((q) => q === 0).length;
        }

        const warningsStr =
          skuData.warnings && skuData.warnings.length > 0
            ? skuData.warnings.join("; ")
            : "none";

        docs.push({
          artifactType: "forecast_sku",
          artifactId: forecastRunId,
          skuId,
          text: `SKU ${skuId}: status ${skuData.status}, interval status ${skuData.interval_status}, ${skuData.n_observations} observations. AutoETS model ${skuData.model_spec || "AutoETS"}. Next 28 days from ${forecastRun.result.forecast_start_date || "start"}: forecast averages ${n(avg)} units/day (total ${n(total)}); P10-P90 band averages ${n(p10avg)} to ${n(p90avg)} units/day. Residual standard deviation ${rs} from ${blocks} residual blocks. Recent demand: last 28 days averaged ${r28} units/day versus ${p28} in the prior 28 days; zero-demand days in the last 56 days: ${z}. Warnings: ${warningsStr}.`.slice(
            0,
            1500,
          ),
        });
      }

      // evaluation_sku
      const evalData = evalMap[skuId];
      if (evalData) {
        const ae = evalData.autoets || {};
        const sn = evalData.seasonal_naive || {};
        const im = evalData.interval_metrics || {};
        const wapeAe =
          ae.wape !== null && ae.wape !== undefined
            ? `${n(ae.wape * 100, 1)}%`
            : "WAPE n/a (zero actual demand)";
        const wapeSn =
          sn.wape !== null && sn.wape !== undefined
            ? `${n(sn.wape * 100, 1)}%`
            : "WAPE n/a (zero actual demand)";
        const cov =
          im.coverage_p10_p90 !== null && im.coverage_p10_p90 !== undefined
            ? `${n(im.coverage_p10_p90 * 100, 1)}%`
            : "n/a";
        const width = n(im.mean_width);

        docs.push({
          artifactType: "evaluation_sku",
          artifactId: forecastRunId,
          skuId,
          text: `Holdout evaluation for SKU ${skuId} (last 28 days): AutoETS MAE ${n(ae.mae)}, RMSE ${n(ae.rmse)}, ${wapeAe} ; Seasonal Naive MAE ${n(sn.mae)}, RMSE ${n(sn.rmse)}, ${wapeSn}; P10-P90 coverage ${cov} (nominal 80%), mean width ${width} units.`.slice(
            0,
            1500,
          ),
        });
      }
    }
  }

  // 6. assumption_set
  if (assumptions) {
    const a = assumptions.values || {};
    const prov = assumptions.provenance || {};
    const provParts = [];
    if (prov.orderingCost)
      provParts.push(`ordering cost: ${prov.orderingCost}`);
    if (prov.holdingCost) provParts.push(`holding cost: ${prov.holdingCost}`);
    const provSummary =
      provParts.length > 0 ? provParts.join("; ") : "user provided";

    const S = n(a.orderingCost);
    const H = n(a.holdingCost);
    const unit = a.holdingCostUnit || "per_unit_per_day";
    const Hday =
      unit === "per_unit_per_year"
        ? n(a.holdingCost / 365, 4)
        : n(a.holdingCost);
    const P = n(a.shortagePenalty);
    const L = a.leadTimeDays ?? "n/a";
    const SL = n((a.targetServiceLevel ?? 0) * 100, 1);

    docs.push({
      artifactType: "assumption_set",
      artifactId: assumptions._id.toString(),
      skuId: null,
      text: `Assumptions version ${assumptions.version ?? 1} (${provSummary}): ordering cost ${S} INR per order; holding cost ${H} INR ${unit} (${Hday} INR per unit per day); shortage penalty ${P} INR per unit; lead time ${L} days; target cycle service level ${SL}%.`.slice(
        0,
        1500,
      ),
    });
  }

  // Risks calculation for optimization
  let skuRisks = [];
  if (optimizationRun) {
    try {
      skuRisks = buildSessionRisk(optimizationRun, simulationRun, assumptions);
    } catch {
      skuRisks = [];
    }
  }
  const riskBySku = new Map();
  for (const r of skuRisks) {
    riskBySku.set(r.skuId, r);
  }

  // 7. optimization_sku & 8. optimization_aggregate
  if (optimizationRun && optimizationRun.result) {
    const optRunId = optimizationRun._id.toString();
    const optSkus = optimizationRun.result.skus || {};

    let totalGaps = [];
    let eligibleCount = 0;
    let ineligibleCount = 0;
    const riskCounts = { low: 0, medium: 0, high: 0 };

    for (const [skuId, skuOpt] of Object.entries(optSkus)) {
      if (skuOpt.status !== "ok") {
        ineligibleCount++;
        docs.push({
          artifactType: "optimization_sku",
          artifactId: optRunId,
          skuId,
          text: `SKU ${skuId}: no policy computed (${skuOpt.message || "ineligible"}).`.slice(
            0,
            1500,
          ),
        });
        continue;
      }

      eligibleCount++;
      const risk = riskBySku.get(skuId);
      if (risk) {
        riskCounts[risk.level] = (riskCounts[risk.level] || 0) + 1;
      }

      const eoq = skuOpt.eoq ?? "n/a";
      const D = n(skuOpt.annual_demand);
      const muL = n(skuOpt.ltd?.mean);
      const ropD = skuOpt.rop_deterministic ?? "n/a";
      const ssD = n(skuOpt.normal_ss);
      const sigL = n(skuOpt.sigma_l);
      const zVal = n(skuOpt.z_value);
      const ropU = skuOpt.rop_uncertainty_aware ?? "n/a";
      const ssU = n(skuOpt.bootstrap_ss);
      const gap = skuOpt.rop_gap ?? 0;
      totalGaps.push(Math.abs(gap));

      const ltd = skuOpt.ltd || {};
      const a = n(ltd.p10);
      const b = n(ltd.p50);
      const c = n(ltd.p90);
      const s = n(ltd.skewness);

      const rLevel = risk?.level || "low";
      const flagsStr =
        risk?.flags && risk.flags.length > 0
          ? risk.flags.map((f) => f.code).join(", ")
          : "none";
      const warningsStr =
        skuOpt.warnings && skuOpt.warnings.length > 0
          ? skuOpt.warnings.join("; ")
          : "none";

      docs.push({
        artifactType: "optimization_sku",
        artifactId: optRunId,
        skuId,
        text: `SKU ${skuId}: EOQ ${eoq} units (annual demand ${D}). Expected lead-time demand ${muL} units. Deterministic ROP ${ropD} (safety stock ${ssD}, sigma_L ${sigL}, z ${zVal}). Uncertainty-aware ROP ${ropU} (safety stock ${ssU}); gap ${gap} units. Lead-time demand P10/P50/P90: ${a}/${b}/${c}, skewness ${s}. Risk level ${rLevel}; flags: ${flagsStr}. Warnings: ${warningsStr}.`.slice(
          0,
          1500,
        ),
      });
    }

    // optimization_aggregate
    const meanGap =
      totalGaps.length > 0
        ? totalGaps.reduce((a, b) => a + b, 0) / totalGaps.length
        : 0;
    const maxGap = totalGaps.length > 0 ? Math.max(...totalGaps) : 0;

    docs.push({
      artifactType: "optimization_aggregate",
      artifactId: optRunId,
      skuId: null,
      text: `Optimization aggregate: ${eligibleCount} eligible SKUs, ${ineligibleCount} ineligible SKUs. Risk distribution: ${riskCounts.low} low, ${riskCounts.medium} medium, ${riskCounts.high} high risk. Mean absolute ROP gap: ${n(meanGap)} units, max absolute ROP gap: ${n(maxGap)} units.`.slice(
        0,
        1500,
      ),
    });
  }

  // 9. simulation_sku & 10. simulation_aggregate
  if (simulationRun && simulationRun.result) {
    const simRunId = simulationRun._id.toString();
    const sc = simulationRun.scenarioCount ?? 500;
    const hz = simulationRun.horizonDays ?? 90;
    const sd = simulationRun.seed ?? 42;
    const simSkus = simulationRun.result.skus || {};

    for (const [skuId, simData] of Object.entries(simSkus)) {
      const d = simData.deterministic || {};
      const u = simData.uncertainty_aware || {};
      const diff = n(simData.mean_total_cost_diff);
      const pctCheaper = n(
        (simData.fraction_uncertainty_cheaper ?? 0) * 100,
        1,
      );

      docs.push({
        artifactType: "simulation_sku",
        artifactId: simRunId,
        skuId,
        text: `Simulation for SKU ${skuId} (${sc} scenarios, ${hz} days, seed ${sd}). Deterministic policy: mean total cost ${n(d.mean_total_cost)} INR (ordering ${n(d.mean_ordering_cost)}, holding ${n(d.mean_holding_cost)}, shortage ${n(d.mean_shortage_cost)}), service level ${n((d.service_level ?? 0) * 100, 1)}%, stockout units ${n(d.mean_stockout_units)}, average inventory ${n(d.mean_ending_inventory)}, orders ${n(d.mean_orders_placed)}. Uncertainty-aware policy: mean total cost ${n(u.mean_total_cost)} INR (ordering ${n(u.mean_ordering_cost)}, holding ${n(u.mean_holding_cost)}, shortage ${n(u.mean_shortage_cost)}), service level ${n((u.service_level ?? 0) * 100, 1)}%, stockout units ${n(u.mean_stockout_units)}, average inventory ${n(u.mean_ending_inventory)}, orders ${n(u.mean_orders_placed)}. Paired mean cost difference (uncertainty-aware minus deterministic) ${diff} INR; uncertainty-aware cheaper in ${pctCheaper}% of scenarios.`.slice(
          0,
          1500,
        ),
      });
    }

    if (simulationRun.result.aggregate) {
      const agg = simulationRun.result.aggregate;
      const d = agg.deterministic || {};
      const u = agg.uncertainty_aware || {};
      const diffSum = n(agg.mean_total_cost_diff_sum);

      docs.push({
        artifactType: "simulation_aggregate",
        artifactId: simRunId,
        skuId: null,
        text: `Simulation aggregate (${sc} scenarios, ${hz} days, seed ${sd}): Deterministic policy total mean cost ${n(d.mean_total_cost)} INR (ordering ${n(d.mean_ordering_cost)}, holding ${n(d.mean_holding_cost)}, shortage ${n(d.mean_shortage_cost)}), service level ${n((d.service_level ?? 0) * 100, 1)}%, stockout units ${n(d.mean_stockout_units)}. Uncertainty-aware policy total mean cost ${n(u.mean_total_cost)} INR (ordering ${n(u.mean_ordering_cost)}, holding ${n(u.mean_holding_cost)}, shortage ${n(u.mean_shortage_cost)}), service level ${n((u.service_level ?? 0) * 100, 1)}%, stockout units ${n(u.mean_stockout_units)}. Aggregate paired mean cost difference sum (uncertainty-aware minus deterministic): ${diffSum} INR.`.slice(
          0,
          1500,
        ),
      });
    }
  }

  return docs;
}
