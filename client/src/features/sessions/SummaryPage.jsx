import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Clock,
  Compass,
  Layers,
  LineChart,
  RefreshCw,
  Scale,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  useGetForecastQuery,
  useGetOptimizationQuery,
  useListSimulationsQuery,
  useGetSimulationQuery,
  useGetReplayQuery,
  useGetPortfolioQuery,
} from "../../lib/api.js";
import { fmtInr, fmtNum, fmtPct } from "../../lib/format.js";
import { SkuDrawer } from "../optimization/SkuDrawer.jsx";

export default function SummaryPage() {
  const { session } = useOutletContext();
  const sessionId = session.id;

  const [selectedSkuForDrawer, setSelectedSkuForDrawer] = useState(null);

  // Stored runs queries (pure reads, zero new compute)
  const {
    data: forecastData,
    isLoading: isForecastLoading,
    refetch: refetchForecast,
  } = useGetForecastQuery(sessionId);

  const {
    data: optData,
    isLoading: isOptLoading,
    refetch: refetchOptimization,
  } = useGetOptimizationQuery(sessionId);

  const {
    data: simListData = [],
    isLoading: isSimListLoading,
    refetch: refetchSimList,
  } = useListSimulationsQuery(sessionId);

  const activeSimId = session.activeSimulationRunId || simListData[0]?.id;
  const {
    data: simData,
    isLoading: isSimLoading,
    refetch: refetchSim,
  } = useGetSimulationQuery(
    { id: sessionId, simulationId: activeSimId },
    { skip: !activeSimId },
  );

  const {
    data: replayData,
    isLoading: isReplayLoading,
    refetch: refetchReplay,
  } = useGetReplayQuery(sessionId);

  const {
    data: portData,
    isLoading: isPortLoading,
    refetch: refetchPortfolio,
  } = useGetPortfolioQuery(sessionId);

  const isAnyLoading =
    isForecastLoading ||
    isOptLoading ||
    isSimListLoading ||
    isSimLoading ||
    isReplayLoading ||
    isPortLoading;

  const handleRefreshAll = () => {
    refetchForecast();
    refetchOptimization();
    refetchSimList();
    if (activeSimId) refetchSim();
    refetchReplay();
    refetchPortfolio();
  };

  // 1. Forecast KPIs: WAPE & MASE improvement vs Naive, P10-P90 coverage
  const forecastSummary = useMemo(() => {
    const evalAgg =
      forecastData?.result?.evaluation?.aggregate ||
      forecastData?.evaluation?.aggregate;
    const baseImp =
      evalAgg?.baseline_improvement ||
      forecastData?.result?.evaluation?.baseline_improvement;
    const evalSkus =
      forecastData?.result?.evaluation?.skus ||
      forecastData?.evaluation?.skus ||
      [];

    const wapePct = baseImp?.wape_pct ?? null;
    const maePct = baseImp?.mae_pct ?? null;
    const rmsePct = baseImp?.rmse_pct ?? null;

    // MASE improvement calculation
    let masePct = null;
    if (
      evalAgg?.naive?.mase_mean != null &&
      evalAgg?.autoets?.mase_mean != null &&
      evalAgg.naive.mase_mean > 0
    ) {
      masePct =
        ((evalAgg.naive.mase_mean - evalAgg.autoets.mase_mean) /
          evalAgg.naive.mase_mean) *
        100;
    } else if (evalSkus.length > 0) {
      const valid = evalSkus
        .filter((s) => s.mase_improvement != null)
        .map((s) => s.mase_improvement);
      if (valid.length > 0) {
        masePct = valid.reduce((a, b) => a + b, 0) / valid.length;
      }
    }
    if (masePct == null && maePct != null) {
      masePct = maePct;
    }

    const coverage =
      evalAgg?.coverage_mean ??
      evalAgg?.interval_metrics?.coverage ??
      evalAgg?.interval_metrics?.coverage_p10_p90 ??
      null;

    const coverageDelta = coverage != null ? (coverage - 0.8) * 100 : null;
    const meanWidth =
      evalAgg?.mean_width_mean ?? evalAgg?.interval_metrics?.mean_width ?? null;

    return {
      hasData: Boolean(evalAgg),
      wapePct,
      maePct,
      rmsePct,
      masePct,
      coverage,
      coverageDelta,
      meanWidth,
      autoetsWape: evalAgg?.autoets?.wape_pooled,
      naiveWape: evalAgg?.naive?.wape_pooled,
      seasonalNaiveWape: evalAgg?.seasonal_naive?.wape_pooled,
      globalLgbmWape: evalAgg?.global_lgbm?.wape_pooled,
      skuCount: evalSkus.length || (forecastData?.result?.skus?.length ?? 0),
    };
  }, [forecastData]);

  // 2. Policy Optimization KPIs: Mean policy gap (s_emp - s_det)
  const optimizationSummary = useMemo(() => {
    const skus = optData?.result?.skus || [];
    const eligible = skus.filter((s) => s.status === "ok");

    if (eligible.length === 0) {
      return {
        hasData: false,
        meanGap: null,
        higherEmpCount: 0,
        totalSkus: 0,
        dependency: optData?.result?.dependency || null,
      };
    }

    const gaps = eligible.map((s) => {
      const sEmp = s.s_emp ?? s.rop_uncertainty_aware ?? 0;
      const sDet = s.s_det ?? s.rop_deterministic ?? 0;
      return sEmp - sDet;
    });

    const meanGap =
      gaps.length > 0 ? gaps.reduce((acc, v) => acc + v, 0) / gaps.length : 0;

    const higherEmpCount = gaps.filter((g) => g > 0).length;

    return {
      hasData: true,
      meanGap,
      higherEmpCount,
      totalSkus: eligible.length,
      dependency: optData?.result?.dependency || null,
    };
  }, [optData]);

  // 3. Simulated & Replay Cost Savings of Best Policy vs s_det
  const policyComparisonSummary = useMemo(() => {
    // Simulated aggregate
    const simAgg =
      simData?.result?.aggregate ||
      simData?.policyResults?.aggregate ||
      simListData[0]?.aggregate;

    let simSavings = null;
    if (simAgg) {
      const d = simAgg.deterministic || simAgg.s_det || {};
      const q = simAgg.quantile || simAgg.s_quant || {};
      const u = simAgg.uncertainty_aware || simAgg.s_emp || {};

      const costDet = d.mean_total_cost ?? d.total_cost ?? null;
      const costQua = q.mean_total_cost ?? q.total_cost ?? null;
      const costEmp = u.mean_total_cost ?? u.total_cost ?? null;

      const candidates = [
        { id: "s_det", name: "Deterministic (s_det)", cost: costDet },
        { id: "s_quant", name: "Quantile (s_quant)", cost: costQua },
        { id: "s_emp", name: "Empirical (s_emp)", cost: costEmp },
      ].filter((c) => c.cost != null && Number.isFinite(c.cost));

      if (candidates.length > 0 && costDet != null) {
        const sorted = [...candidates].sort((a, b) => a.cost - b.cost);
        const best = sorted[0];
        const savedAmount = Math.max(0, costDet - best.cost);
        const savedPct = costDet > 0 ? (savedAmount / costDet) * 100 : 0;

        simSavings = {
          hasData: true,
          bestPolicyId: best.id,
          bestPolicyName: best.name,
          costDet,
          bestCost: best.cost,
          savedAmount,
          savedPct,
          policies: candidates,
        };
      }
    }

    // Replay aggregate (Actual Held-Out Demand)
    const replayRun = replayData?.latest;
    const replayAgg = replayRun?.aggregate;

    let repSavings = null;
    if (replayRun?.status === "succeeded" && replayAgg) {
      const d =
        replayAgg.s_det || replayAgg.deterministic || replayAgg.det || {};
      const q = replayAgg.s_quant || replayAgg.quantile || {};
      const u =
        replayAgg.s_emp || replayAgg.uncertainty_aware || replayAgg.unc || {};

      const costDet = d.total_cost ?? null;
      const costQua = q.total_cost ?? null;
      const costEmp = u.total_cost ?? null;

      const candidates = [
        { id: "s_det", name: "Deterministic (s_det)", cost: costDet },
        { id: "s_quant", name: "Quantile (s_quant)", cost: costQua },
        { id: "s_emp", name: "Empirical (s_emp)", cost: costEmp },
      ].filter((c) => c.cost != null && Number.isFinite(c.cost));

      if (candidates.length > 0 && costDet != null) {
        const sorted = [...candidates].sort((a, b) => a.cost - b.cost);
        const best = sorted[0];
        const savedAmount = Math.max(0, costDet - best.cost);
        const savedPct = costDet > 0 ? (savedAmount / costDet) * 100 : 0;

        repSavings = {
          hasData: true,
          bestPolicyId: best.id,
          bestPolicyName: best.name,
          costDet,
          bestCost: best.cost,
          savedAmount,
          savedPct,
          policies: candidates,
        };
      }
    }

    return {
      sim: simSavings,
      replay: repSavings,
    };
  }, [simData, simListData, replayData]);

  // 4. Portfolio Allocation: Constrained vs Unconstrained Cost & Exact-Solver Gap
  const portfolioSummary = useMemo(() => {
    const res = portData?.result;
    if (!res) {
      return { hasData: false };
    }

    const uPlan = res.unconstrained_plan;
    const cPlan = res.constrained_plan;

    const uncCost = uPlan?.total_cost ?? null;
    const conCost = cPlan?.total_cost ?? res.exact_cost ?? null;
    const costDelta =
      res.total_cost_delta ??
      (conCost != null && uncCost != null ? conCost - uncCost : null);

    const costDeltaPct =
      uncCost != null && uncCost > 0 && costDelta != null
        ? (costDelta / uncCost) * 100
        : null;

    const exactCost = res.exact_cost ?? conCost;
    const greedyCost = res.greedy_cost ?? null;
    const optimalityGapPct = res.optimality_gap_pct ?? null;
    const shadowPrice = res.shadow_price ?? res.budget_shadow_price ?? null;

    return {
      hasData: true,
      uncCost,
      conCost,
      costDelta,
      costDeltaPct,
      exactCost,
      greedyCost,
      optimalityGapPct,
      shadowPrice,
      budget: res.budget,
      capacity: res.capacity,
      budgetUsagePct: res.budget_usage_pct,
      capacityUsagePct: res.capacity_usage_pct,
      status: res.status || "optimal",
      bindingConstraints: res.binding_constraints || [],
      minimumFeasibleBudget: res.minimum_feasible_budget,
    };
  }, [portData]);

  // 5. Highest-Risk SKUs (Top 3)
  const topRiskSkus = useMemo(() => {
    const rawRisks = optData?.risk || [];
    if (rawRisks.length === 0) return [];

    const sorted = [...rawRisks].sort(
      (a, b) => (b.score ?? 0) - (a.score ?? 0),
    );
    return sorted.slice(0, 3);
  }, [optData]);

  return (
    <div className="flex flex-col gap-8 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/[0.08] pb-6">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400">
              <Compass size={20} />
            </span>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Session Executive Summary
            </h1>
          </div>
          <p className="text-xs text-slate-400 mt-1.5 max-w-2xl leading-relaxed">
            Consolidated insights and key performance indicators reading
            directly from stored pipeline runs. No new compute is triggered.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleRefreshAll}
            disabled={isAnyLoading}
            className="px-3.5 py-1.5 bg-slate-900 border border-white/[0.08] hover:bg-slate-800 text-xs text-slate-300 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw
              size={13}
              className={isAnyLoading ? "animate-spin" : ""}
            />
            <span>Refresh Stored Runs</span>
          </button>
          <Link
            to={`/ask-ai?sessionId=${sessionId}`}
            className="px-3.5 py-1.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-all shadow-sm"
          >
            <Sparkles size={13} />
            <span>Ask AI About Session</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* KPI 1: WAPE & MASE Improvement vs Naive */}
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                <LineChart size={14} className="text-indigo-400" />
                Forecast Accuracy vs Naive
              </span>
              <p className="text-xs text-slate-500 mt-0.5">
                Rolling-origin out-of-sample backtest
              </p>
            </div>
            {forecastSummary.hasData && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                +{fmtNum(forecastSummary.wapePct, 1)}% WAPE
              </span>
            )}
          </div>

          <div className="mt-4">
            {forecastSummary.hasData ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-3">
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-400 font-medium">
                      WAPE Gain
                    </span>
                    <span className="text-2xl font-bold font-mono text-emerald-400">
                      +{fmtNum(forecastSummary.wapePct, 1)}%
                    </span>
                  </div>
                  <div className="h-8 w-px bg-white/[0.08] mx-2" />
                  <div className="flex flex-col">
                    <span className="text-xs text-slate-400 font-medium">
                      MASE Gain
                    </span>
                    <span className="text-2xl font-bold font-mono text-indigo-400">
                      +{fmtNum(forecastSummary.masePct, 1)}%
                    </span>
                  </div>
                </div>

                <div className="pt-3 border-t border-white/[0.04] grid grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono">
                  <div>
                    RMSE Gain:{" "}
                    <span className="text-slate-200">
                      +{fmtNum(forecastSummary.rmsePct, 1)}%
                    </span>
                  </div>
                  <div>
                    MAE Gain:{" "}
                    <span className="text-slate-200">
                      +{fmtNum(forecastSummary.maePct, 1)}%
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto text-slate-600 mb-1.5" />
                <p className="text-xs text-slate-500">
                  Forecasting stage not run yet
                </p>
                <Link
                  to={`/sessions/${sessionId}/forecast`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  <span>Go to Forecast</span>
                  <ArrowRight size={11} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* KPI 2: P10-P90 Prediction Interval Coverage */}
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                <BarChart3 size={14} className="text-purple-400" />
                P10–P90 Interval Coverage
              </span>
              <p className="text-xs text-slate-500 mt-0.5">
                Rolling horizon calibrated intervals
              </p>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-slate-800 text-slate-300 border border-white/[0.06]">
              Nominal 80%
            </span>
          </div>

          <div className="mt-4">
            {forecastSummary.hasData && forecastSummary.coverage != null ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-purple-300">
                    {fmtPct(forecastSummary.coverage, 1)}
                  </span>
                  <span
                    className={`text-xs font-mono font-medium ${
                      (forecastSummary.coverageDelta ?? 0) >= -2
                        ? "text-emerald-400"
                        : "text-amber-400"
                    }`}
                  >
                    ({(forecastSummary.coverageDelta ?? 0) >= 0 ? "+" : ""}
                    {fmtNum(forecastSummary.coverageDelta, 1)}% vs target)
                  </span>
                </div>

                <div className="pt-3 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-slate-400 font-mono">
                  <span>Mean band width:</span>
                  <span className="text-slate-200">
                    {fmtNum(forecastSummary.meanWidth, 1)} units
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto text-slate-600 mb-1.5" />
                <p className="text-xs text-slate-500">
                  Interval coverage not available
                </p>
                <Link
                  to={`/sessions/${sessionId}/forecast`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  <span>Go to Forecast</span>
                  <ArrowRight size={11} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* KPI 3: Mean Policy Gap (s_emp - s_det) */}
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                <Zap size={14} className="text-amber-400" />
                Mean Policy Gap (s_emp - s_det)
              </span>
              <p className="text-xs text-slate-500 mt-0.5">
                Empirical buffer expansion
              </p>
            </div>
            {optimizationSummary.hasData && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
                {optimizationSummary.higherEmpCount}/
                {optimizationSummary.totalSkus} SKUs expanded
              </span>
            )}
          </div>

          <div className="mt-4">
            {optimizationSummary.hasData ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-amber-300">
                    {optimizationSummary.meanGap >= 0 ? "+" : ""}
                    {fmtNum(optimizationSummary.meanGap, 1)}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    units/SKU
                  </span>
                </div>

                <div className="pt-3 border-t border-white/[0.04] text-[11px] text-slate-400 leading-relaxed">
                  Accounts for non-normal lead-time demand skew and forecast
                  error kurtosis across inventory policies.
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto text-slate-600 mb-1.5" />
                <p className="text-xs text-slate-500">
                  Optimization stage not run yet
                </p>
                <Link
                  to={`/sessions/${sessionId}/optimization`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  <span>Go to Optimization</span>
                  <ArrowRight size={11} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* KPI 4: Simulated Cost Saving vs s_det */}
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                <TrendingDown size={14} className="text-emerald-400" />
                Simulated Saving vs s_det
              </span>
              <p className="text-xs text-slate-500 mt-0.5">
                Monte Carlo policy simulation
              </p>
            </div>
            {policyComparisonSummary.sim && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                {policyComparisonSummary.sim.bestPolicyId}
              </span>
            )}
          </div>

          <div className="mt-4">
            {policyComparisonSummary.sim ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-emerald-400">
                    {fmtInr(policyComparisonSummary.sim.savedAmount)}
                  </span>
                  <span className="text-xs text-emerald-300 font-mono font-medium">
                    (-{fmtNum(policyComparisonSummary.sim.savedPct, 1)}%)
                  </span>
                </div>

                <div className="pt-3 border-t border-white/[0.04] text-[11px] text-slate-400 font-mono flex items-center justify-between">
                  <span>Best policy:</span>
                  <span className="text-slate-200">
                    {policyComparisonSummary.sim.bestPolicyName}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto text-slate-600 mb-1.5" />
                <p className="text-xs text-slate-500">Simulation not run yet</p>
                <Link
                  to={`/sessions/${sessionId}/simulation`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  <span>Go to Simulation</span>
                  <ArrowRight size={11} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* KPI 5: Replay Cost Saving vs s_det (Held-out actual history) */}
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                <ShieldAlert size={14} className="text-cyan-400" />
                Actual Replay Saving vs s_det
              </span>
              <p className="text-xs text-slate-500 mt-0.5">
                Tested on actual holdout transactions
              </p>
            </div>
            {policyComparisonSummary.replay && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                {policyComparisonSummary.replay.bestPolicyId}
              </span>
            )}
          </div>

          <div className="mt-4">
            {policyComparisonSummary.replay ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-cyan-300">
                    {fmtInr(policyComparisonSummary.replay.savedAmount)}
                  </span>
                  <span className="text-xs text-cyan-400 font-mono font-medium">
                    (-{fmtNum(policyComparisonSummary.replay.savedPct, 1)}%)
                  </span>
                </div>

                <div className="pt-3 border-t border-white/[0.04] text-[11px] text-slate-400 font-mono flex items-center justify-between">
                  <span>Best policy:</span>
                  <span className="text-slate-200">
                    {policyComparisonSummary.replay.bestPolicyName}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto text-slate-600 mb-1.5" />
                <p className="text-xs text-slate-500">
                  Historical replay not run yet
                </p>
                <Link
                  to={`/sessions/${sessionId}/simulation`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  <span>Go to Replay in Simulation</span>
                  <ArrowRight size={11} />
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* KPI 6: Constrained vs Unconstrained Portfolio Cost */}
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
                <Scale size={14} className="text-rose-400" />
                Constrained vs Unconstrained Cost
              </span>
              <p className="text-xs text-slate-500 mt-0.5">
                Multi-SKU portfolio allocation
              </p>
            </div>
            {portfolioSummary.hasData &&
              portfolioSummary.optimalityGapPct != null && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  {fmtNum(portfolioSummary.optimalityGapPct, 2)}% MILP gap
                </span>
              )}
          </div>

          <div className="mt-4">
            {portfolioSummary.hasData ? (
              <div className="space-y-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-slate-100">
                    {fmtInr(portfolioSummary.conCost)}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    vs {fmtInr(portfolioSummary.uncCost)} unc.
                  </span>
                </div>

                <div className="pt-3 border-t border-white/[0.04] grid grid-cols-2 gap-2 text-[11px] text-slate-400 font-mono">
                  <div>
                    Delta:{" "}
                    <span className="text-amber-400">
                      +{fmtInr(portfolioSummary.costDelta)}
                    </span>
                  </div>
                  <div>
                    Shadow Price:{" "}
                    <span className="text-indigo-300">
                      {portfolioSummary.shadowPrice != null
                        ? `${fmtNum(portfolioSummary.shadowPrice, 2)} / ₹`
                        : "n/a"}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-4 text-center">
                <Clock size={20} className="mx-auto text-slate-600 mb-1.5" />
                <p className="text-xs text-slate-500">
                  Portfolio optimization not run yet
                </p>
                <Link
                  to={`/sessions/${sessionId}/portfolio`}
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-400 hover:text-indigo-300 mt-2"
                >
                  <span>Go to Portfolio</span>
                  <ArrowRight size={11} />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Top 3 Highest-Risk SKUs Section */}
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.08] pb-4">
          <div>
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              <AlertTriangle size={18} className="text-rose-400" />
              <span>Three Highest-Risk Inventory SKUs</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Ranked by composite stockout vulnerability, lead-time variance,
              and forecast uncertainty.
            </p>
          </div>
          <Link
            to={`/sessions/${sessionId}/optimization`}
            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1"
          >
            <span>View All SKUs in Optimization</span>
            <ArrowRight size={12} />
          </Link>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          {topRiskSkus.length > 0 ? (
            topRiskSkus.map((r, idx) => {
              const flags = r.flags || [];
              const isHigh = r.level === "high";
              const isMed = r.level === "medium";

              return (
                <div
                  key={r.skuId}
                  onClick={() => {
                    const foundSku = optData?.result?.skus?.find(
                      (s) => s.sku_id === r.skuId,
                    );
                    if (foundSku) setSelectedSkuForDrawer(foundSku);
                  }}
                  className="bg-white/[0.02] border border-white/[0.06] hover:border-white/[0.16] hover:bg-white/[0.04] transition-all rounded-xl p-4 flex flex-col justify-between cursor-pointer group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-bold font-mono text-slate-100 group-hover:text-indigo-300 transition-colors">
                        {r.skuId}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase border ${
                          isHigh
                            ? "bg-rose-500/10 text-rose-300 border-rose-500/20"
                            : isMed
                              ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                              : "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                        }`}
                      >
                        {r.level} ({r.score}/100)
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {flags.length > 0 ? (
                        flags.map((f) => (
                          <span
                            key={f.code}
                            className="px-1.5 py-0.5 bg-slate-900 border border-white/[0.06] rounded text-[10px] font-mono text-slate-400"
                            title={f.message}
                          >
                            {f.code}
                          </span>
                        ))
                      ) : (
                        <span className="text-[11px] text-slate-500 font-mono">
                          No active risk flags
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[11px] text-slate-500">
                    <span>Rank #{idx + 1} Risk Priority</span>
                    <span className="text-indigo-400 group-hover:translate-x-0.5 transition-transform">
                      &rarr;
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="col-span-3 py-6 text-center text-slate-500 text-xs font-mono">
              Risk assessment requires completing the Optimization stage.
            </div>
          )}
        </div>
      </div>

      {/* Cross-Stage Comparison Table */}
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-lg">
        <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2 border-b border-white/[0.08] pb-4">
          <Layers size={18} className="text-indigo-400" />
          <span>Cross-Policy Performance Matrix</span>
        </h2>

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-white/[0.08] text-slate-400 bg-white/[0.01]">
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Policy Name
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  Policy Mechanism
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-right">
                  Simulated Total Cost
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-right">
                  Simulated Service Level
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-right">
                  Actual Replay Total Cost
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium text-right">
                  Actual Replay Fill Rate
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {/* s_det row */}
              <tr className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-semibold text-slate-200">
                  Deterministic (s_det)
                </td>
                <td className="px-4 py-3 text-slate-400 font-sans">
                  Analytical normal safety stock (z * sigma_L)
                </td>
                <td className="px-4 py-3 text-right text-slate-200">
                  {fmtInr(policyComparisonSummary.sim?.costDet)}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {fmtPct(
                    simData?.result?.aggregate?.deterministic?.service_level ??
                      simData?.policyResults?.aggregate?.deterministic
                        ?.service_level,
                    1,
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-200">
                  {fmtInr(policyComparisonSummary.replay?.costDet)}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {fmtPct(
                    replayData?.latest?.aggregate?.deterministic?.fill_rate ??
                      replayData?.latest?.aggregate?.s_det?.fill_rate,
                    1,
                  )}
                </td>
              </tr>

              {/* s_quant row */}
              <tr className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-semibold text-slate-200 flex items-center gap-1.5">
                  <span>Quantile (s_quant)</span>
                  {policyComparisonSummary.sim?.bestPolicyId === "s_quant" && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Best Sim
                    </span>
                  )}
                  {policyComparisonSummary.replay?.bestPolicyId ===
                    "s_quant" && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                      Best Replay
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400 font-sans">
                  P10-P90 forecast spread sigma proxy + SS
                </td>
                <td className="px-4 py-3 text-right text-slate-200">
                  {fmtInr(
                    simData?.result?.aggregate?.quantile?.mean_total_cost ??
                      simData?.result?.aggregate?.s_quant?.mean_total_cost ??
                      simData?.policyResults?.aggregate?.quantile
                        ?.mean_total_cost,
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {fmtPct(
                    simData?.result?.aggregate?.quantile?.service_level ??
                      simData?.result?.aggregate?.s_quant?.service_level ??
                      simData?.policyResults?.aggregate?.quantile
                        ?.service_level,
                    1,
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-200">
                  {fmtInr(
                    replayData?.latest?.aggregate?.quantile?.total_cost ??
                      replayData?.latest?.aggregate?.s_quant?.total_cost,
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {fmtPct(
                    replayData?.latest?.aggregate?.quantile?.fill_rate ??
                      replayData?.latest?.aggregate?.s_quant?.fill_rate,
                    1,
                  )}
                </td>
              </tr>

              {/* s_emp row */}
              <tr className="hover:bg-white/[0.02]">
                <td className="px-4 py-3 font-semibold text-slate-200 flex items-center gap-1.5">
                  <span>Empirical (s_emp)</span>
                  {policyComparisonSummary.sim?.bestPolicyId === "s_emp" && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Best Sim
                    </span>
                  )}
                  {policyComparisonSummary.replay?.bestPolicyId === "s_emp" && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                      Best Replay
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-400 font-sans">
                  Bootstrap lead-time demand distribution quantile
                </td>
                <td className="px-4 py-3 text-right text-slate-200">
                  {fmtInr(
                    simData?.result?.aggregate?.uncertainty_aware
                      ?.mean_total_cost ??
                      simData?.result?.aggregate?.s_emp?.mean_total_cost ??
                      simData?.policyResults?.aggregate?.uncertainty_aware
                        ?.mean_total_cost,
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {fmtPct(
                    simData?.result?.aggregate?.uncertainty_aware
                      ?.service_level ??
                      simData?.result?.aggregate?.s_emp?.service_level ??
                      simData?.policyResults?.aggregate?.uncertainty_aware
                        ?.service_level,
                    1,
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-200">
                  {fmtInr(
                    replayData?.latest?.aggregate?.uncertainty_aware
                      ?.total_cost ??
                      replayData?.latest?.aggregate?.s_emp?.total_cost,
                  )}
                </td>
                <td className="px-4 py-3 text-right text-slate-300">
                  {fmtPct(
                    replayData?.latest?.aggregate?.uncertainty_aware
                      ?.fill_rate ??
                      replayData?.latest?.aggregate?.s_emp?.fill_rate,
                    1,
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* SkuDrawer Modal */}
      {selectedSkuForDrawer && (
        <SkuDrawer
          sku={selectedSkuForDrawer}
          risk={optData?.risk?.find(
            (r) => r.skuId === selectedSkuForDrawer.sku_id,
          )}
          skuAssumptions={null}
          onClose={() => setSelectedSkuForDrawer(null)}
        />
      )}
    </div>
  );
}
