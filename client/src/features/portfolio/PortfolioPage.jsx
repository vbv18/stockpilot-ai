import { useState, useEffect, useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  DollarSign,
  Info,
  Layers,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Scale,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  useGetPortfolioQuery,
  useRunPortfolioMutation,
  useGetSimulationQuery,
} from "../../lib/api.js";
import { fmtInr, fmtPct, fmtNum, fmtInt } from "../../lib/format.js";
import { useJobTracker } from "../jobs/useJobTracker.js";
import { JobProgress } from "../jobs/JobProgress.jsx";

export default function PortfolioPage() {
  const { session, refetch: refetchSession } = useOutletContext();

  const {
    data: portfolioData,
    isLoading: isPortLoading,
    refetch: refetchPortfolio,
  } = useGetPortfolioQuery(session.id);

  const { data: simData } = useGetSimulationQuery(
    { id: session.id, simulationId: session.activeSimulationRunId },
    { skip: !session.activeSimulationRunId },
  );

  const [runPortfolio, { isLoading: isStarting }] = useRunPortfolioMutation();

  const [budgetInput, setBudgetInput] = useState(session.budget ?? "");
  const [capacityInput, setCapacityInput] = useState(session.capacity ?? "");
  const [formError, setFormError] = useState("");
  const [activeJobId, setActiveJobId] = useState(null);

  // Sync inputs with session if updated
  useEffect(() => {
    if (session.budget !== undefined && session.budget !== null) {
      setBudgetInput(session.budget);
    }
    if (session.capacity !== undefined && session.capacity !== null) {
      setCapacityInput(session.capacity);
    }
  }, [session.budget, session.capacity]);

  const { job: activeJob, isActive: isJobActive } = useJobTracker(
    session.id,
    activeJobId,
    () => {
      setActiveJobId(null);
      refetchPortfolio();
      refetchSession();
    },
  );

  const handleRun = async (e) => {
    e.preventDefault();
    setFormError("");

    const bVal =
      budgetInput === "" || budgetInput === null || budgetInput === undefined
        ? null
        : Number(budgetInput);
    const cVal =
      capacityInput === "" ||
      capacityInput === null ||
      capacityInput === undefined
        ? null
        : Number(capacityInput);

    if (bVal === null && cVal === null) {
      setFormError(
        "At least one constraint (Budget or Capacity) must be set to run portfolio optimization.",
      );
      return;
    }
    if (bVal !== null && (Number.isNaN(bVal) || bVal <= 0)) {
      setFormError("Budget must be a positive number.");
      return;
    }
    if (cVal !== null && (Number.isNaN(cVal) || cVal <= 0)) {
      setFormError("Capacity must be a positive number.");
      return;
    }

    try {
      const res = await runPortfolio({
        id: session.id,
        body: {
          budget: bVal,
          capacity: cVal,
        },
      }).unwrap();

      if (res?.data?.jobId) {
        setActiveJobId(res.data.jobId);
      }
    } catch (err) {
      setFormError(
        err?.data?.message ||
          err?.message ||
          "Failed to start portfolio optimization.",
      );
    }
  };

  const result = portfolioData?.result;
  const hasResult = Boolean(result?.constrained_plan?.skus);

  // Merge unconstrained and constrained SKU records for comparison table
  const skuRows = useMemo(() => {
    if (!hasResult) return [];
    const uncMap = new Map();
    for (const u of result.unconstrained_plan.skus || []) {
      uncMap.set(u.sku_id, u);
    }

    return (result.constrained_plan.skus || []).map((con) => {
      const unc = uncMap.get(con.sku_id) || {};
      const slDiff = con.service_level - (unc.service_level ?? con.service_level);
      const ropDiff = con.rop - (unc.rop ?? con.rop);
      const costDiff = con.total_cost - (unc.total_cost ?? con.total_cost);

      return {
        sku_id: con.sku_id,
        unconstrained_sl: unc.service_level ?? null,
        constrained_sl: con.service_level,
        sl_diff: slDiff,
        unconstrained_rop: unc.rop ?? null,
        constrained_rop: con.rop,
        rop_diff: ropDiff,
        avg_inventory: con.avg_inventory,
        inventory_investment: con.inventory_investment,
        unconstrained_cost: unc.total_cost ?? null,
        constrained_cost: con.total_cost,
        cost_diff: costDiff,
        turnover: con.turnover,
      };
    });
  }, [hasResult, result]);

  const hasSimulation = Boolean(session.activeSimulationRunId);

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
            <Scale className="text-indigo-400" size={22} />
            <span>Multi-SKU Portfolio Optimization</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Allocate service levels across SKUs to minimize total expected cost subject to aggregate inventory budget and warehouse capacity limits.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {hasResult && (
            <button
              type="button"
              onClick={() => {
                refetchPortfolio();
                refetchSession();
              }}
              className="px-3 py-1.5 bg-slate-900 border border-white/[0.08] hover:bg-slate-800 text-xs text-slate-300 rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Prerequisite Alert if simulation is missing */}
      {!hasSimulation && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-5 flex items-start gap-3.5 text-xs text-amber-300">
          <Info size={18} className="shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-amber-200">
              Policy Simulation Sweep Required
            </span>
            <p className="text-amber-300/90 leading-relaxed">
              Portfolio optimization uses the empirical cost-vs-service-level curve evaluated for each SKU during Monte Carlo policy simulation. Run simulation first to proceed.
            </p>
            <Link
              to={`/sessions/${session.id}/simulation`}
              className="inline-flex items-center gap-1.5 mt-1 font-semibold text-amber-200 hover:text-white underline underline-offset-4"
            >
              <span>Go to Policy Simulation</span>
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>
      )}

      {/* Constraints Control Card */}
      <form
        onSubmit={handleRun}
        className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-xl flex flex-col gap-5"
      >
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
          <div>
            <h3 className="text-xs font-semibold text-slate-200 flex items-center gap-2">
              <Layers size={14} className="text-indigo-400" />
              <span>Session Portfolio Constraints</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Specify max investment or max capacity. At least one constraint must be set to run marginal allocation.
            </p>
          </div>

          {result?.binding_constraints && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">Binding Constraints:</span>
              {result.binding_constraints.length === 0 ? (
                <span className="text-[11px] px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-md font-medium">
                  None (Unconstrained Feasible)
                </span>
              ) : (
                result.binding_constraints.map((c) => (
                  <span
                    key={c}
                    className="text-[11px] px-2 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-300 rounded-md font-medium capitalize"
                  >
                    {c}
                  </span>
                ))
              )}
            </div>
          )}
        </div>

        {formError && (
          <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle size={15} />
            <span>{formError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {/* Budget Constraint */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <DollarSign size={13} className="text-emerald-400" />
              <span>Budget — Max Total Inventory Investment (₹)</span>
            </label>
            <input
              type="number"
              step="any"
              min="1"
              placeholder="e.g. 500000"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              className="w-full bg-[#0d0f14] border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Constraint: sum(avg_inventory_i · unit_cost_i) ≤ budget
            </span>
          </div>

          {/* Capacity Constraint */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center gap-1.5">
              <Package size={13} className="text-sky-400" />
              <span>Capacity — Max Total Warehouse Units</span>
            </label>
            <input
              type="number"
              step="any"
              min="1"
              placeholder="e.g. 10000"
              value={capacityInput}
              onChange={(e) => setCapacityInput(e.target.value)}
              className="w-full bg-[#0d0f14] border border-slate-700 rounded-xl px-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Constraint: sum(avg_inventory_i) ≤ capacity
            </span>
          </div>
        </div>

        {/* Action Button */}
        <div className="pt-2 flex items-center justify-between border-t border-white/[0.06]">
          <span className="text-[11px] text-slate-400">
            Greedy marginal-cost-per-resource allocation starts from lowest service level and scales efficiently.
          </span>
          <button
            type="submit"
            disabled={!hasSimulation || isStarting || isJobActive}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
          >
            {isStarting || isJobActive ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            <span>
              {hasResult ? "Re-run Portfolio Optimization" : "Run Portfolio Optimization"}
            </span>
          </button>
        </div>
      </form>

      {/* Active Job Progress */}
      {isJobActive && (
        <JobProgress
          sessionId={session.id}
          job={activeJob}
        />
      )}

      {/* Loading State */}
      {isPortLoading && !hasResult && (
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-3">
          <Loader2 size={24} className="animate-spin text-indigo-400" />
          <span className="text-xs text-slate-400 font-medium">
            Loading portfolio optimization results...
          </span>
        </div>
      )}

      {/* Portfolio Result Presentation */}
      {hasResult && (
        <div className="flex flex-col gap-6">
          {/* Top Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Total Cost Card */}
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">
                  Total Expected Cost
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    result.total_cost_delta > 0.01
                      ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                      : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  }`}
                >
                  {result.total_cost_delta > 0.01
                    ? `+${fmtInr(result.total_cost_delta)} delta`
                    : "Zero Cost Delta"}
                </span>
              </div>
              <div className="my-2">
                <span className="text-2xl font-bold text-white tracking-tight font-mono">
                  {fmtInr(result.constrained_plan.total_cost)}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-white/[0.04] pt-2">
                <span>Unconstrained:</span>
                <span className="text-slate-200 font-mono">
                  {fmtInr(result.unconstrained_plan.total_cost)}
                </span>
              </div>
            </div>

            {/* Budget Usage Card */}
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">
                  Budget Usage (₹)
                </span>
                {result.budget ? (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                      result.binding_constraints.includes("budget")
                        ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                        : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    }`}
                  >
                    {result.binding_constraints.includes("budget")
                      ? "Binding"
                      : "Slack"}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500">Unbounded</span>
                )}
              </div>
              <div className="my-2">
                <span className="text-2xl font-bold text-white tracking-tight font-mono">
                  {fmtInr(result.constrained_plan.total_inventory_investment)}
                </span>
                {result.budget && (
                  <span className="text-xs text-slate-400 ml-1.5 font-mono">
                    / {fmtInr(result.budget)}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-white/[0.04] pt-2">
                <span>Utilization:</span>
                <span className="text-slate-200 font-mono">
                  {result.budget_usage_pct !== null && result.budget_usage_pct !== undefined
                    ? `${result.budget_usage_pct.toFixed(1)}%`
                    : "N/A"}
                </span>
              </div>
            </div>

            {/* Capacity Usage Card */}
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium">
                  Capacity Usage (Units)
                </span>
                {result.capacity ? (
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                      result.binding_constraints.includes("capacity")
                        ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                        : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                    }`}
                  >
                    {result.binding_constraints.includes("capacity")
                      ? "Binding"
                      : "Slack"}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-500">Unbounded</span>
                )}
              </div>
              <div className="my-2">
                <span className="text-2xl font-bold text-white tracking-tight font-mono">
                  {fmtInt(result.constrained_plan.total_units)}
                </span>
                {result.capacity && (
                  <span className="text-xs text-slate-400 ml-1.5 font-mono">
                    / {fmtInt(result.capacity)}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-white/[0.04] pt-2">
                <span>Utilization:</span>
                <span className="text-slate-200 font-mono">
                  {result.capacity_usage_pct !== null && result.capacity_usage_pct !== undefined
                    ? `${result.capacity_usage_pct.toFixed(1)}%`
                    : "N/A"}
                </span>
              </div>
            </div>

            {/* Budget Shadow Price Card */}
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col justify-between shadow-xl">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400 font-medium flex items-center gap-1.5">
                  <Zap size={13} className="text-amber-400" />
                  <span>Budget Shadow Price</span>
                </span>
                <span className="text-[10px] text-slate-500">∂Cost / ∂Budget</span>
              </div>
              <div className="my-2">
                <span className="text-2xl font-bold text-white tracking-tight font-mono">
                  {result.budget_shadow_price !== 0
                    ? `${fmtNum(result.budget_shadow_price, 4)} / ₹`
                    : "₹0.00 / ₹"}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-white/[0.04] pt-2">
                <span>Cost impact:</span>
                <span className="text-slate-200 text-[10px]">
                  {result.budget_shadow_price < 0
                    ? `₹${Math.abs(result.budget_shadow_price).toFixed(4)} saving per extra ₹1`
                    : "Budget not binding"}
                </span>
              </div>
            </div>
          </div>

          {/* Plan Comparison Summary Banner */}
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 shadow-xl flex flex-col gap-4">
            <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
              <h3 className="text-xs font-semibold text-slate-200">
                Plan Comparison Summary
              </h3>
              <span className="text-[11px] text-slate-400">
                Average Target Service Level:{" "}
                <span className="text-white font-mono font-medium">
                  {fmtPct(result.constrained_plan.avg_service_level)}
                </span>{" "}
                (vs {fmtPct(result.unconstrained_plan.avg_service_level)} unconstrained)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="bg-[#0d0f14] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Total Investment</span>
                <span className="font-mono text-white font-semibold">
                  {fmtInr(result.constrained_plan.total_inventory_investment)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Unconstrained: {fmtInr(result.unconstrained_plan.total_inventory_investment)}
                </span>
              </div>

              <div className="bg-[#0d0f14] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Total Units</span>
                <span className="font-mono text-white font-semibold">
                  {fmtInt(result.constrained_plan.total_units)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Unconstrained: {fmtInt(result.unconstrained_plan.total_units)}
                </span>
              </div>

              <div className="bg-[#0d0f14] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Portfolio Turnover</span>
                <span className="font-mono text-white font-semibold">
                  {fmtNum(result.constrained_plan.turnover, 2)}x / yr
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Unconstrained: {fmtNum(result.unconstrained_plan.turnover, 2)}x / yr
                </span>
              </div>

              <div className="bg-[#0d0f14] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">Total Cost Penalty</span>
                <span className="font-mono text-amber-300 font-semibold">
                  +{fmtInr(result.total_cost_delta)}
                </span>
                <span className="text-[10px] text-slate-500">
                  {result.unconstrained_plan.total_cost > 0
                    ? `+${((result.total_cost_delta / result.unconstrained_plan.total_cost) * 100).toFixed(2)}% over optimal`
                    : "Optimal"}
                </span>
              </div>
            </div>
          </div>

          {/* Per-SKU Comparison Table */}
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-xl flex flex-col gap-4">
            <div>
              <h3 className="text-xs font-semibold text-slate-200">
                Per-SKU Policy Comparison ({skuRows.length} SKUs)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Detailed comparison of service level, reorder point (ROP), average inventory, inventory investment, total cost, and turnover under constrained vs unconstrained solutions.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0d0f14]/80">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] text-slate-400 bg-white/[0.02]">
                    <th scope="col" className="px-3.5 py-3 font-semibold text-slate-300">
                      SKU
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-center">
                      Unconstrained SL
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-center">
                      Constrained SL
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-center">
                      SL Gap
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-center">
                      Unconstrained ROP
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-center">
                      Constrained ROP
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-right">
                      Avg Inv (units)
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-right">
                      Investment (₹)
                    </th>
                    <th scope="col" className="px-3 py-3 font-semibold text-slate-300 text-right">
                      Constrained Cost (₹)
                    </th>
                    <th scope="col" className="px-3.5 py-3 font-semibold text-slate-300 text-right">
                      Turnover
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-slate-200 font-mono">
                  {skuRows.map((row) => {
                    const isDowngraded = row.sl_diff < -0.001;

                    return (
                      <tr
                        key={row.sku_id}
                        className={`hover:bg-white/[0.02] transition-colors ${
                          isDowngraded ? "bg-amber-500/[0.02]" : ""
                        }`}
                      >
                        <td className="px-3.5 py-2.5 font-sans font-bold text-slate-100 whitespace-nowrap">
                          {row.sku_id}
                        </td>

                        {/* Unconstrained Service Level */}
                        <td className="px-3 py-2.5 text-center text-slate-300">
                          {row.unconstrained_sl !== null
                            ? fmtPct(row.unconstrained_sl, 0)
                            : "-"}
                        </td>

                        {/* Constrained Service Level */}
                        <td className="px-3 py-2.5 text-center font-bold text-white">
                          {fmtPct(row.constrained_sl, 0)}
                        </td>

                        {/* SL Gap */}
                        <td className="px-3 py-2.5 text-center">
                          {isDowngraded ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                              {fmtPct(row.sl_diff, 0)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500">
                              0%
                            </span>
                          )}
                        </td>

                        {/* Unconstrained ROP */}
                        <td className="px-3 py-2.5 text-center text-slate-400">
                          {row.unconstrained_rop !== null
                            ? fmtInt(row.unconstrained_rop)
                            : "-"}
                        </td>

                        {/* Constrained ROP */}
                        <td className="px-3 py-2.5 text-center text-indigo-300 font-bold">
                          {fmtInt(row.constrained_rop)}
                        </td>

                        {/* Avg Inventory */}
                        <td className="px-3 py-2.5 text-right text-slate-200">
                          {fmtNum(row.avg_inventory, 1)}
                        </td>

                        {/* Investment */}
                        <td className="px-3 py-2.5 text-right text-slate-200">
                          {fmtInr(row.inventory_investment)}
                        </td>

                        {/* Constrained Total Cost */}
                        <td className="px-3 py-2.5 text-right font-semibold text-white">
                          {fmtInr(row.constrained_cost)}
                        </td>

                        {/* Turnover */}
                        <td className="px-3.5 py-2.5 text-right text-emerald-400 font-semibold">
                          {fmtNum(row.turnover, 2)}x
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
