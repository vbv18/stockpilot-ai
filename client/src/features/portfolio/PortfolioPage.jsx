import { useState, useEffect, useMemo } from "react";
import { Link, useOutletContext } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  DollarSign,
  Info,
  Layers,
  Loader2,
  Package,
  Play,
  RefreshCw,
  Scale,
  Zap,
} from "lucide-react";
import {
  useGetPortfolioQuery,
  useRunPortfolioMutation,
  useGetOptimizationQuery,
} from "../../lib/api.js";
import { fmtInr, fmtPct, fmtNum, fmtInt } from "../../lib/format.js";
import { useJobTracker } from "../jobs/useJobTracker.js";
import { JobProgress } from "../jobs/JobProgress.jsx";

function getHeatmapBg(val) {
  if (val === null || val === undefined || Number.isNaN(val))
    return "rgba(30, 41, 59, 0.4)";
  if (val > 0) {
    const alpha = Math.min(0.9, Math.max(0.15, Math.pow(val, 0.85) * 0.9));
    return `rgba(16, 185, 129, ${alpha.toFixed(2)})`;
  }
  if (val < 0) {
    const absVal = Math.abs(val);
    const alpha = Math.min(0.9, Math.max(0.15, Math.pow(absVal, 0.85) * 0.9));
    return `rgba(244, 63, 94, ${alpha.toFixed(2)})`;
  }
  return "rgba(30, 41, 59, 0.5)";
}

function getHeatmapText(val) {
  if (val === null || val === undefined || Number.isNaN(val))
    return "text-slate-500";
  if (Math.abs(val) >= 0.5) return "text-white font-bold";
  if (val > 0) return "text-emerald-200 font-medium";
  if (val < 0) return "text-rose-200 font-medium";
  return "text-slate-400";
}

function DemandCoMovementSection({ dependency }) {
  const [hoveredCell, setHoveredCell] = useState(null);

  if (!dependency || !dependency.correlation_matrix || !dependency.sku_order) {
    return (
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-xl flex flex-col gap-3">
        <div className="flex items-center gap-2 border-b border-white/[0.06] pb-3">
          <Layers size={16} className="text-indigo-400" />
          <h3 className="text-xs font-semibold text-slate-200">
            Demand Co-movement & Risk Pooling
          </h3>
        </div>
        <div className="p-6 text-center text-xs text-slate-500 italic">
          Run replenishment optimization to calculate weekly demand co-movement,
          cross-SKU correlations, and portfolio pooling ratio.
        </div>
      </div>
    );
  }

  const skus = dependency.sku_order;
  const matrix = dependency.correlation_matrix;
  const pairs = dependency.pairs || [];
  const poolingRatio = dependency.pooling_ratio;
  const poolingPct = (poolingRatio * 100).toFixed(1);
  const benefitPct = Math.max(0, (1 - poolingRatio) * 100).toFixed(1);

  return (
    <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-xl flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white tracking-tight">
              Demand Co-movement
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 font-mono">
              weekly Pearson R
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            15×15 weekly demand correlation matrix, pairwise
            substitution/complementarity screening (|ρ| ≥ 0.30), and portfolio
            risk pooling ratio.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-[11px] text-slate-400">Label:</span>
          <span className="px-2.5 py-1 bg-slate-900 border border-white/[0.06] text-slate-200 rounded-lg text-xs font-mono font-medium">
            demand co-movement
          </span>
        </div>
      </div>

      {/* Top Cards: Pooling Ratio & Co-movement Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pooling Ratio Card */}
        <div className="bg-[#171923] border border-indigo-500/20 rounded-2xl p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              Portfolio Pooling Ratio
            </span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-500/30">
              σ&apos; R σ
            </span>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-indigo-300">
                {poolingRatio.toFixed(4)}
              </span>
              <span className="text-xs font-mono text-slate-400">
                ({poolingPct}%)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
              Formula:{" "}
              <span className="font-mono text-slate-300">
                sqrt(σ&apos; R σ) / sum(σ_i)
              </span>
            </p>
          </div>
          <div className="pt-2 border-t border-white/[0.04] text-[11px] text-emerald-400 font-medium">
            {poolingRatio < 1.0 ? (
              <span>
                Risk pooling benefit: {benefitPct}% volatility reduction vs
                decentralized stocking
              </span>
            ) : (
              <span className="text-slate-400">
                Synchronized demand across portfolio
              </span>
            )}
          </div>
        </div>

        {/* Co-movement Pairs Card */}
        <div className="bg-[#171923] border border-white/[0.06] rounded-2xl p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              Correlated SKU Pairs
            </span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
              |ρ| ≥ 0.30
            </span>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-white">
                {pairs.length}
              </span>
              <span className="text-xs text-slate-500">
                of {(skus.length * (skus.length - 1)) / 2} pairs
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-xs">
              <span className="text-emerald-400 flex items-center gap-1 font-mono">
                <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
                {pairs.filter((p) => p.relation === "complementary").length}{" "}
                complementary
              </span>
              <span className="text-rose-400 flex items-center gap-1 font-mono">
                <span className="w-2 h-2 rounded-full bg-rose-400 inline-block" />
                {pairs.filter((p) => p.relation === "substitute-like").length}{" "}
                substitute-like
              </span>
            </div>
          </div>
          <div className="pt-2 border-t border-white/[0.04] text-[11px] text-slate-400">
            Threshold: weekly Pearson correlation |ρ| ≥ 0.30
          </div>
        </div>

        {/* Portfolio Dimension & Summary Card */}
        <div className="bg-[#171923] border border-white/[0.06] rounded-2xl p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              Matrix Dimensions
            </span>
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
              52-week panel
            </span>
          </div>
          <div className="my-2">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold font-mono text-slate-200">
                {skus.length}×{skus.length}
              </span>
              <span className="text-xs text-slate-500">correlation grid</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Evaluated on weekly aggregated demand over 365 calendar days.
            </p>
          </div>
          <div className="pt-2 border-t border-white/[0.04] text-[11px] text-slate-400">
            Diverging scale: red (substitute) ↔ green (complementary)
          </div>
        </div>
      </div>

      {/* Main Grid: Heatmap + Pairs List */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* 15x15 Heatmap Panel (2 columns wide on desktop) */}
        <div className="xl:col-span-2 bg-[#0d0f14] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
            <span className="text-xs font-semibold text-slate-300">
              15×15 Demand Correlation Heatmap
            </span>
            <span className="text-[10px] text-slate-500 font-mono">
              {hoveredCell
                ? `${hoveredCell.sku_i} ↔ ${hoveredCell.sku_j}: ρ = ${hoveredCell.rho > 0 ? "+" : ""}${hoveredCell.rho.toFixed(2)} (${hoveredCell.relation})`
                : "Hover cell to inspect pair"}
            </span>
          </div>

          {/* 15x15 CSS Grid */}
          <div className="overflow-x-auto">
            <div
              className="grid gap-1 min-w-[580px]"
              style={{
                gridTemplateColumns: `auto repeat(${skus.length}, minmax(32px, 1fr))`,
              }}
            >
              {/* Corner */}
              <div className="h-7 w-14" />

              {/* Col headers */}
              {skus.map((sku) => (
                <div
                  key={`col-${sku}`}
                  className="h-7 flex items-end justify-center pb-0.5 text-[9px] font-mono font-medium text-slate-400 truncate px-0.5"
                  title={sku}
                >
                  {sku.length > 5 ? `${sku.slice(0, 5)}…` : sku}
                </div>
              ))}

              {/* Rows */}
              {skus.map((rowSku, rowIdx) => (
                <div key={`row-group-${rowSku}`} className="contents">
                  {/* Row Header */}
                  <div className="h-7 flex items-center justify-end pr-1.5 text-[9px] font-mono font-medium text-slate-400 whitespace-nowrap">
                    {rowSku.length > 7 ? `${rowSku.slice(0, 7)}…` : rowSku}
                  </div>

                  {/* Row Cells */}
                  {skus.map((colSku, colIdx) => {
                    const val = matrix[rowIdx]?.[colIdx] ?? 0;
                    const isDiag = rowIdx === colIdx;
                    const isHovered =
                      hoveredCell &&
                      (hoveredCell.rowIdx === rowIdx ||
                        hoveredCell.colIdx === colIdx);

                    return (
                      <div
                        key={`cell-${rowSku}-${colSku}`}
                        onMouseEnter={() =>
                          setHoveredCell({
                            rowIdx,
                            colIdx,
                            sku_i: rowSku,
                            sku_j: colSku,
                            rho: val,
                            relation: isDiag
                              ? "self"
                              : Math.abs(val) >= 0.3
                                ? val > 0
                                  ? "complementary"
                                  : "substitute-like"
                                : "independent",
                          })
                        }
                        onMouseLeave={() => setHoveredCell(null)}
                        style={{
                          backgroundColor: isDiag
                            ? "rgba(99, 102, 241, 0.3)"
                            : getHeatmapBg(val),
                        }}
                        className={`h-7 flex items-center justify-center rounded text-[9px] font-mono transition-transform duration-75 select-none cursor-pointer ${
                          isHovered ? "ring-1 ring-white/60 scale-105 z-10" : ""
                        } ${getHeatmapText(val)}`}
                        title={`${rowSku} ↔ ${colSku}: ρ = ${val.toFixed(2)}`}
                      >
                        {isDiag ? "1.0" : val.toFixed(2)}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Diverging Color Scale Legend */}
          <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-400 pt-3 border-t border-white/[0.04] gap-2">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-rose-500/80 inline-block" />
              <span>Substitute-like (ρ &le; -0.30)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-slate-800 border border-slate-700 inline-block" />
              <span>Independent (-0.30 &lt; ρ &lt; +0.30)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-emerald-500/80 inline-block" />
              <span>Complementary (ρ &ge; +0.30)</span>
            </div>
          </div>
        </div>

        {/* Pairs List Panel (1 column on desktop) */}
        <div className="bg-[#0d0f14] border border-white/[0.06] rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-white/[0.04] pb-2">
            <span className="text-xs font-semibold text-slate-300">
              Co-Movement Pairs (|ρ| ≥ 0.30)
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              {pairs.length} found
            </span>
          </div>

          {pairs.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 italic">
              No SKU pairs with correlation |ρ| &ge; 0.30 detected.
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[460px] overflow-y-auto pr-1">
              {pairs.map((p, idx) => {
                const isComp = p.relation === "complementary";

                return (
                  <div
                    key={`${p.sku_i}-${p.sku_j}-${idx}`}
                    className={`p-3 rounded-xl border flex flex-col gap-1 transition-colors ${
                      isComp
                        ? "bg-emerald-500/[0.04] border-emerald-500/20 hover:bg-emerald-500/[0.08]"
                        : "bg-rose-500/[0.04] border-rose-500/20 hover:bg-rose-500/[0.08]"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-slate-200">
                        {p.sku_i} ↔ {p.sku_j}
                      </span>
                      <span
                        className={`font-mono text-xs font-bold ${
                          isComp ? "text-emerald-300" : "text-rose-300"
                        }`}
                      >
                        {p.rho > 0 ? `+${p.rho.toFixed(2)}` : p.rho.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-white/[0.04]">
                      <span
                        className={`text-[9px] font-sans font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider ${
                          isComp
                            ? "bg-emerald-500/20 text-emerald-300"
                            : "bg-rose-500/20 text-rose-300"
                        }`}
                      >
                        {p.relation}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {isComp
                          ? "Synchronized demand"
                          : "Counter-cyclical hedge"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { session, refetch: refetchSession } = useOutletContext();

  const {
    data: portfolioData,
    isLoading: isPortLoading,
    refetch: refetchPortfolio,
  } = useGetPortfolioQuery(session.id);

  const { data: optData } = useGetOptimizationQuery(session.id);
  const dependency = optData?.result?.dependency;

  const [runPortfolio, { isLoading: isStarting }] = useRunPortfolioMutation();

  const [budgetInput, setBudgetInput] = useState(session.budget ?? "");
  const [capacityInput, setCapacityInput] = useState(session.capacity ?? "");
  const [formError, setFormError] = useState("");
  const [activeJobId, setActiveJobId] = useState(null);

  // Sync inputs with session if updated
  useEffect(() => {
    if (session.budget !== undefined && session.budget !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
  const hasResult = Boolean(
    result?.constrained_plan?.skus && result.status !== "infeasible",
  );

  // Merge unconstrained, greedy, and exact SKU records for comparison table
  const skuRows = useMemo(() => {
    if (!result?.constrained_plan?.skus) return [];
    const uncMap = new Map();
    for (const u of result.unconstrained_plan?.skus || []) {
      uncMap.set(u.sku_id, u);
    }
    const greedyMap = new Map();
    for (const g of result.greedy_plan?.skus || []) {
      greedyMap.set(g.sku_id, g);
    }

    return (result.constrained_plan.skus || []).map((con) => {
      const unc = uncMap.get(con.sku_id) || {};
      const g = greedyMap.get(con.sku_id) || {};

      const greedySl =
        con.greedy_service_level ?? g.service_level ?? con.service_level;
      const exactSl = con.exact_service_level ?? con.service_level;
      const greedyRop = con.greedy_rop ?? g.rop ?? con.rop;
      const exactRop = con.exact_rop ?? con.rop;
      const greedyCost = con.greedy_cost ?? g.total_cost ?? con.total_cost;
      const exactCost = con.exact_cost ?? con.total_cost;
      const costGap = greedyCost - exactCost;
      const slDiff = exactSl - (unc.service_level ?? exactSl);

      return {
        sku_id: con.sku_id,
        unconstrained_sl: unc.service_level ?? null,
        greedy_sl: greedySl,
        exact_sl: exactSl,
        sl_diff: slDiff,
        unconstrained_rop: unc.rop ?? null,
        greedy_rop: greedyRop,
        exact_rop: exactRop,
        greedy_cost: greedyCost,
        exact_cost: exactCost,
        cost_gap: costGap,
        avg_inventory: con.avg_inventory,
        inventory_investment: con.inventory_investment,
        turnover: con.turnover,
      };
    });
  }, [result]);

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
            Allocate service levels across SKUs to minimize total expected cost
            subject to aggregate inventory budget and warehouse capacity limits.
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
              Portfolio optimization uses the empirical cost-vs-service-level
              curve evaluated for each SKU during Monte Carlo policy simulation.
              Run simulation first to proceed.
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

      {/* Infeasible Alert if status is infeasible */}
      {result?.status === "infeasible" && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-5 flex items-start gap-3.5 text-xs text-rose-300">
          <AlertCircle size={18} className="shrink-0 mt-0.5 text-rose-400" />
          <div className="flex flex-col gap-1.5">
            <span className="font-semibold text-rose-200">
              Portfolio Optimization Infeasible
            </span>
            <p className="text-rose-300/90 leading-relaxed">
              The specified portfolio resource limits cannot satisfy minimum
              inventory stocking requirements across all SKUs.
              {result.minimum_feasible_budget !== null &&
                result.minimum_feasible_budget !== undefined && (
                  <span className="block mt-1.5 font-mono text-rose-200 font-semibold">
                    Minimum feasible budget:{" "}
                    {fmtInr(result.minimum_feasible_budget)}
                  </span>
                )}
            </p>
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
              Specify max investment or max capacity. At least one constraint
              must be set to run marginal allocation.
            </p>
          </div>

          {result?.binding_constraints && (
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-slate-400">
                Binding Constraints:
              </span>
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
            Greedy marginal-cost-per-resource allocation starts from lowest
            service level and scales efficiently.
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
              {hasResult
                ? "Re-run Portfolio Optimization"
                : "Run Portfolio Optimization"}
            </span>
          </button>
        </div>
      </form>

      {/* Demand Co-movement Feature: 15x15 Heatmap, Pairs List, Pooling Ratio Card */}
      <DemandCoMovementSection dependency={dependency} />

      {/* Active Job Progress */}
      {isJobActive && <JobProgress sessionId={session.id} job={activeJob} />}

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
                  Exact Total Cost
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                    result.optimality_gap_pct &&
                    result.optimality_gap_pct > 0.001
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                      : "bg-indigo-500/10 text-indigo-300 border border-indigo-500/20"
                  }`}
                >
                  {result.optimality_gap_pct &&
                  result.optimality_gap_pct > 0.001
                    ? `${result.optimality_gap_pct.toFixed(2)}% gap vs greedy`
                    : "MILP Optimal"}
                </span>
              </div>
              <div className="my-2">
                <span className="text-2xl font-bold text-white tracking-tight font-mono">
                  {fmtInr(
                    result.exact_cost ?? result.constrained_plan.total_cost,
                  )}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-white/[0.04] pt-2">
                <span>Greedy Cost:</span>
                <span className="text-slate-200 font-mono">
                  {result.greedy_cost !== null &&
                  result.greedy_cost !== undefined
                    ? fmtInr(result.greedy_cost)
                    : fmtInr(result.unconstrained_plan.total_cost)}
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
                  {result.budget_usage_pct !== null &&
                  result.budget_usage_pct !== undefined
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
                  {result.capacity_usage_pct !== null &&
                  result.capacity_usage_pct !== undefined
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
                <span className="text-[10px] text-slate-500 font-mono">
                  B±1% central diff
                </span>
              </div>
              <div className="my-2">
                <span className="text-2xl font-bold text-white tracking-tight font-mono">
                  {(result.shadow_price ?? result.budget_shadow_price) !== 0
                    ? `${fmtNum(result.shadow_price ?? result.budget_shadow_price, 4)} / ₹`
                    : "₹0.00 / ₹"}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-white/[0.04] pt-2">
                <span>Central difference:</span>
                <span className="text-slate-200 text-[10px]">
                  {(result.shadow_price ?? result.budget_shadow_price) < 0
                    ? `₹${Math.abs(result.shadow_price ?? result.budget_shadow_price).toFixed(4)} saving per extra ₹1`
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
                (vs {fmtPct(result.unconstrained_plan.avg_service_level)}{" "}
                unconstrained)
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div className="bg-[#0d0f14] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">
                  Total Investment
                </span>
                <span className="font-mono text-white font-semibold">
                  {fmtInr(result.constrained_plan.total_inventory_investment)}
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Unconstrained:{" "}
                  {fmtInr(result.unconstrained_plan.total_inventory_investment)}
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
                <span className="text-[11px] text-slate-400">
                  Portfolio Turnover
                </span>
                <span className="font-mono text-white font-semibold">
                  {fmtNum(result.constrained_plan.turnover, 2)}x / yr
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  Unconstrained: {fmtNum(result.unconstrained_plan.turnover, 2)}
                  x / yr
                </span>
              </div>

              <div className="bg-[#0d0f14] border border-white/[0.04] rounded-xl p-3 flex flex-col gap-1">
                <span className="text-[11px] text-slate-400">
                  Total Cost Penalty
                </span>
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
                Per-SKU Policy Comparison: Greedy vs Exact MILP (
                {skuRows.length} SKUs)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Side-by-side comparison of greedy heuristic allocation vs exact
                MILP optimization across service levels, reorder points (ROP),
                inventory cost, and investment.
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0d0f14]/80">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-white/[0.08] text-slate-400 bg-white/[0.02]">
                    <th
                      scope="col"
                      className="px-3.5 py-3 font-semibold text-slate-300"
                    >
                      SKU
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-slate-300 text-center"
                    >
                      Greedy SL
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-indigo-300 text-center"
                    >
                      Exact SL
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-slate-300 text-center"
                    >
                      Greedy ROP
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-indigo-300 text-center"
                    >
                      Exact ROP
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-slate-300 text-right"
                    >
                      Greedy Cost (₹)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-indigo-300 text-right"
                    >
                      Exact Cost (₹)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-emerald-300 text-right"
                    >
                      Cost Gap (₹)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-slate-300 text-right"
                    >
                      Avg Inv (units)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-3 font-semibold text-slate-300 text-right"
                    >
                      Investment (₹)
                    </th>
                    <th
                      scope="col"
                      className="px-3.5 py-3 font-semibold text-slate-300 text-right"
                    >
                      Turnover
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04] text-slate-200 font-mono">
                  {skuRows.map((row) => {
                    const hasSavings = row.cost_gap > 0.01;

                    return (
                      <tr
                        key={row.sku_id}
                        className={`hover:bg-white/[0.02] transition-colors ${
                          hasSavings ? "bg-emerald-500/[0.02]" : ""
                        }`}
                      >
                        <td className="px-3.5 py-2.5 font-sans font-bold text-slate-100 whitespace-nowrap">
                          {row.sku_id}
                        </td>

                        {/* Greedy Service Level */}
                        <td className="px-3 py-2.5 text-center text-slate-300">
                          {fmtPct(row.greedy_sl, 0)}
                        </td>

                        {/* Exact Service Level */}
                        <td className="px-3 py-2.5 text-center font-bold text-indigo-200">
                          {fmtPct(row.exact_sl, 0)}
                        </td>

                        {/* Greedy ROP */}
                        <td className="px-3 py-2.5 text-center text-slate-400">
                          {fmtInt(row.greedy_rop)}
                        </td>

                        {/* Exact ROP */}
                        <td className="px-3 py-2.5 text-center text-indigo-300 font-bold">
                          {fmtInt(row.exact_rop)}
                        </td>

                        {/* Greedy Cost */}
                        <td className="px-3 py-2.5 text-right text-slate-300">
                          {fmtInr(row.greedy_cost)}
                        </td>

                        {/* Exact Cost */}
                        <td className="px-3 py-2.5 text-right font-bold text-white">
                          {fmtInr(row.exact_cost)}
                        </td>

                        {/* Cost Gap */}
                        <td className="px-3 py-2.5 text-right">
                          {hasSavings ? (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 font-bold">
                              -{fmtInr(row.cost_gap)}
                            </span>
                          ) : (
                            <span className="text-[10px] text-slate-500">
                              ₹0
                            </span>
                          )}
                        </td>

                        {/* Avg Inventory */}
                        <td className="px-3 py-2.5 text-right text-slate-200">
                          {fmtNum(row.avg_inventory, 1)}
                        </td>

                        {/* Investment */}
                        <td className="px-3 py-2.5 text-right text-slate-200">
                          {fmtInr(row.inventory_investment)}
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
