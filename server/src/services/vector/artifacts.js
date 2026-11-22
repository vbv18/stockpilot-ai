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
  "portfolio_aggregate",
  "portfolio_sku",
  "replay_aggregate",
  "replay_sku",
  "backtest_aggregate",
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
    portfolioRun,
    replayRun,
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
    const skusMap =
      assumptions.skus instanceof Map
        ? Object.fromEntries(assumptions.skus)
        : assumptions.skus ||
          (assumptions.toObject
            ? assumptions.toObject({ flattenMaps: true }).skus
            : {}) ||
          {};
    const v = assumptions.version ?? 1;
    const nSkus = Object.keys(skusMap).length;
    overviewParts.push(
      `Assumptions version ${v} covering ${nSkus} SKUs with per-SKU parameters.`,
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
  if (portfolioRun) {
    const b = portfolioRun.budget ? `${n(portfolioRun.budget)} budget` : "no budget limit";
    const c = portfolioRun.capacity ? `${n(portfolioRun.capacity)} units capacity` : "no capacity limit";
    overviewParts.push(
      `Portfolio run ${portfolioRun._id}: multi-SKU optimization with ${b}, ${c}.`,
    );
  }
  if (replayRun) {
    overviewParts.push(
      `Replay run ${replayRun._id}: tested on actual historical demand over ${replayRun.holdoutDays ?? 28} holdout days.`,
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
  const rawFcSkus =
    forecastRun?.result?.forecast?.skus ||
    forecastRun?.result?.skus ||
    null;
  if (forecastRun && rawFcSkus) {
    const forecastRunId = forecastRun._id.toString();
    const skusMap = Array.isArray(rawFcSkus)
      ? Object.fromEntries(rawFcSkus.map((s) => [s.sku_id, s]))
      : rawFcSkus;
    const rawEvalSkus = forecastRun.result?.evaluation?.skus || {};
    const evalMap = Array.isArray(rawEvalSkus)
      ? Object.fromEntries(rawEvalSkus.map((e) => [e.sku_id, e]))
      : rawEvalSkus;

    for (const [skuId, skuData] of Object.entries(skusMap)) {
      const demandClass = skuData.demand_class || "smooth";
      const adiStr = n(skuData.adi);
      const cv2Str = n(skuData.cv2);

      if (skuData.status !== "ok") {
        docs.push({
          artifactType: "forecast_sku",
          artifactId: forecastRunId,
          skuId,
          text: `SKU ${skuId}: demand class ${demandClass}, status ${skuData.status}, interval status ${skuData.interval_status}, ${skuData.n_observations ?? 0} observations. ${skuData.message || ""}`.slice(
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
        const p10Arr = skuData.p10 || skuData.intervals?.p10 || [];
        const p90Arr = skuData.p90 || skuData.intervals?.p90 || [];
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
          : (skuData.n_residual_blocks ?? 0);

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

        const modelSpec =
          skuData.autoets_model_spec || skuData.model_spec || "AutoETS";
        const fcStartDate =
          forecastRun.result?.forecast_start_date ||
          forecastRun.result?.forecast?.skus?.[0]?.forecast_start_date ||
          "start";

        docs.push({
          artifactType: "forecast_sku",
          artifactId: forecastRunId,
          skuId,
          text: `SKU ${skuId}: demand class ${demandClass} (ADI ${adiStr}, CV² ${cv2Str}), status ${skuData.status}, interval status ${skuData.interval_status}, ${skuData.n_observations} observations. Model ${modelSpec}. Next 28 days from ${fcStartDate}: forecast averages ${n(avg)} units/day (total ${n(total)}); P10-P90 band averages ${n(p10avg)} to ${n(p90avg)} units/day. Residual standard deviation ${rs} from ${blocks} residual blocks. Recent demand: last 28 days averaged ${r28} units/day versus ${p28} in the prior 28 days; zero-demand days in the last 56 days: ${z}. Warnings: ${warningsStr}.`.slice(
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
          text: `Evaluation for SKU ${skuId} (8-origin rolling backtest): Chosen model ${evalData.chosen_model || "AutoETS"} (${evalData.mase_improvement ? n(evalData.mase_improvement, 1) + "% vs SeasonalNaive" : "baseline"}). AutoETS MAE ${n(ae.mae)}, RMSE ${n(ae.rmse)}, MASE ${n(ae.mase)}, ${wapeAe}; Seasonal Naive MAE ${n(sn.mae)}, RMSE ${n(sn.rmse)}, MASE ${n(sn.mase)}, ${wapeSn}; P10-P90 coverage ${cov} (nominal 80%), mean width ${width} units.`.slice(
            0,
            1500,
          ),
        });
      }
    }
  }

  // 6. assumption_set
  if (assumptions) {
    const skusMap =
      assumptions.skus instanceof Map
        ? Object.fromEntries(assumptions.skus)
        : assumptions.skus ||
          (assumptions.toObject
            ? assumptions.toObject({ flattenMaps: true }).skus
            : {}) ||
          {};
    const v = assumptions.version ?? 1;
    const skuSummaries = Object.entries(skusMap).map(([sId, a]) => {
      const S = n(a.ordering_cost);
      const H = n(a.holding_cost_annual);
      const Hday = n(a.holding_cost_annual / 365, 4);
      const P = n(a.shortage_penalty);
      const L = a.lead_time_mean ?? "n/a";
      const SL = n((a.service_level ?? 0) * 100, 1);
      const U = n(a.unit_cost);
      return `SKU ${sId}: ordering cost ${S} INR, annual holding cost ${H} INR (${Hday} INR/day), shortage penalty ${P} INR, lead time ${L} days, target service level ${SL}%, unit cost ${U} INR.`;
    });

    docs.push({
      artifactType: "assumption_set",
      artifactId: assumptions._id.toString(),
      skuId: null,
      text: `Assumptions version ${v}: ${skuSummaries.join("; ")}`.slice(
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
      const ropQ = skuOpt.rop_quantile ?? "n/a";
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
        text: `SKU ${skuId}: EOQ ${eoq} units (annual demand ${D}). Expected lead-time demand ${muL} units. Deterministic ROP ${ropD} (safety stock ${ssD}, sigma_L ${sigL}, z ${zVal}). Quantile ROP ${ropQ}. Uncertainty-aware ROP ${ropU} (safety stock ${ssU}); gap ${gap} units. Lead-time demand P10/P50/P90: ${a}/${b}/${c}, skewness ${s}. Risk level ${rLevel}; flags: ${flagsStr}. Warnings: ${warningsStr}.`.slice(
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

  // 11. backtest_aggregate
  if (forecastRun && forecastRun.result?.evaluation) {
    const ev = forecastRun.result.evaluation;
    const agg = ev.aggregate || {};
    const autoets = agg.autoets || {};
    const snaive = agg.seasonal_naive || {};
    const croston = agg.croston_sba || {};
    const rawSkus = ev.skus || {};
    const skusList = Array.isArray(rawSkus)
      ? rawSkus
      : Object.values(rawSkus);
    const chosenCounts = {};
    for (const s of skusList) {
      if (s.chosen_model) {
        chosenCounts[s.chosen_model] = (chosenCounts[s.chosen_model] || 0) + 1;
      }
    }
    const chosenSummary =
      Object.entries(chosenCounts)
        .map(([m, c]) => `${m}: ${c}`)
        .join(", ") || "n/a";

    docs.push({
      artifactType: "backtest_aggregate",
      artifactId: forecastRun._id.toString(),
      skuId: null,
      text: `Rolling backtest model comparison aggregate (8-origin evaluation across ${skusList.length} SKUs): Chosen model distribution: ${chosenSummary}. AutoETS pooled WAPE ${n((autoets.wape_pooled ?? 0) * 100, 1)}%, mean MAE ${n(autoets.mae_mean)}, mean RMSE ${n(autoets.rmse_mean)}, mean MASE ${n(autoets.mase_mean)}. Seasonal Naive pooled WAPE ${n((snaive.wape_pooled ?? 0) * 100, 1)}%, mean MAE ${n(snaive.mae_mean)}, mean RMSE ${n(snaive.rmse_mean)}, mean MASE ${n(snaive.mase_mean)}. Croston SBA pooled WAPE ${n((croston.wape_pooled ?? 0) * 100, 1)}%, mean MAE ${n(croston.mae_mean)}, mean RMSE ${n(croston.rmse_mean)}. Interval coverage: nominal 80%, mean coverage ${n((agg.coverage_mean ?? 0) * 100, 1)}%, mean width ${n(agg.mean_width_mean)} units.`.slice(
        0,
        1500,
      ),
    });
  }

  // 12. portfolio_aggregate & 13. portfolio_sku
  if (portfolioRun && portfolioRun.result) {
    const pr = portfolioRun.result;
    const portRunId = portfolioRun._id.toString();
    const binding =
      pr.binding_constraints && pr.binding_constraints.length > 0
        ? pr.binding_constraints.join(", ")
        : "none";
    const uPlan = pr.unconstrained_plan || {};
    const cPlan = pr.constrained_plan || {};

    docs.push({
      artifactType: "portfolio_aggregate",
      artifactId: portRunId,
      skuId: null,
      text: `Portfolio optimization aggregate: Budget ${n(pr.budget)} INR (usage ${n(pr.budget_usage_pct, 1)}%), Capacity ${n(pr.capacity)} units (usage ${n(pr.capacity_usage_pct, 1)}%). Binding constraints: ${binding}. Budget shadow price: ${n(pr.budget_shadow_price)} cost decrease per unit budget. Unconstrained plan: total cost ${n(uPlan.total_cost)} INR, inventory investment ${n(uPlan.total_inventory_investment)} INR, total units ${n(uPlan.total_units)}, avg service level ${n((uPlan.avg_service_level ?? 0) * 100, 1)}%, turnover ${n(uPlan.turnover)}. Constrained plan: total cost ${n(cPlan.total_cost)} INR, inventory investment ${n(cPlan.total_inventory_investment)} INR, total units ${n(cPlan.total_units)}, avg service level ${n((cPlan.avg_service_level ?? 0) * 100, 1)}%, turnover ${n(cPlan.turnover)}. Total cost delta (constrained minus unconstrained): ${n(pr.total_cost_delta)} INR.`.slice(
        0,
        1500,
      ),
    });

    const uMap = new Map((uPlan.skus || []).map((s) => [s.sku_id, s]));
    const cSkus = cPlan.skus || [];
    for (const c of cSkus) {
      const u = uMap.get(c.sku_id) || {};
      const costDelta = n(c.total_cost - (u.total_cost ?? c.total_cost));
      docs.push({
        artifactType: "portfolio_sku",
        artifactId: portRunId,
        skuId: c.sku_id,
        text: `Portfolio plan for SKU ${c.sku_id}: Unconstrained service level ${n((u.service_level ?? 0) * 100, 1)}%, ROP ${u.rop ?? "n/a"}, avg inventory ${n(u.avg_inventory)} units, investment ${n(u.inventory_investment)} INR, total cost ${n(u.total_cost)} INR, turnover ${n(u.turnover)}. Constrained service level ${n((c.service_level ?? 0) * 100, 1)}%, ROP ${c.rop ?? "n/a"}, avg inventory ${n(c.avg_inventory)} units, investment ${n(c.inventory_investment)} INR, total cost ${n(c.total_cost)} INR, turnover ${n(c.turnover)}. Cost delta ${costDelta} INR.`.slice(
          0,
          1500,
        ),
      });
    }
  }

  // 14. replay_aggregate & 15. replay_sku
  if (replayRun && replayRun.results) {
    const repRunId = replayRun._id.toString();
    const rr = replayRun.results;
    const agg = rr.aggregate;
    if (agg) {
      const d = agg.deterministic || agg.det || {};
      const u = agg.uncertainty_aware || agg.unc || {};
      docs.push({
        artifactType: "replay_aggregate",
        artifactId: repRunId,
        skuId: null,
        text: `Replay on actual demand aggregate (${replayRun.holdoutDays ?? 28} holdout days): Deterministic policy fill rate ${n((d.fill_rate ?? 0) * 100, 1)}%, total cost ${n(d.total_cost)} INR, stockout days ${d.stockout_days ?? 0}. Uncertainty-aware policy fill rate ${n((u.fill_rate ?? 0) * 100, 1)}%, total cost ${n(u.total_cost)} INR, stockout days ${u.stockout_days ?? 0}.`.slice(
          0,
          1500,
        ),
      });
    }

    const repSkus = Array.isArray(rr.skus)
      ? rr.skus
      : Object.values(rr.skus || {});
    for (const s of repSkus) {
      const d = s.deterministic || s.det || {};
      const u = s.uncertainty_aware || s.unc || {};
      docs.push({
        artifactType: "replay_sku",
        artifactId: repRunId,
        skuId: s.sku_id,
        text: `Replay on actual demand for SKU ${s.sku_id} (${replayRun.holdoutDays ?? 28} holdout days): status ${s.status}. Deterministic policy fill rate ${n((d.fill_rate ?? 0) * 100, 1)}%, total cost ${n(d.total_cost)} INR, stockout days ${d.stockout_days ?? 0}. Uncertainty-aware policy fill rate ${n((u.fill_rate ?? 0) * 100, 1)}%, total cost ${n(u.total_cost)} INR, stockout days ${u.stockout_days ?? 0}.`.slice(
          0,
          1500,
        ),
      });
    }
  }

  return docs;
}
