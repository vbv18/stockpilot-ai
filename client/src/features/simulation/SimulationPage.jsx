import { useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import { COPY } from "../../lib/copy.js";
import {
  fmtDateTime,
  fmtInr,
  fmtNum,
  fmtPct,
  shortId,
} from "../../lib/format.js";
import {
  useGetOptimizationQuery,
  useGetReplayQuery,
  useGetSimulationQuery,
  useListSimulationsQuery,
  useStartReplayMutation,
  useStartSimulationMutation,
} from "../../lib/api.js";
import { JobProgress } from "../jobs/JobProgress.jsx";
import { useJobTracker } from "../jobs/useJobTracker.js";

function CostVsFillRateChart({ skuId, sweep }) {
  const [xAxisMode, setXAxisMode] = useState("fill_rate"); // "fill_rate" | "service_level"

  const fillRateData = useMemo(() => {
    if (!sweep) return [];
    const points = [];
    (sweep.deterministic || []).forEach((p) => {
      points.push({
        x: +(p.fill_rate * 100).toFixed(2),
        fillRate: +(p.fill_rate * 100).toFixed(2),
        serviceLevel: p.service_level,
        detCost: p.total_cost,
      });
    });
    (sweep.quantile || []).forEach((p) => {
      points.push({
        x: +(p.fill_rate * 100).toFixed(2),
        fillRate: +(p.fill_rate * 100).toFixed(2),
        serviceLevel: p.service_level,
        quaCost: p.total_cost,
      });
    });
    (sweep.uncertainty_aware || []).forEach((p) => {
      points.push({
        x: +(p.fill_rate * 100).toFixed(2),
        fillRate: +(p.fill_rate * 100).toFixed(2),
        serviceLevel: p.service_level,
        empCost: p.total_cost,
      });
    });
    return points.sort((a, b) => a.x - b.x);
  }, [sweep]);

  const serviceLevelData = useMemo(() => {
    if (!sweep) return [];
    const detList = sweep.deterministic || [];
    const empList = sweep.uncertainty_aware || [];
    const quaList = sweep.quantile || [];
    const count = Math.max(detList.length, empList.length, quaList.length);
    const rows = [];
    for (let i = 0; i < count; i++) {
      const sl =
        detList[i]?.service_level ??
        empList[i]?.service_level ??
        quaList[i]?.service_level ??
        0.8 + i * 0.02;
      rows.push({
        x: `${Math.round(sl * 100)}%`,
        serviceLevel: sl,
        serviceLevelPct: `${Math.round(sl * 100)}%`,
        detCost: detList[i]?.total_cost ?? null,
        detFillRate:
          detList[i]?.fill_rate != null
            ? +(detList[i].fill_rate * 100).toFixed(2)
            : null,
        empCost: empList[i]?.total_cost ?? null,
        empFillRate:
          empList[i]?.fill_rate != null
            ? +(empList[i].fill_rate * 100).toFixed(2)
            : null,
        quaCost: quaList[i]?.total_cost ?? null,
        quaFillRate:
          quaList[i]?.fill_rate != null
            ? +(quaList[i].fill_rate * 100).toFixed(2)
            : null,
      });
    }
    return rows;
  }, [sweep]);

  const activeData =
    xAxisMode === "fill_rate" ? fillRateData : serviceLevelData;

  if (
    !sweep ||
    (!sweep.deterministic?.length && !sweep.uncertainty_aware?.length)
  ) {
    return (
      <div className="p-4 text-center text-xs text-slate-500 italic">
        No service level sweep data available for {skuId}.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-200">
            Cost vs. Fill Rate Tradeoff Curve — {skuId}
          </span>
          <span className="text-[10px] text-slate-500 font-mono">
            (Sweep 80%–98% in 2% steps)
          </span>
        </div>
        <div className="flex items-center gap-1 bg-slate-900/80 p-0.5 rounded-lg border border-white/[0.06]">
          <button
            type="button"
            onClick={() => setXAxisMode("fill_rate")}
            className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors cursor-pointer ${
              xAxisMode === "fill_rate"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Fill Rate X-Axis
          </button>
          <button
            type="button"
            onClick={() => setXAxisMode("service_level")}
            className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors cursor-pointer ${
              xAxisMode === "service_level"
                ? "bg-indigo-600 text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Service Level X-Axis
          </button>
        </div>
      </div>

      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={activeData}
            margin={{ top: 10, right: 20, left: 10, bottom: 15 }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#334155"
              opacity={0.3}
            />
            {xAxisMode === "fill_rate" ? (
              <XAxis
                dataKey="x"
                type="number"
                domain={["dataMin - 0.5", "dataMax + 0.5"]}
                stroke="#64748b"
                fontSize={10}
                tickFormatter={(v) => `${v}%`}
                label={{
                  value: "Simulated Fill Rate (%)",
                  position: "insideBottom",
                  offset: -5,
                  fill: "#64748b",
                  fontSize: 10,
                }}
              />
            ) : (
              <XAxis
                dataKey="x"
                stroke="#64748b"
                fontSize={10}
                label={{
                  value: "Target Service Level",
                  position: "insideBottom",
                  offset: -5,
                  fill: "#64748b",
                  fontSize: 10,
                }}
              />
            )}
            <YAxis
              stroke="#64748b"
              fontSize={10}
              tickFormatter={(v) =>
                `₹${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`
              }
              label={{
                value: "Total Cost (₹)",
                angle: -90,
                position: "insideLeft",
                fill: "#64748b",
                fontSize: 10,
              }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const p = payload[0]?.payload;
                return (
                  <div className="bg-[#13151c] border border-white/[0.1] rounded-xl p-3 text-xs shadow-xl flex flex-col gap-1.5 min-w-[200px]">
                    <span className="font-semibold text-slate-200 border-b border-white/[0.06] pb-1">
                      {skuId} —{" "}
                      {xAxisMode === "fill_rate"
                        ? `Fill Rate: ${p?.fillRate}%`
                        : `Target Service Level: ${p?.serviceLevelPct}`}
                    </span>
                    {payload.map((entry, idx) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center gap-3"
                      >
                        <span
                          style={{ color: entry.color }}
                          className="font-medium"
                        >
                          {entry.name}:
                        </span>
                        <span className="font-mono text-slate-100 font-bold">
                          {fmtInr(entry.value)}
                        </span>
                      </div>
                    ))}
                    {p?.serviceLevel && (
                      <span className="text-[10px] text-slate-400 pt-1 border-t border-white/[0.04]">
                        Target SL: {Math.round(p.serviceLevel * 100)}%
                      </span>
                    )}
                  </div>
                );
              }}
            />
            <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
            <Line
              type="monotone"
              dataKey="detCost"
              name="Deterministic"
              stroke="#94a3b8"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={true}
            />
            <Line
              type="monotone"
              dataKey="quaCost"
              name="Quantile"
              stroke="#38bdf8"
              strokeWidth={2}
              dot={{ r: 3 }}
              connectNulls={true}
            />
            <Line
              type="monotone"
              dataKey="empCost"
              name="Uncertainty-Aware"
              stroke="#10b981"
              strokeWidth={2.5}
              dot={{ r: 3 }}
              connectNulls={true}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function SimulationPage() {
  const { session } = useOutletContext();

  const { data: optData } = useGetOptimizationQuery(session.id);
  const { data: runsList = [], refetch: refetchList } = useListSimulationsQuery(
    session.id,
  );

  const [selectedRunId, setSelectedRunId] = useState(null);
  const activeRunId =
    selectedRunId || (runsList.length > 0 ? runsList[0].id : null);

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

  const [startSimulation, { isLoading: isStarting }] =
    useStartSimulationMutation();

  // Replay query and mutation
  const { data: replayData, refetch: refetchReplay } = useGetReplayQuery(
    session.id,
  );
  const [startReplay, { isLoading: isStartingReplay }] =
    useStartReplayMutation();
  const [replayError, setReplayError] = useState("");

  const [replayJobId, setReplayJobId] = useState(() => {
    return sessionStorage.getItem(`sp:job:${session.id}:replay`) || null;
  });

  const { job: replayJob } = useJobTracker(session.id, replayJobId, () => {
    sessionStorage.removeItem(`sp:job:${session.id}:replay`);
    refetchReplay();
  });

  const handleRunReplay = async () => {
    setReplayError("");
    try {
      const res = await startReplay({ id: session.id, body: {} }).unwrap();
      const newJobId = res.jobId;
      setReplayJobId(newJobId);
      sessionStorage.setItem(`sp:job:${session.id}:replay`, newJobId);
    } catch (err) {
      setReplayError(
        err.data?.message || err.message || "Failed to start replay.",
      );
    }
  };

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
      setFormError(
        err.data?.message || err.message || "Failed to start simulation.",
      );
    }
  };

  const aggregate = simData?.result?.aggregate;
  const detAgg = aggregate?.deterministic || aggregate?.s_det;
  const empAgg = aggregate?.uncertainty_aware || aggregate?.s_emp;
  const quaAgg = aggregate?.quantile || aggregate?.s_quant;
  const costDiff = aggregate?.mean_total_cost_diff_sum ?? 0;

  const simAggCosts = [
    { id: "det", cost: detAgg?.total_cost },
    { id: "qua", cost: quaAgg?.total_cost },
    { id: "emp", cost: empAgg?.total_cost },
  ].filter((c) => c.cost != null && !isNaN(c.cost));
  const minSimAggCost =
    simAggCosts.length > 0 ? Math.min(...simAggCosts.map((c) => c.cost)) : null;
  const bestSimAggPolicy =
    minSimAggCost != null
      ? simAggCosts.find((c) => Math.abs(c.cost - minSimAggCost) < 1e-4)?.id
      : null;

  // Cost breakdown chart data
  const costChartData = useMemo(() => {
    if (!detAgg || !empAgg) return [];
    const items = [
      {
        policy: "Deterministic",
        Ordering: detAgg.ordering_cost,
        Holding: detAgg.holding_cost,
        Shortage: detAgg.shortage_cost,
      },
    ];
    if (quaAgg) {
      items.push({
        policy: "Quantile",
        Ordering: quaAgg.ordering_cost,
        Holding: quaAgg.holding_cost,
        Shortage: quaAgg.shortage_cost,
      });
    }
    items.push({
      policy: "Uncertainty-Aware",
      Ordering: empAgg.ordering_cost,
      Holding: empAgg.holding_cost,
      Shortage: empAgg.shortage_cost,
    });
    return items;
  }, [detAgg, quaAgg, empAgg]);

  // Service level chart data
  const slChartData = useMemo(() => {
    if (!detAgg || !empAgg) return [];
    const items = [
      { policy: "Deterministic", serviceLevel: detAgg.service_level * 100 },
    ];
    if (quaAgg) {
      items.push({
        policy: "Quantile",
        serviceLevel: quaAgg.service_level * 100,
      });
    }
    items.push({
      policy: "Uncertainty-Aware",
      serviceLevel: empAgg.service_level * 100,
    });
    return items;
  }, [detAgg, quaAgg, empAgg]);

  // Stockout chart data
  const stockoutChartData = useMemo(() => {
    if (!detAgg || !empAgg) return [];
    const items = [
      { policy: "Deterministic", stockoutUnits: detAgg.stockout_units },
    ];
    if (quaAgg) {
      items.push({ policy: "Quantile", stockoutUnits: quaAgg.stockout_units });
    }
    items.push({
      policy: "Uncertainty-Aware",
      stockoutUnits: empAgg.stockout_units,
    });
    return items;
  }, [detAgg, quaAgg, empAgg]);

  const skusList = useMemo(() => simData?.result?.skus || [], [simData]);
  const sweepBySku = simData?.sweep || simData?.result?.sweep || {};
  const [selectedChartSku, setSelectedChartSku] = useState(null);
  const chartSkuId = selectedChartSku || (skusList[0]?.sku_id ?? null);
  const activeSkuObj = skusList.find((s) => s.sku_id === chartSkuId);
  const activeSkuSweep = activeSkuObj?.sweep || sweepBySku[chartSkuId];

  const replayRun = replayData?.latest;
  const replayAgg = replayRun?.aggregate;
  const replaySkus = replayRun?.skus || [];
  const replayDet =
    replayAgg?.s_det || replayAgg?.deterministic || replayAgg?.det;
  const replayQua = replayAgg?.s_quant || replayAgg?.quantile;
  const replayEmp =
    replayAgg?.s_emp || replayAgg?.uncertainty_aware || replayAgg?.unc;
  const hasReplay = replayRun && replayRun.status === "succeeded";

  const replayAggCosts = [
    { id: "det", cost: replayDet?.total_cost },
    { id: "qua", cost: replayQua?.total_cost },
    { id: "emp", cost: replayEmp?.total_cost },
  ].filter((c) => c.cost != null && !isNaN(c.cost));
  const minReplayAggCost =
    replayAggCosts.length > 0
      ? Math.min(...replayAggCosts.map((c) => c.cost))
      : null;
  const bestReplayAggPolicy =
    minReplayAggCost != null
      ? replayAggCosts.find((c) => Math.abs(c.cost - minReplayAggCost) < 1e-4)
          ?.id
      : null;

  const simSkuMap = useMemo(() => {
    const map = new Map();
    for (const s of skusList) {
      map.set(s.sku_id, s);
    }
    return map;
  }, [skusList]);

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Monte Carlo Simulation Comparison
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Common random demand scenarios evaluated under daily-review (s, S)
          lost-sales inventory policies.
        </p>
      </div>

      {jobId && <JobProgress sessionId={session.id} job={job} />}

      {/* Parameter Controls & Run Bar */}
      <form
        onSubmit={handleRunSimulation}
        className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl"
      >
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-slate-400">
                Scenarios (100–2000)
              </label>
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
              <label className="text-[11px] font-medium text-slate-400">
                Horizon Days (30–180)
              </label>
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
              <label className="text-[11px] font-medium text-slate-400">
                Random Seed (Optional)
              </label>
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
              disabled={
                isStaleOpt ||
                isStarting ||
                (job && (job.status === "queued" || job.status === "running"))
              }
              title={
                isStaleOpt
                  ? "Re-run optimization for the latest assumptions first."
                  : ""
              }
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
            >
              {isStarting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              <span>
                {runsList.length > 0
                  ? "Run Another Simulation"
                  : "Run Simulation"}
              </span>
            </button>
          </div>
        </div>

        {formError && (
          <span className="text-xs text-rose-400">{formError}</span>
        )}

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
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  Deterministic Policy (s_det)
                </span>
                {bestSimAggPolicy === "det" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Best Cost
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-slate-100">
                  {fmtInr(detAgg?.total_cost)}
                </span>
                <span className="text-xs text-slate-500">total cost</span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-slate-400 pt-2 border-t border-white/[0.04]">
                <div className="flex justify-between">
                  <span>Fill Rate:</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {fmtPct(detAgg?.fill_rate ?? detAgg?.service_level, 2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cycle Service Level (CSL):</span>
                  <span className="font-mono text-slate-200 font-semibold">
                    {fmtPct(detAgg?.CSL ?? detAgg?.csl, 2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Days Rate:</span>
                  <span className="font-mono text-slate-200">
                    {fmtPct(
                      detAgg?.stockout_day_rate ?? detAgg?.stockout_rate_mean,
                      1,
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Units:</span>
                  <span className="font-mono text-slate-200">
                    {fmtNum(detAgg?.stockout_units, 1)} units
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Avg On-Hand Inventory:</span>
                  <span className="font-mono text-slate-200">
                    {fmtNum(detAgg?.avg_inventory, 1)} units
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Replenishment Orders:</span>
                  <span className="font-mono text-slate-200">
                    {fmtNum(detAgg?.order_count, 1)}
                  </span>
                </div>
              </div>
            </div>

            {/* Quantile Policy Card */}
            <div className="bg-[#13151c] border border-sky-500/20 rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-sky-400">
                  Quantile Policy (s_quant)
                </span>
                {bestSimAggPolicy === "qua" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Best Cost
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-sky-300">
                  {quaAgg ? fmtInr(quaAgg.total_cost) : "—"}
                </span>
                <span className="text-xs text-slate-500">total cost</span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-slate-400 pt-2 border-t border-white/[0.04]">
                <div className="flex justify-between">
                  <span>Fill Rate:</span>
                  <span className="font-mono text-sky-300 font-semibold">
                    {quaAgg
                      ? fmtPct(quaAgg.fill_rate ?? quaAgg.service_level, 2)
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cycle Service Level (CSL):</span>
                  <span className="font-mono text-sky-300 font-semibold">
                    {quaAgg ? fmtPct(quaAgg.CSL ?? quaAgg.csl, 2) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Days Rate:</span>
                  <span className="font-mono text-slate-200">
                    {quaAgg
                      ? fmtPct(
                          quaAgg.stockout_day_rate ?? quaAgg.stockout_rate_mean,
                          1,
                        )
                      : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Units:</span>
                  <span className="font-mono text-slate-200">
                    {quaAgg ? `${fmtNum(quaAgg.stockout_units, 1)} units` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Avg On-Hand Inventory:</span>
                  <span className="font-mono text-slate-200">
                    {quaAgg ? `${fmtNum(quaAgg.avg_inventory, 1)} units` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Replenishment Orders:</span>
                  <span className="font-mono text-slate-200">
                    {quaAgg ? fmtNum(quaAgg.order_count, 1) : "—"}
                  </span>
                </div>
              </div>
            </div>

            {/* Uncertainty-Aware Card */}
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-400">
                  Uncertainty-Aware Policy (s_emp)
                </span>
                {bestSimAggPolicy === "emp" && (
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    Best Cost
                  </span>
                )}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-300">
                  {fmtInr(empAgg?.total_cost)}
                </span>
                <span className="text-xs text-slate-500">total cost</span>
              </div>
              <div className="flex flex-col gap-1.5 text-xs text-slate-400 pt-2 border-t border-white/[0.04]">
                <div className="flex justify-between">
                  <span>Fill Rate:</span>
                  <span className="font-mono text-emerald-300 font-semibold">
                    {fmtPct(empAgg?.fill_rate ?? empAgg?.service_level, 2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Cycle Service Level (CSL):</span>
                  <span className="font-mono text-emerald-300 font-semibold">
                    {fmtPct(empAgg?.CSL ?? empAgg?.csl, 2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Days Rate:</span>
                  <span className="font-mono text-slate-200">
                    {fmtPct(
                      empAgg?.stockout_day_rate ?? empAgg?.stockout_rate_mean,
                      1,
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Stockout Units:</span>
                  <span className="font-mono text-slate-200">
                    {fmtNum(empAgg?.stockout_units, 1)} units
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Avg On-Hand Inventory:</span>
                  <span className="font-mono text-slate-200">
                    {fmtNum(empAgg?.avg_inventory, 1)} units
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Replenishment Orders:</span>
                  <span className="font-mono text-slate-200">
                    {fmtNum(empAgg?.order_count, 1)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Difference / Neutrality Banner */}
          <div className="bg-[#13151c] border border-indigo-500/20 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
            <div>
              <span className="text-xs font-semibold text-indigo-300">
                Cost Difference (Emp - Det):
              </span>
              <span
                className={`text-sm font-bold ml-2 ${costDiff < 0 ? "text-emerald-400" : costDiff > 0 ? "text-rose-400" : "text-slate-300"}`}
              >
                {costDiff > 0 ? `+${fmtInr(costDiff)}` : fmtInr(costDiff)}
              </span>
              <span className="text-[11px] text-slate-400 ml-2">
                (
                {costDiff < 0
                  ? "Uncertainty-aware saved money overall"
                  : "Uncertainty-aware incurred higher costs"}
                )
              </span>
            </div>
            <p className="text-[10px] text-slate-500 max-w-md">
              {COPY.noSuperiority}
            </p>
          </div>

          {/* Charts: Cost Breakdown, Service Level & Stockout Units */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <span className="text-xs font-semibold text-slate-300">
                Cost Breakdown by Component (₹)
              </span>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={costChartData}
                    margin={{ top: 10, right: 10, left: 10, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#334155"
                      opacity={0.3}
                    />
                    <XAxis dataKey="policy" stroke="#64748b" fontSize={10} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={10}
                      tickFormatter={(v) => `₹${v / 1000}k`}
                    />
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
              <span className="text-xs font-semibold text-slate-300">
                Fill Rate Comparison (%)
              </span>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={slChartData}
                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#334155"
                      opacity={0.3}
                    />
                    <XAxis dataKey="policy" stroke="#64748b" fontSize={10} />
                    <YAxis
                      domain={[80, 100]}
                      stroke="#64748b"
                      fontSize={10}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <Tooltip
                      formatter={(v) => `${v.toFixed(2)}%`}
                      contentStyle={{
                        backgroundColor: "#13151c",
                        borderColor: "rgba(255,255,255,0.1)",
                        borderRadius: "0.5rem",
                        fontSize: "11px",
                      }}
                    />
                    <Bar
                      dataKey="serviceLevel"
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <span className="text-xs font-semibold text-slate-300">
                Stockout Units Comparison
              </span>
              <div className="h-60 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={stockoutChartData}
                    margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="#334155"
                      opacity={0.3}
                    />
                    <XAxis dataKey="policy" stroke="#64748b" fontSize={10} />
                    <YAxis
                      stroke="#64748b"
                      fontSize={10}
                      tickFormatter={(v) => fmtNum(v, 0)}
                    />
                    <Tooltip
                      formatter={(v) => `${fmtNum(v, 1)} units`}
                      contentStyle={{
                        backgroundColor: "#13151c",
                        borderColor: "rgba(255,255,255,0.1)",
                        borderRadius: "0.5rem",
                        fontSize: "11px",
                      }}
                    />
                    <Bar
                      dataKey="stockoutUnits"
                      fill="#f43f5e"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Per-SKU Cost vs Fill Rate Tradeoff Curves */}
          {skusList.length > 0 && (
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
                <div>
                  <h3 className="text-xs font-semibold text-slate-200">
                    Cost vs. Fill Rate Tradeoff Curves
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Service level sweep (0.80–0.99 in 0.02 steps) evaluating ROP
                    and paired simulation across inventory policies.
                  </p>
                </div>
                {skusList.length > 1 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {skusList.map((s) => (
                      <button
                        key={s.sku_id}
                        type="button"
                        onClick={() => setSelectedChartSku(s.sku_id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-colors cursor-pointer ${
                          chartSkuId === s.sku_id
                            ? "bg-indigo-600 text-white shadow-sm"
                            : "bg-slate-900 text-slate-400 hover:text-slate-200 border border-white/[0.04]"
                        }`}
                      >
                        {s.sku_id}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <CostVsFillRateChart skuId={chartSkuId} sweep={activeSkuSweep} />
            </div>
          )}

          {/* Per-SKU Simulation Results Table */}
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
            <h3 className="text-xs font-semibold text-slate-200">
              Per-SKU Simulated Scenario Performance
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead>
                  <tr className="border-b border-white/[0.06] text-slate-500 bg-white/[0.01]">
                    <th scope="col" className="px-3 py-2.5 font-sans">
                      SKU
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right font-sans"
                    >
                      Deterministic (s_det)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right font-sans text-sky-400"
                    >
                      Quantile (s_quant)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right font-sans text-emerald-400"
                    >
                      Empirical (s_emp)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right font-sans"
                    >
                      Mean Diff (Emp - Det)
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 text-right font-sans"
                    >
                      % Cheaper
                    </th>
                    <th
                      scope="col"
                      className="px-3 py-2.5 font-sans text-center"
                    >
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.02] text-slate-300">
                  {skusList.map((sku) => {
                    const diff = sku.paired?.mean_total_cost_diff ?? 0;
                    const isExpanded = expandedSku === sku.sku_id;
                    const pDet = sku.s_det || sku.deterministic;
                    const pQua = sku.s_quant || sku.quantile;
                    const pEmp = sku.s_emp || sku.uncertainty_aware;

                    const skuCosts = [
                      {
                        id: "det",
                        cost: pDet?.total_cost ?? pDet?.total_cost_mean,
                      },
                      {
                        id: "qua",
                        cost: pQua?.total_cost ?? pQua?.total_cost_mean,
                      },
                      {
                        id: "emp",
                        cost: pEmp?.total_cost ?? pEmp?.total_cost_mean,
                      },
                    ].filter((c) => c.cost != null && !isNaN(c.cost));
                    const minSkuCost =
                      skuCosts.length > 0
                        ? Math.min(...skuCosts.map((c) => c.cost))
                        : null;
                    const bestSkuPolicy =
                      minSkuCost != null
                        ? skuCosts.find(
                            (c) => Math.abs(c.cost - minSkuCost) < 1e-4,
                          )?.id
                        : null;

                    return (
                      <>
                        <tr
                          key={sku.sku_id}
                          onClick={() =>
                            setExpandedSku(isExpanded ? null : sku.sku_id)
                          }
                          className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                        >
                          <td className="px-3 py-3 font-medium text-slate-100">
                            {sku.sku_id}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-slate-100">
                                  {fmtInr(
                                    pDet?.total_cost ?? pDet?.total_cost_mean,
                                  )}
                                </span>
                                {bestSkuPolicy === "det" && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    Best Cost
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-slate-400 font-sans">
                                Fill:{" "}
                                {fmtPct(
                                  pDet?.fill_rate ?? pDet?.service_level_mean,
                                  1,
                                )}{" "}
                                · CSL:{" "}
                                {fmtPct(
                                  pDet?.CSL ?? pDet?.csl ?? pDet?.csl_mean,
                                  1,
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 font-sans">
                                Stockout:{" "}
                                {fmtPct(
                                  pDet?.stockout_day_rate ??
                                    pDet?.stockout_rate_mean,
                                  1,
                                )}{" "}
                                ({fmtNum(pDet?.stockout_units_mean, 0)} u)
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {pQua ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-sky-300">
                                    {fmtInr(
                                      pQua.total_cost ?? pQua.total_cost_mean,
                                    )}
                                  </span>
                                  {bestSkuPolicy === "qua" && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      Best Cost
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-sky-400/80 font-sans">
                                  Fill:{" "}
                                  {fmtPct(
                                    pQua.fill_rate ?? pQua.service_level_mean,
                                    1,
                                  )}{" "}
                                  · CSL:{" "}
                                  {fmtPct(
                                    pQua.CSL ?? pQua.csl ?? pQua.csl_mean,
                                    1,
                                  )}
                                </div>
                                <div className="text-[10px] text-slate-500 font-sans">
                                  Stockout:{" "}
                                  {fmtPct(
                                    pQua.stockout_day_rate ??
                                      pQua.stockout_rate_mean,
                                    1,
                                  )}{" "}
                                  ({fmtNum(pQua.stockout_units_mean, 0)} u)
                                </div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex flex-col items-end gap-0.5">
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-emerald-300">
                                  {fmtInr(
                                    pEmp?.total_cost ?? pEmp?.total_cost_mean,
                                  )}
                                </span>
                                {bestSkuPolicy === "emp" && (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                    Best Cost
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-emerald-400/80 font-sans">
                                Fill:{" "}
                                {fmtPct(
                                  pEmp?.fill_rate ?? pEmp?.service_level_mean,
                                  1,
                                )}{" "}
                                · CSL:{" "}
                                {fmtPct(
                                  pEmp?.CSL ?? pEmp?.csl ?? pEmp?.csl_mean,
                                  1,
                                )}
                              </div>
                              <div className="text-[10px] text-slate-500 font-sans">
                                Stockout:{" "}
                                {fmtPct(
                                  pEmp?.stockout_day_rate ??
                                    pEmp?.stockout_rate_mean,
                                  1,
                                )}{" "}
                                ({fmtNum(pEmp?.stockout_units_mean, 0)} u)
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span
                              className={
                                diff < 0
                                  ? "text-emerald-400 font-semibold"
                                  : diff > 0
                                    ? "text-rose-400 font-semibold"
                                    : "text-slate-400"
                              }
                            >
                              {diff > 0 ? `+${fmtInr(diff)}` : fmtInr(diff)}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            {fmtPct(
                              sku.paired
                                ?.share_scenarios_uncertainty_aware_cheaper,
                              1,
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <button
                              type="button"
                              className="text-slate-400 hover:text-slate-200 p-1"
                            >
                              {isExpanded ? (
                                <ChevronUp size={14} />
                              ) : (
                                <ChevronDown size={14} />
                              )}
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr
                            key={`${sku.sku_id}-exp`}
                            className="bg-slate-900/40"
                          >
                            <td
                              colSpan={7}
                              className="px-5 py-4 text-xs font-sans text-slate-300"
                            >
                              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">
                                    Starting Inventory
                                  </span>
                                  <span className="font-mono text-slate-200 font-medium">
                                    {sku.start_inventory} units
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">
                                    Deterministic P05–P95
                                  </span>
                                  <span className="font-mono text-slate-200">
                                    {fmtInr(sku.deterministic.total_cost_p05)} –{" "}
                                    {fmtInr(sku.deterministic.total_cost_p95)}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">
                                    Quantile P05–P95
                                  </span>
                                  <span className="font-mono text-sky-300">
                                    {sku.quantile
                                      ? `${fmtInr(sku.quantile.total_cost_p05)} – ${fmtInr(sku.quantile.total_cost_p95)}`
                                      : "—"}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">
                                    Uncertainty-Aware P05–P95
                                  </span>
                                  <span className="font-mono text-emerald-300">
                                    {fmtInr(
                                      sku.uncertainty_aware.total_cost_p05,
                                    )}{" "}
                                    –{" "}
                                    {fmtInr(
                                      sku.uncertainty_aware.total_cost_p95,
                                    )}
                                  </span>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 block uppercase">
                                    Equal Scenarios
                                  </span>
                                  <span className="font-mono text-slate-200">
                                    {fmtPct(
                                      sku.paired.share_scenarios_equal,
                                      1,
                                    )}
                                  </span>
                                </div>
                              </div>

                              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                                <CostVsFillRateChart
                                  skuId={sku.sku_id}
                                  sweep={sku.sweep || sweepBySku[sku.sku_id]}
                                />
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
                <span className="font-semibold text-slate-300">
                  Simulation Methodology & Policy Notes:
                </span>
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

      {/* ========================================================================= */}
      {/* Replay on Actual Demand Panel                                             */}
      {/* ========================================================================= */}
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-5 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-bold text-white tracking-tight">
                Replay on actual demand
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                Out-of-sample ground truth
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-3xl">
              Holds out the last 28 days of actual demand; fits the forecast and
              sets EOQ and each policy on earlier days only; simulates each
              policy once on the actual held-out demand using each SKU&apos;s
              rounded lead time and starting inventory = ROP. This removes the
              circularity of scoring policies on the same bootstrap that built
              them.
            </p>
          </div>

          <button
            type="button"
            onClick={handleRunReplay}
            disabled={
              isStartingReplay ||
              (replayJob &&
                (replayJob.status === "queued" ||
                  replayJob.status === "running"))
            }
            className="flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-amber-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
          >
            {isStartingReplay ||
            (replayJob &&
              (replayJob.status === "queued" ||
                replayJob.status === "running")) ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RotateCcw size={14} />
            )}
            <span>
              {hasReplay
                ? "Re-run Replay on Actual Demand"
                : "Run Replay on Actual Demand"}
            </span>
          </button>
        </div>

        {replayJobId && <JobProgress sessionId={session.id} job={replayJob} />}

        {replayError && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-xs text-rose-300">
            {replayError}
          </div>
        )}

        {/* Distinctive Comparison Header: Actual held-out demand vs Simulated demand */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-900/60 border border-white/[0.04] rounded-xl text-xs">
          <div className="flex items-center gap-2">
            <span className="text-slate-400 font-medium">Evaluation Mode:</span>
            <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg font-semibold font-mono">
              Actual held-out demand
            </span>
            <span className="text-slate-500 font-medium">versus</span>
            <span className="px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 rounded-lg font-semibold font-mono">
              Simulated demand
            </span>
          </div>
          <span className="text-[11px] text-slate-400">
            {hasReplay
              ? `Replay executed on ${fmtDateTime(replayRun.createdAt)} (28-day window)`
              : "No replay executed yet for this session"}
          </span>
        </div>

        {hasReplay ? (
          <>
            {/* Side-by-side Policy Cards: Actual held-out demand vs Simulated demand */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Deterministic Replay Card */}
              <div className="bg-[#171923] border border-white/[0.06] rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-slate-300">
                      Deterministic Policy (s_det)
                    </span>
                    {bestReplayAggPolicy === "det" && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Best Cost
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                    det
                  </span>
                </div>

                <div className="bg-amber-500/[0.04] border border-amber-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                    Actual held-out demand
                  </span>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Fill Rate:</span>
                    <span className="text-sm font-mono font-bold text-amber-300">
                      {fmtPct(replayDet?.fill_rate, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Cycle Service Level (CSL):
                    </span>
                    <span className="text-sm font-mono font-semibold text-slate-200">
                      {fmtPct(replayDet?.CSL ?? replayDet?.csl, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Total Cost:</span>
                    <span className="text-sm font-mono font-bold text-slate-100">
                      {fmtInr(replayDet?.total_cost)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Stockout Days:
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-200">
                      {replayDet?.stockout_days ?? 0} days (
                      {fmtPct(replayDet?.stockout_day_rate, 1)})
                    </span>
                  </div>
                </div>

                <div className="bg-indigo-500/[0.04] border border-indigo-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                    Simulated demand
                  </span>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Fill Rate:</span>
                    <span className="text-xs font-mono text-indigo-300">
                      {detAgg
                        ? fmtPct(detAgg.fill_rate ?? detAgg.service_level, 2)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Total Cost:</span>
                    <span className="text-xs font-mono text-slate-300">
                      {detAgg ? fmtInr(detAgg.total_cost) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Stockout Days Rate:
                    </span>
                    <span className="text-xs font-mono text-slate-300">
                      {detAgg
                        ? fmtPct(
                            detAgg.stockout_day_rate ??
                              detAgg.stockout_rate_mean,
                            1,
                          )
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Quantile Replay Card */}
              <div className="bg-[#171923] border border-sky-500/20 rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-sky-400">
                      Quantile Policy (s_quant)
                    </span>
                    {bestReplayAggPolicy === "qua" && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Best Cost
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-sky-950 text-sky-400">
                    quantile
                  </span>
                </div>

                <div className="bg-amber-500/[0.04] border border-amber-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                    Actual held-out demand
                  </span>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Fill Rate:</span>
                    <span className="text-sm font-mono font-bold text-amber-300">
                      {replayQua ? fmtPct(replayQua.fill_rate, 2) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Cycle Service Level (CSL):
                    </span>
                    <span className="text-sm font-mono font-semibold text-sky-200">
                      {replayQua
                        ? fmtPct(replayQua.CSL ?? replayQua.csl, 2)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Total Cost:</span>
                    <span className="text-sm font-mono font-bold text-sky-300">
                      {replayQua ? fmtInr(replayQua.total_cost) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Stockout Days:
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-200">
                      {replayQua
                        ? `${replayQua.stockout_days} days (${fmtPct(replayQua.stockout_day_rate, 1)})`
                        : "—"}
                    </span>
                  </div>
                </div>

                <div className="bg-indigo-500/[0.04] border border-indigo-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                    Simulated demand
                  </span>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Fill Rate:</span>
                    <span className="text-xs font-mono text-sky-300">
                      {quaAgg
                        ? fmtPct(quaAgg.fill_rate ?? quaAgg.service_level, 2)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Total Cost:</span>
                    <span className="text-xs font-mono text-slate-300">
                      {quaAgg ? fmtInr(quaAgg.total_cost) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Stockout Days Rate:
                    </span>
                    <span className="text-xs font-mono text-slate-300">
                      {quaAgg
                        ? fmtPct(
                            quaAgg.stockout_day_rate ??
                              quaAgg.stockout_rate_mean,
                            1,
                          )
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Uncertainty-Aware Replay Card */}
              <div className="bg-[#171923] border border-emerald-500/20 rounded-2xl p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-emerald-400">
                      Uncertainty-Aware Policy (s_emp)
                    </span>
                    {bestReplayAggPolicy === "emp" && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Best Cost
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400">
                    unc
                  </span>
                </div>

                <div className="bg-amber-500/[0.04] border border-amber-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">
                    Actual held-out demand
                  </span>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Fill Rate:</span>
                    <span className="text-sm font-mono font-bold text-amber-300">
                      {fmtPct(replayEmp?.fill_rate, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Cycle Service Level (CSL):
                    </span>
                    <span className="text-sm font-mono font-semibold text-emerald-200">
                      {fmtPct(replayEmp?.CSL ?? replayEmp?.csl, 2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Total Cost:</span>
                    <span className="text-sm font-mono font-bold text-emerald-300">
                      {fmtInr(replayEmp?.total_cost)}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Stockout Days:
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-200">
                      {replayEmp?.stockout_days ?? 0} days (
                      {fmtPct(replayEmp?.stockout_day_rate, 1)})
                    </span>
                  </div>
                </div>

                <div className="bg-indigo-500/[0.04] border border-indigo-500/20 rounded-xl p-3 flex flex-col gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
                    Simulated demand
                  </span>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Fill Rate:</span>
                    <span className="text-xs font-mono text-emerald-300">
                      {empAgg
                        ? fmtPct(empAgg.fill_rate ?? empAgg.service_level, 2)
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">Total Cost:</span>
                    <span className="text-xs font-mono text-slate-300">
                      {empAgg ? fmtInr(empAgg.total_cost) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-baseline">
                    <span className="text-xs text-slate-400">
                      Stockout Days Rate:
                    </span>
                    <span className="text-xs font-mono text-slate-300">
                      {empAgg
                        ? fmtPct(
                            empAgg.stockout_day_rate ??
                              empAgg.stockout_rate_mean,
                            1,
                          )
                        : "—"}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Per-SKU Replay Results Table */}
            <div className="bg-slate-900/40 border border-white/[0.06] rounded-xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-200">
                  Per-SKU Replay Performance on Actual Held-Out Demand
                </span>
                <span className="text-[11px] text-slate-500">
                  Three-policy comparison: s_det / s_quant / s_emp
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs font-mono">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-500 bg-white/[0.01]">
                      <th scope="col" className="px-3 py-2.5 font-sans">
                        SKU
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-right font-sans"
                      >
                        Deterministic (s_det)
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-right font-sans text-sky-400"
                      >
                        Quantile (s_quant)
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-right font-sans text-emerald-400"
                      >
                        Empirical (s_emp)
                      </th>
                      <th
                        scope="col"
                        className="px-3 py-2.5 text-right font-sans text-indigo-300"
                      >
                        Simulated Cost (Det / Qua / Emp)
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.02] text-slate-300">
                    {replaySkus.map((rSku) => {
                      const simSku = simSkuMap.get(rSku.sku_id);
                      const isOk = rSku.status === "ok";
                      const rDet = rSku.s_det || rSku.deterministic || rSku.det;
                      const rQua = rSku.s_quant || rSku.quantile;
                      const rEmp =
                        rSku.s_emp || rSku.uncertainty_aware || rSku.unc;

                      const skuReplayCosts = [
                        { id: "det", cost: rDet?.total_cost },
                        { id: "qua", cost: rQua?.total_cost },
                        { id: "emp", cost: rEmp?.total_cost },
                      ].filter((c) => c.cost != null && !isNaN(c.cost));
                      const minReplayCost =
                        skuReplayCosts.length > 0
                          ? Math.min(...skuReplayCosts.map((c) => c.cost))
                          : null;
                      const bestReplayPolicy =
                        minReplayCost != null
                          ? skuReplayCosts.find(
                              (c) => Math.abs(c.cost - minReplayCost) < 1e-4,
                            )?.id
                          : null;

                      return (
                        <tr
                          key={rSku.sku_id}
                          className="hover:bg-white/[0.02] transition-colors"
                        >
                          <td className="px-3 py-3 font-medium text-slate-100">
                            {rSku.sku_id}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {isOk && rDet ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-slate-100">
                                    {fmtInr(rDet.total_cost)}
                                  </span>
                                  {bestReplayPolicy === "det" && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      Best Cost
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-amber-300/90 font-sans">
                                  Fill: {fmtPct(rDet.fill_rate, 1)} · CSL:{" "}
                                  {fmtPct(rDet.CSL ?? rDet.csl, 1)}
                                </div>
                                <div className="text-[10px] text-slate-400 font-sans">
                                  Stockout: {rDet.stockout_days ?? 0}d (
                                  {fmtPct(rDet.stockout_day_rate, 1)})
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-500 italic">
                                {rSku.status}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {isOk && rQua ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-sky-300">
                                    {fmtInr(rQua.total_cost)}
                                  </span>
                                  {bestReplayPolicy === "qua" && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      Best Cost
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-sky-400/90 font-sans">
                                  Fill: {fmtPct(rQua.fill_rate, 1)} · CSL:{" "}
                                  {fmtPct(rQua.CSL ?? rQua.csl, 1)}
                                </div>
                                <div className="text-[10px] text-slate-400 font-sans">
                                  Stockout: {rQua.stockout_days ?? 0}d (
                                  {fmtPct(rQua.stockout_day_rate, 1)})
                                </div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-3 text-right">
                            {isOk && rEmp ? (
                              <div className="flex flex-col items-end gap-0.5">
                                <div className="flex items-center gap-1.5">
                                  <span className="font-bold text-emerald-300">
                                    {fmtInr(rEmp.total_cost)}
                                  </span>
                                  {bestReplayPolicy === "emp" && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] font-sans font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                                      Best Cost
                                    </span>
                                  )}
                                </div>
                                <div className="text-[10px] text-emerald-400/90 font-sans">
                                  Fill: {fmtPct(rEmp.fill_rate, 1)} · CSL:{" "}
                                  {fmtPct(rEmp.CSL ?? rEmp.csl, 1)}
                                </div>
                                <div className="text-[10px] text-slate-400 font-sans">
                                  Stockout: {rEmp.stockout_days ?? 0}d (
                                  {fmtPct(rEmp.stockout_day_rate, 1)})
                                </div>
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-3 text-right text-slate-400">
                            {simSku ? (
                              <span>
                                {fmtInr(simSku.deterministic?.total_cost_mean)}{" "}
                                /{" "}
                                <span className="text-sky-300/80">
                                  {simSku.quantile
                                    ? fmtInr(simSku.quantile?.total_cost_mean)
                                    : "—"}
                                </span>{" "}
                                /{" "}
                                <span className="text-emerald-300/80">
                                  {fmtInr(
                                    simSku.uncertainty_aware?.total_cost_mean,
                                  )}
                                </span>
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div className="p-8 border border-dashed border-white/[0.08] rounded-2xl flex flex-col items-center justify-center text-center gap-3">
            <RotateCcw size={28} className="text-slate-600" />
            <div className="flex flex-col gap-1 max-w-md">
              <span className="text-sm font-semibold text-slate-300">
                Ready to Replay Policies on Actual Demand
              </span>
              <p className="text-xs text-slate-500">
                Click &ldquo;Run Replay on Actual Demand&rdquo; to hold out the
                last 28 days of actual demand, fit forecasts and policies on
                earlier days only, and evaluate out-of-sample ground truth
                performance without bootstrap circularity.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
