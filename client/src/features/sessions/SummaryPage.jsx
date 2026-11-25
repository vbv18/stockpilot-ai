import { useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  ArrowRight,
  BarChart3,
  Clock,
  Compass,
  Layers,
  LineChart,
  RefreshCw,
  Scale,
  Sparkles,
  TrendingDown,
  Zap,
} from "lucide-react";
import {
  useGetForecastQuery,
  useGetOptimizationQuery,
  useListSimulationsQuery,
  useGetSimulationQuery,
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
    data: portData,
    isLoading: isPortLoading,
    refetch: refetchPortfolio,
  } = useGetPortfolioQuery(sessionId);

  const isAnyLoading =
    isForecastLoading ||
    isOptLoading ||
    isSimListLoading ||
    isSimLoading ||
    isPortLoading;

  const handleRefreshAll = () => {
    refetchForecast();
    refetchOptimization();
    refetchSimList();
    if (activeSimId) refetchSim();
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

    return {
      sim: simSavings,
    };
  }, [simData, simListData]);

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

        {/* KPI 5: Constrained vs Unconstrained Portfolio Cost */}
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
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* SkuDrawer Modal */}
      {selectedSkuForDrawer && (
        <SkuDrawer
          sku={selectedSkuForDrawer}
          skuAssumptions={null}
          onClose={() => setSelectedSkuForDrawer(null)}
        />
      )}
    </div>
  );
}
