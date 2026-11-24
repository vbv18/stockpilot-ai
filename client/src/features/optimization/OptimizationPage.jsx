import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Info,
  Loader2,
  Play,
  RefreshCw,
} from "lucide-react";
import { COPY } from "../../lib/copy.js";
import { fmtNum } from "../../lib/format.js";
import {
  useGetOptimizationQuery,
  useGetSimulationQuery,
  useStartOptimizationMutation,
} from "../../lib/api.js";
import { JobProgress } from "../jobs/JobProgress.jsx";
import { useJobTracker } from "../jobs/useJobTracker.js";
import { SkuDrawer } from "./SkuDrawer.jsx";

export default function OptimizationPage() {
  const { session } = useOutletContext();
  const navigate = useNavigate();

  const { data: optData, refetch } = useGetOptimizationQuery(session.id);
  const activeSimId = session.activeSimulationRunId;
  const { data: simData } = useGetSimulationQuery(
    { id: session.id, simulationId: activeSimId },
    { skip: !activeSimId },
  );

  // Job tracker for optimization
  const [jobId, setJobId] = useState(() => {
    return sessionStorage.getItem(`sp:job:${session.id}:optimization`) || null;
  });

  const { job } = useJobTracker(session.id, jobId, () => {
    sessionStorage.removeItem(`sp:job:${session.id}:optimization`);
    refetch();
  });

  const [startOptimization, { isLoading: isStarting }] =
    useStartOptimizationMutation();
  const [selectedSkuForDrawer, setSelectedSkuForDrawer] = useState(null);

  const canRun =
    (session.status === "assumptions_pending" ||
      session.status === "optimization_failed" ||
      session.status === "optimization_ready" ||
      optData?.stale) &&
    Boolean(session.activeAssumptionSetId);

  const handleRunOptimization = async () => {
    try {
      const res = await startOptimization(session.id).unwrap();
      const newJobId = res.jobId;
      setJobId(newJobId);
      sessionStorage.setItem(`sp:job:${session.id}:optimization`, newJobId);
    } catch (err) {
      console.error("Failed to start optimization", err);
    }
  };

  const assumptions = optData?.assumptions;
  const result = optData?.result;
  const risks = optData?.risk || [];
  const riskBySku = new Map(risks.map((r) => [r.skuId, r]));
  const simSkus = simData?.result?.skus || [];
  const simSkuBySku = new Map(simSkus.map((s) => [s.sku_id, s]));

  const okSkus = (result?.skus || []).filter((s) => s.status === "ok");
  const ineligibleSkus = (result?.skus || []).filter((s) => s.status !== "ok");

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Safety Stock & Reorder Point Optimization
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Compare deterministic normal safety stocks against uncertainty-aware
            empirical quantile reorder points.
          </p>
        </div>

        {canRun && (
          <button
            type="button"
            disabled={
              isStarting ||
              (job && (job.status === "queued" || job.status === "running"))
            }
            onClick={handleRunOptimization}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all self-start"
          >
            {isStarting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            <span>{optData ? "Re-run Optimization" : "Run Optimization"}</span>
          </button>
        )}
      </div>

      {jobId && (
        <JobProgress
          sessionId={session.id}
          job={job}
          onRetry={handleRunOptimization}
        />
      )}

      {/* Stale Warning Banner */}
      {optData?.stale && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center justify-between gap-4 text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              These results use older assumptions. Run optimization again to
              apply the latest parameters.
            </span>
          </div>
          <button
            type="button"
            onClick={handleRunOptimization}
            disabled={isStarting}
            className="px-3 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 rounded-xl font-medium shrink-0 flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw size={12} />
            <span>Re-optimize</span>
          </button>
        </div>
      )}

      {/* Policy Explainer Panel */}
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
        <h3 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
          <Info size={14} className="text-indigo-400" />
          <span>Optimization Principles & Method Definitions</span>
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-slate-400 leading-relaxed">
          <div className="flex flex-col gap-2">
            <p>
              <strong className="text-slate-200">Order Quantity:</strong>{" "}
              {COPY.eoqDef}
            </p>
            <p>
              <strong className="text-slate-200">Deterministic ROP:</strong>{" "}
              {COPY.deterministicDef}
            </p>
            <p>
              <strong className="text-slate-200">Quantile ROP:</strong>{" "}
              {COPY.quantileDef}
            </p>
            <p>
              <strong className="text-slate-200">Normal Approx:</strong>{" "}
              {COPY.normalApprox}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <p>
              <strong className="text-slate-200">Uncertainty-Aware ROP:</strong>{" "}
              {COPY.uncertaintyDef}
            </p>
            <p>
              <strong className="text-slate-200">Policy Neutrality:</strong>{" "}
              {COPY.noSuperiority}
            </p>
          </div>
        </div>
      </div>

      {/* Assumptions in Use Card */}
      {assumptions && (
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-6">
            <div>
              <span className="text-slate-500 text-[11px]">
                Assumptions Version:
              </span>
              <span className="font-mono text-slate-200 ml-1.5 font-bold">
                v{assumptions.version}
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[11px]">
                Configured SKUs:
              </span>
              <span className="font-mono text-slate-200 ml-1.5">
                {Object.keys(assumptions.skus || {}).length} SKUs
              </span>
            </div>
            <div>
              <span className="text-slate-500 text-[11px]">Policy Mode:</span>
              <span className="font-mono text-indigo-300 ml-1.5 font-medium">
                Per-SKU Parameters
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Succeeded Recommendations Table */}
      {optData && (
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-200">
                Replenishment Recommendations by SKU
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Click any row or risk badge to open detailed intermediates and
                percentiles.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead>
                <tr className="border-b border-white/[0.06] text-slate-500 bg-white/[0.01]">
                  <th scope="col" className="px-3 py-2.5 font-sans">
                    SKU
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-sans">
                    Avg Daily Demand
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-sans">
                    Annual Demand
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right font-sans text-indigo-400"
                  >
                    EOQ (Units)
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-sans">
                    Exp Lead Demand
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-sans">
                    s_det (Deterministic)
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right font-sans text-sky-400"
                  >
                    s_quant (Quantile)
                  </th>
                  <th
                    scope="col"
                    className="px-3 py-2.5 text-right font-sans text-emerald-400"
                  >
                    s_emp (Empirical)
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right font-sans">
                    Gap (Emp - Det)
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-sans text-center">
                    Risk Screen
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02] text-slate-300">
                {okSkus.map((sku) => {
                  const rk = riskBySku.get(sku.sku_id);
                  const gap = sku.rop_gap ?? 0;
                  const sDet = sku.s_det ?? sku.rop_deterministic;
                  const sQuant = sku.s_quant ?? sku.rop_quantile;
                  const sEmp = sku.s_emp ?? sku.rop_uncertainty_aware;

                  // Find best-cost policy either from simulated results or lowest inventory ROP
                  const simSku = simSkuBySku.get(sku.sku_id);
                  let bestPolicy = null;
                  if (simSku) {
                    const detC =
                      simSku.s_det?.total_cost ??
                      simSku.deterministic?.total_cost ??
                      simSku.deterministic?.total_cost_mean;
                    const quaC =
                      simSku.s_quant?.total_cost ??
                      simSku.quantile?.total_cost ??
                      simSku.quantile?.total_cost_mean;
                    const empC =
                      simSku.s_emp?.total_cost ??
                      simSku.uncertainty_aware?.total_cost ??
                      simSku.uncertainty_aware?.total_cost_mean;
                    const candidates = [
                      { id: "s_det", cost: detC },
                      { id: "s_quant", cost: quaC },
                      { id: "s_emp", cost: empC },
                    ].filter((c) => c.cost != null && !isNaN(c.cost));
                    if (candidates.length > 0) {
                      const minC = Math.min(...candidates.map((c) => c.cost));
                      bestPolicy = candidates.find(
                        (c) => Math.abs(c.cost - minC) < 1e-4,
                      )?.id;
                    }
                  } else {
                    const ropCandidates = [
                      { id: "s_det", val: sDet },
                      { id: "s_quant", val: sQuant },
                      { id: "s_emp", val: sEmp },
                    ].filter((c) => c.val != null && !isNaN(c.val));
                    if (ropCandidates.length > 0) {
                      const minVal = Math.min(
                        ...ropCandidates.map((c) => c.val),
                      );
                      bestPolicy = ropCandidates.find(
                        (c) => c.val === minVal,
                      )?.id;
                    }
                  }

                  return (
                    <tr
                      key={sku.sku_id}
                      onClick={() => setSelectedSkuForDrawer(sku)}
                      className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-3 font-medium text-slate-100">
                        {sku.sku_id}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {fmtNum(sku.avg_daily_forecast, 1)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {fmtNum(sku.annual_demand, 0)}
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-indigo-300">
                        {sku.eoq}
                      </td>
                      <td className="px-3 py-3 text-right">
                        {fmtNum(sku.mu_l, 1)}
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-200">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{sDet ?? "—"}</span>
                          {bestPolicy === "s_det" && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Best Cost
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-semibold text-sky-300">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{sQuant ?? "—"}</span>
                          {bestPolicy === "s_quant" && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Best Cost
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right font-bold text-emerald-300">
                        <div className="flex items-center justify-end gap-1.5">
                          <span>{sEmp ?? "—"}</span>
                          {bestPolicy === "s_emp" && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Best Cost
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span
                          className={`font-semibold ${
                            gap > 0
                              ? "text-amber-400"
                              : gap < 0
                                ? "text-indigo-400"
                                : "text-slate-400"
                          }`}
                        >
                          {gap > 0 ? `+${gap}` : gap}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[10px] font-sans font-medium uppercase ${
                            rk?.level === "high"
                              ? "bg-rose-500/20 text-rose-300"
                              : rk?.level === "medium"
                                ? "bg-amber-500/20 text-amber-300"
                                : "bg-emerald-500/20 text-emerald-300"
                          }`}
                        >
                          {rk?.level || "low"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Ineligible SKUs section */}
          {ineligibleSkus.length > 0 && (
            <div className="mt-4 pt-3 border-t border-white/[0.06] flex flex-col gap-2">
              <span className="text-xs font-semibold text-slate-400">
                Ineligible SKUs
              </span>
              <ul className="text-xs text-slate-500 flex flex-col gap-1">
                {ineligibleSkus.map((s) => (
                  <li key={s.sku_id}>
                    <strong className="font-mono text-slate-300">
                      {s.sku_id}
                    </strong>
                    : {s.ineligible_reason?.replace(/_/g, " ")} —{" "}
                    {s.warnings?.[0]}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="text-[11px] text-slate-500 pt-2 border-t border-white/[0.04]">
            {COPY.decisionSupport}
          </div>
        </div>
      )}

      {/* Footer Navigation */}
      {optData && (
        <div className="flex justify-end pt-2">
          <button
            type="button"
            onClick={() => navigate(`/sessions/${session.id}/simulation`)}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 cursor-pointer transition-all"
          >
            <span>Continue to Simulation</span>
            <ArrowRight size={14} />
          </button>
        </div>
      )}

      {/* SKU Drawer Component */}
      {selectedSkuForDrawer && (
        <SkuDrawer
          sku={selectedSkuForDrawer}
          risk={riskBySku.get(selectedSkuForDrawer.sku_id)}
          skuAssumptions={assumptions?.skus?.[selectedSkuForDrawer.sku_id]}
          onClose={() => setSelectedSkuForDrawer(null)}
        />
      )}
    </div>
  );
}
