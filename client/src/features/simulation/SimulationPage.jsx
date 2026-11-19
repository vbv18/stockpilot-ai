import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChevronDown, ChevronUp, History, Loader2, Play } from "lucide-react";
import { COPY } from "../../lib/copy.js";
import { fmtDateTime, fmtInr, fmtNum, fmtPct, shortId } from "../../lib/format.js";
import {
  useGetOptimizationQuery,
  useGetSimulationQuery,
  useListSimulationsQuery,
  useStartSimulationMutation,
} from "../../lib/api.js";
import { JobProgress } from "../jobs/JobProgress.jsx";
import { useJobTracker } from "../jobs/useJobTracker.js";

export default function SimulationPage() {
  const { session } = useOutletContext();

  const { data: optData } = useGetOptimizationQuery(session.id);
  const { data: runsList = [], refetch: refetchList } = useListSimulationsQuery(session.id);

  const [selectedRunId, setSelectedRunId] = useState(null);
  const activeRunId = selectedRunId || (runsList.length > 0 ? runsList[0].id : null);

  const { data: simData } = useGetSimulationQuery(
    { id: session.id, simulationId: activeRunId },
    { skip: !activeRunId },
  );

  // Job tracking for simulation
  const [jobId, setJobId] = useState(() => {
    return sessionStorage.getItem(`sp:job:${session.id}:simulation`) || null;
  });

  const { job } = useJobTracker(session.id, jobId, (finishedJob) => {
    sessionStorage.removeItem(`sp:job:${session.id}:simulation`);
    refetchList();
    if (finishedJob.resultRef?.id) {
      setSelectedRunId(finishedJob.resultRef.id);
    }
  });

  const [startSimulation, { isLoading: isStarting }] = useStartSimulationMutation();

  // Run form parameters
  const [nScenarios, setNScenarios] = useState(500);
  const [horizonDays, setHorizonDays] = useState(90);
  const [seedInput, setSeedInput] = useState("");
  const [formError, setFormError] = useState("");
  const [expandedSku, setExpandedSku] = useState(null);

  const isStaleOpt = optData?.stale;

  const handleRunSimulation = async (e) => {
    e.preventDefault();
    if (isStaleOpt) return;

    if (nScenarios < 100 || nScenarios > 2000) {
      setFormError("Scenarios must be between 100 and 2000.");
      return;
    }
    if (horizonDays < 30 || horizonDays > 180) {
      setFormError("Horizon days must be between 30 and 180.");
      return;
    }

    setFormError("");
    try {
      const body = {
        nScenarios: Number(nScenarios),
        horizonDays: Number(horizonDays),
      };
      if (seedInput.trim()) {
        body.seed = Number(seedInput.trim());
      }

      const res = await startSimulation({ id: session.id, body }).unwrap();
      const newJobId = res.jobId;
      setJobId(newJobId);
      sessionStorage.setItem(`sp:job:${session.id}:simulation`, newJobId);
    } catch (err) {
      setFormError(err.data?.message || err.message || "Failed to start simulation.");
    }
  };

  const aggregate = simData?.result?.aggregate;
  const detAgg = aggregate?.deterministic;
  const empAgg = aggregate?.uncertainty_aware;
  const costDiff = aggregate?.mean_total_cost_diff_sum ?? 0;

  // Cost breakdown chart data
  const costChartData = useMemo(() => {
    if (!detAgg || !empAgg) return [];
    return [
      {
        policy: "Deterministic",
        Ordering: detAgg.ordering_cost,
        Holding: detAgg.holding_cost,
        Shortage: detAgg.shortage_cost,
      },
      {
        policy: "Uncertainty-Aware",
        Ordering: empAgg.ordering_cost,
        Holding: empAgg.holding_cost,
        Shortage: empAgg.shortage_cost,
      },
    ];
  }, [detAgg, empAgg]);

  // Service level chart data
  const slChartData = useMemo(() => {
    if (!detAgg || !empAgg) return [];
    return [
      { policy: "Deterministic", serviceLevel: detAgg.service_level * 100 },
      { policy: "Uncertainty-Aware", serviceLevel: empAgg.service_level * 100 },
    ];
  }, [detAgg, empAgg]);

  const skusList = simData?.result?.skus || [];

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Monte Carlo Simulation Comparison</h2>
        <p className="text-xs text-slate-400 mt-1">
          Common random demand scenarios evaluated under daily-review (s, S) lost-sales inventory policies.
        </p>
      </div>

      {jobId && <JobProgress sessionId={session.id} job={job} />}

      {/* Parameter Controls & Run Bar */}
      <form onSubmit={handleRunSimulation} className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-400">Scenarios (100–2000)</label>
              <input
                type="number"
                min="100"
                max="2000"
                value={nScenarios}
                onChange={(e) => setNScenarios(Number(e.target.value))}
                className="w-24 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-400">Horizon Days (30–180)</label>
              <input
                type="number"
                min="30"
                max="180"
                value={horizonDays}
                onChange={(e) => setHorizonDays(Number(e.target.value))}
                className="w-24 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 font-mono"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-400">Random Seed (Optional)</label>
              <input
                type="number"
                placeholder="random"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                className="w-28 bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-100 font-mono"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            {runsList.length > 0 && (
              <div className="flex items-center gap-2">
                <History size={14} className="text-slate-500" />
                <select
                  value={activeRunId || ""}
                  onChange={(e) => setSelectedRunId(e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 font-mono focus:outline-none"
                >
                  {runsList.map((r) => (
                    <option key={r.id} value={r.id}>
                      Run {shortId(r.id)} ({fmtDateTime(r.createdAt)})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="submit"
              disabled={isStaleOpt || isStarting || (job && (job.status === "queued" || job.status === "running"))}
              title={isStaleOpt ? "Re-run optimization for the latest assumptions first." : ""}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
            >
              {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              <span>{runsList.length > 0 ? "Run Another Simulation" : "Run Simulation"}</span>
            </button>
          </div>
        </div>

        {formError && <span className="text-xs text-rose-400">{formError}</span>}

        {isStaleOpt && (
          <span className="text-xs text-amber-400">
            Re-run optimization for the latest assumptions first.
          </span>
        )}

        <p className="text-[11px] text-slate-500 border-t border-white/[0.04] pt-2">
          {COPY.simulationDisclaimer}
        </p>
      </form>

      {/* Simulation Results View */}
      {simData && (
        <>
          {/* Side-by-side Policy Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Deterministic Card */}
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <span className="text-xs font-bold text-slate-300">Deterministic Policy (ROP_d)</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-100">{fmtInr(detAgg?.total_cost)}</span>
                <span className="text-xs text-slate-500">total cost</span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-slate-400 pt-2 border-t border-white/[0.04]">
                <div className="flex justify-between">
                  <span>Service Level (Fill Rate):</span>
                  <span className="font-mono text-slate-200 font-semibold">{fmtPct(detAgg?.service_level, 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Days Rate:</span>
                  <span className="font-mono text-slate-200">{fmtPct(detAgg?.stockout_rate_mean, 1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Avg On-Hand Inventory:</span>
                  <span className="font-mono text-slate-200">{fmtNum(detAgg?.avg_inventory, 1)} units</span>
                </div>
                <div className="flex justify-between">
                  <span>Replenishment Orders:</span>
                  <span className="font-mono text-slate-200">{fmtNum(detAgg?.order_count, 1)}</span>
                </div>
              </div>
            </div>

            {/* Difference / Neutrality Card */}
            <div className="bg-[#13151c] border border-indigo-500/20 rounded-2xl p-5 flex flex-col justify-between gap-3 text-center">
              <span className="text-xs font-semibold text-indigo-300">Cost Difference (Emp - Det)</span>
              <div>
                <span className={`text-2xl font-extrabold ${costDiff < 0 ? "text-emerald-400" : costDiff > 0 ? "text-rose-400" : "text-slate-300"}`}>
                  {costDiff > 0 ? `+${fmtInr(costDiff)}` : fmtInr(costDiff)}
                </span>
                <p className="text-[11px] text-slate-400 mt-1">
                  {costDiff < 0 ? "Uncertainty-aware saved money overall" : "Uncertainty-aware incurred higher costs"}
                </p>
              </div>
              <p className="text-[10px] text-slate-500 leading-normal">{COPY.noSuperiority}</p>
            </div>

            {/* Uncertainty-Aware Card */}
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <span className="text-xs font-bold text-emerald-400">Uncertainty-Aware Policy (ROP_u)</span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-300">{fmtInr(empAgg?.total_cost)}</span>
                <span className="text-xs text-slate-500">total cost</span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-slate-400 pt-2 border-t border-white/[0.04]">
                <div className="flex justify-between">
                  <span>Service Level (Fill Rate):</span>
                  <span className="font-mono text-emerald-300 font-semibold">{fmtPct(empAgg?.service_level, 2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Days Rate:</span>
                  <span className="font-mono text-slate-200">{fmtPct(empAgg?.stockout_rate_mean, 1)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Avg On-Hand Inventory:</span>
                  <span className="font-mono text-slate-200">{fmtNum(empAgg?.avg_inventory, 1)} units</span>
                </div>
                <div className="flex justify-between">
                  <span>Replenishment Orders:</span>
                  <span className="font-mono text-slate-200">{fmtNum(empAgg?.order_count, 1)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Charts: Cost Breakdown & Service Level */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <span className="text-xs font-semibold text-slate-300">Cost Breakdown by Component (₹)</span>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costChartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                    <XAxis dataKey="policy" stroke="#64748b" fontSize={11} />
                    <YAxis stroke="#64748b" fontSize={10} tickFormatter={(v) => `₹${v / 1000}k`} />
                    <Tooltip
                      formatter={(v) => fmtInr(v)}
                      contentStyle={{
                        backgroundColor: "#13151c",
                        borderColor: "rgba(255,255,255,0.1)",
                        borderRadius: "0.5rem",
                        fontSize: "11px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar dataKey="Ordering" stackId="a" fill="#6366f1" />
                    <Bar dataKey="Holding" stackId="a" fill="#3b82f6" />
                    <Bar dataKey="Shortage" stackId="a" fill="#f43f5e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <span className="text-xs font-semibold text-slate-300">Fill Rate Comparison (%)</span>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={slChartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                    <XAxis dataKey="policy" stroke="#64748b" fontSize={10} />
                    <YAxis domain={[90, 100]} stroke="#64748b" fontSize={10} tickFormatter={(v) => `${v}%`} />
                    <Tooltip
                      formatter={(v) => `${v.toFixed(2)}%`}
                      contentStyle={{
                        backgroundColor: "#13151c",
                        borderColor: "rgba(255,255,255,0.1)",
                        borderRadius: "0.5rem",
                        fontSize: "11px",
                      }}
                    />
                    <Bar dataKey="serviceLevel" fill="#10b981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Per-SKU Simulation Results Table */}
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
            <h3 className="text-xs font-semibold text-slate-200">Per-SKU Simulated Scenario Performance</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/[0.06] text-slate-500 bg-white/[0.01]">
                    <th scope="col" className="px-3 py-2.5 font-sans">SKU</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-sans">Total Cost (Det)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-sans text-emerald-400">Total Cost (Emp)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-sans">Mean Diff</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-sans">% Scenarios Cheaper</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-sans">Fill Rate (Det / Emp)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-sans">Stockout Units</th>
                    <th scope="col" className="px-3 py-2.5 font-sans text-center">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.02] text-slate-300">
                  {skusList.map((sku) => {
                    const diff = sku.paired?.mean_total_cost_diff ?? 0;
                    const isExpanded = expandedSku === sku.sku_id;

                    return (
                      <>
                        <tr
                          key={sku.sku_id}
                          onClick={() => setExpandedSku(isExpanded ? null : sku.sku_id)}
                          className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                        >
                          <td className="px-3 py-3 font-medium text-slate-100">{sku.sku_id}</td>
                          <td className="px-3 py-3 text-right">{fmtInr(sku.deterministic?.total_cost_mean)}</td>
                          <td className="px-3 py-3 text-right font-bold text-emerald-300">
                            {fmtInr(sku.uncertainty_aware?.total_cost_mean)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={diff < 0 ? "text-emerald-400" : diff > 0 ? "text-rose-400" : "text-slate-400"}>
                              {diff > 0 ? `+${fmtInr(diff)}` : fmtInr(diff)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {fmtPct(sku.paired?.share_scenarios_uncertainty_aware_cheaper, 1)}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {fmtPct(sku.deterministic?.service_level_mean, 1)} /{" "}
                            <span className="text-emerald-300 font-semibold">
                              {fmtPct(sku.uncertainty_aware?.service_level_mean, 1)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {fmtNum(sku.deterministic?.stockout_units_mean, 1)} / {fmtNum(sku.uncertainty_aware?.stockout_units_mean, 1)}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              className="text-slate-400 hover:text-slate-200 p-1"
                            >
                              {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr key={`${sku.sku_id}-exp`} className="bg-slate-900/40">
                            <td colSpan={8} className="px-5 py-4 text-xs font-sans text-slate-300">
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">Starting Inventory</span>
                                  <span className="font-mono text-slate-200 font-medium">{sku.start_inventory} units</span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">Deterministic P05–P95</span>
                                  <span className="font-mono text-slate-200">
                                    {fmtInr(sku.deterministic.total_cost_p05)} – {fmtInr(sku.deterministic.total_cost_p95)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">Uncertainty-Aware P05–P95</span>
                                  <span className="font-mono text-emerald-300">
                                    {fmtInr(sku.uncertainty_aware.total_cost_p05)} – {fmtInr(sku.uncertainty_aware.total_cost_p95)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">Equal Scenarios</span>
                                  <span className="font-mono text-slate-200">
                                    {fmtPct(sku.paired.share_scenarios_equal, 1)}
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Notes List */}
            {simData?.notes && (
              <div className="pt-3 border-t border-white/[0.06] flex flex-col gap-1.5 text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Simulation Methodology & Policy Notes:</span>
                <ul className="list-disc list-inside flex flex-col gap-1 text-[11px] text-slate-400">
                  {simData.notes.map((n, idx) => (
                    <li key={idx}>{n}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
