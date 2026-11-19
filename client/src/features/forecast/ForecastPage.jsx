import { useState, useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ArrowRight, ChevronDown, ChevronUp, Loader2, Play, Sparkles } from "lucide-react";
import { useGetForecastQuery, useStartForecastMutation } from "../../lib/api.js";
import { fmtDateTime, fmtInt, fmtNum, fmtPct, shortId } from "../../lib/format.js";
import { JobProgress } from "../jobs/JobProgress.jsx";
import { useJobTracker } from "../jobs/useJobTracker.js";
import { ForecastChart } from "./ForecastChart.jsx";

export default function ForecastPage() {
  const { session } = useOutletContext();
  const navigate = useNavigate();

  const { data: forecastData, refetch } = useGetForecastQuery(session.id);

  // Forecast job tracking
  const [jobId, setJobId] = useState(() => {
    return sessionStorage.getItem(`sp:job:${session.id}:forecast`) || null;
  });

  const { job } = useJobTracker(session.id, jobId, () => {
    sessionStorage.removeItem(`sp:job:${session.id}:forecast`);
    refetch();
  });

  const [startForecast, { isLoading: isStarting }] = useStartForecastMutation();
  const [selectedSkus, setSelectedSkus] = useState([]);
  const [expandedWarningSku, setExpandedWarningSku] = useState(null);

  const canRun =
    session.status === "dataset_ready" ||
    session.status === "forecast_failed" ||
    session.status === "forecast_ready";

  const handleRunForecast = async () => {
    try {
      const res = await startForecast({ id: session.id }).unwrap();
      const newJobId = res.jobId;
      setJobId(newJobId);
      sessionStorage.setItem(`sp:job:${session.id}:forecast`, newJobId);
    } catch (err) {
      console.error("Failed to start forecast", err);
    }
  };

  // Default selection
  const activeSelectedSkus = useMemo(() => {
    const list = forecastData?.eligibleSkuIds || [];
    if (selectedSkus.length > 0) return selectedSkus;
    if (list.length > 0) return [list[0]];
    return [];
  }, [selectedSkus, forecastData?.eligibleSkuIds]);

  const toggleSkuSelect = (skuId) => {
    if (selectedSkus.includes(skuId)) {
      if (selectedSkus.length === 1) return; // Keep at least one selected
      setSelectedSkus(selectedSkus.filter((s) => s !== skuId));
    } else {
      if (selectedSkus.length >= 4) {
        setSelectedSkus([...selectedSkus.slice(1), skuId]);
      } else {
        setSelectedSkus([...selectedSkus, skuId]);
      }
    }
  };

  const run = forecastData?.run;
  const aggregate = forecastData?.evaluation?.aggregate;
  const skusList = forecastData?.forecast?.skus || [];

  const historyMap = useMemo(() => {
    const map = new Map();
    if (forecastData?.history) {
      for (const h of forecastData.history) {
        map.set(h.skuId, h);
      }
    }
    return map;
  }, [forecastData]);

  const evalMap = useMemo(() => {
    const map = new Map();
    if (forecastData?.evaluation?.skus) {
      for (const e of forecastData.evaluation.skus) {
        map.set(e.sku_id, e);
      }
    }
    return map;
  }, [forecastData]);

  return (
    <div className="flex flex-col gap-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Demand Forecasting & Evaluation</h2>
          <p className="text-xs text-slate-400 mt-1">
            28-day daily demand forecasting with AutoETS, Seasonal Naive baselines, and residual block bootstrap intervals.
          </p>
        </div>

        {canRun && (
          <button
            type="button"
            disabled={isStarting || (job && (job.status === "queued" || job.status === "running"))}
            onClick={handleRunForecast}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all self-start"
          >
            {isStarting ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            <span>{forecastData ? "Re-run Forecasting" : "Run Forecasting"}</span>
          </button>
        )}
      </div>

      {jobId && <JobProgress sessionId={session.id} job={job} onRetry={handleRunForecast} />}

      {/* When no forecast has succeeded yet */}
      {!forecastData && !jobId && (
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-10 flex flex-col items-center justify-center gap-4 text-center">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
            <Sparkles size={24} />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Forecast Ready to Run</h3>
            <p className="text-xs text-slate-400 max-w-md mt-1">
              The engine will train AutoETS and Seasonal Naive models on historical demand, collect rolling-origin residuals, and generate 500 bootstrap paths per SKU.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunForecast}
            disabled={isStarting}
            className="mt-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md transition-all cursor-pointer"
          >
            Start Forecasting
          </button>
        </div>
      )}

      {/* Succeeded Run View */}
      {forecastData && (
        <>
          {/* Header Facts */}
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-slate-500 text-[11px]">Run ID:</span>
                <span className="font-mono text-slate-200 ml-1.5 font-medium">{shortId(run?.id)}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[11px]">Seed:</span>
                <span className="font-mono text-slate-200 ml-1.5">{run?.seed}</span>
              </div>
              <div>
                <span className="text-slate-500 text-[11px]">Engine:</span>
                <span className="text-slate-200 ml-1.5 font-mono">
                  statsforecast v{run?.runMeta?.forecast?.statsforecast_version || "2.x"}
                </span>
              </div>
            </div>
            <div className="text-slate-400 text-[11px]">
              Completed {fmtDateTime(run?.updatedAt)}
            </div>
          </div>

          {/* Aggregate Metric Cards */}
          {aggregate && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-2">
                <span className="text-[11px] text-slate-400 font-medium">AutoETS Accuracy (Holdout)</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-indigo-400">{fmtPct(aggregate.autoets?.wape_pooled, 1)}</span>
                  <span className="text-xs text-slate-400 font-mono">WAPE</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-white/[0.04]">
                  <span>MAE: {fmtNum(aggregate.autoets?.mae_mean, 2)}</span>
                  <span>RMSE: {fmtNum(aggregate.autoets?.rmse_mean, 2)}</span>
                </div>
              </div>

              <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-2">
                <span className="text-[11px] text-slate-400 font-medium">Seasonal Naive Baseline</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-amber-400">{fmtPct(aggregate.seasonal_naive?.wape_pooled, 1)}</span>
                  <span className="text-xs text-slate-400 font-mono">WAPE</span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-white/[0.04]">
                  <span>MAE: {fmtNum(aggregate.seasonal_naive?.mae_mean, 2)}</span>
                  <span>RMSE: {fmtNum(aggregate.seasonal_naive?.rmse_mean, 2)}</span>
                </div>
              </div>

              <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-2">
                <span className="text-[11px] text-slate-400 font-medium">P10-P90 Coverage (80% Nominal)</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-emerald-400">{fmtPct(aggregate.coverage_mean, 1)}</span>
                </div>
                <span className="text-[11px] text-slate-500 pt-2 border-t border-white/[0.04]">
                  Across {aggregate.n_skus_with_intervals} SKUs with intervals
                </span>
              </div>

              <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex flex-col gap-2">
                <span className="text-[11px] text-slate-400 font-medium">Mean Interval Width</span>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg font-bold text-slate-200">{fmtNum(aggregate.mean_width_mean, 1)}</span>
                  <span className="text-xs text-slate-400">units/day</span>
                </div>
                <span className="text-[11px] text-slate-500 pt-2 border-t border-white/[0.04]">
                  Empirical uncertainty band
                </span>
              </div>
            </div>
          )}

          {/* SKU Selection Chips */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium">Select SKUs to Inspect (up to 4 for comparison):</span>
              <span className="text-slate-500">{activeSelectedSkus.length} of 4 selected</span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {skusList.map((sku) => {
                const isEligible = sku.status === "ok" && sku.interval_status === "ok";
                const isSelected = activeSelectedSkus.includes(sku.sku_id);

                return (
                  <button
                    key={sku.sku_id}
                    type="button"
                    disabled={!isEligible}
                    onClick={() => toggleSkuSelect(sku.sku_id)}
                    title={!isEligible ? sku.message || "Insufficient history for prediction intervals" : ""}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-medium transition-all cursor-pointer ${
                      isSelected
                        ? "bg-indigo-600 text-white shadow-md shadow-indigo-700/30"
                        : isEligible
                        ? "bg-[#13151c] border border-white/[0.08] text-slate-300 hover:bg-slate-800"
                        : "bg-slate-900/40 border border-white/[0.04] text-slate-600 cursor-not-allowed opacity-60"
                    }`}
                  >
                    {sku.sku_id}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Small Multiples / Charts Grid */}
          <div className={`grid gap-6 ${activeSelectedSkus.length > 1 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
            {activeSelectedSkus.map((skuId) => {
              const skuFc = skusList.find((s) => s.sku_id === skuId);
              const skuEv = evalMap.get(skuId);
              const hist = historyMap.get(skuId);

              return (
                <ForecastChart
                  key={skuId}
                  skuId={skuId}
                  skuForecast={skuFc}
                  skuEvaluation={skuEv}
                  historySeries={hist}
                />
              );
            })}
          </div>

          {/* SKU Status Table */}
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
            <h3 className="text-xs font-semibold text-slate-300">SKU Status & Model Details</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-slate-500 bg-white/[0.01]">
                    <th scope="col" className="px-3 py-2">SKU</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                    <th scope="col" className="px-3 py-2">Intervals</th>
                    <th scope="col" className="px-3 py-2 text-right">Obs</th>
                    <th scope="col" className="px-3 py-2 text-right">Blocks</th>
                    <th scope="col" className="px-3 py-2 text-right">Failed Origins</th>
                    <th scope="col" className="px-3 py-2">Model Spec</th>
                    <th scope="col" className="px-3 py-2">Warnings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.02] text-slate-300 font-mono">
                  {skusList.map((sku) => {
                    const hasWarnings = sku.warnings && sku.warnings.length > 0;
                    const isExpanded = expandedWarningSku === sku.sku_id;

                    return (
                      <tr key={sku.sku_id} className="hover:bg-white/[0.01]">
                        <td className="px-3 py-2 font-medium text-slate-100">{sku.sku_id}</td>
                        <td className="px-3 py-2 font-sans">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] ${
                              sku.status === "ok" ? "bg-emerald-500/10 text-emerald-300" : "bg-rose-500/10 text-rose-300"
                            }`}
                          >
                            {sku.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-sans text-slate-400">{sku.interval_status}</td>
                        <td className="px-3 py-2 text-right">{fmtInt(sku.n_observations)}</td>
                        <td className="px-3 py-2 text-right">{fmtInt(sku.n_residual_blocks)}</td>
                        <td className="px-3 py-2 text-right">{fmtInt(sku.n_failed_origins)}</td>
                        <td className="px-3 py-2 text-indigo-300 text-[11px]">{sku.autoets_model_spec || "-"}</td>
                        <td className="px-3 py-2 font-sans">
                          {hasWarnings ? (
                            <button
                              type="button"
                              onClick={() => setExpandedWarningSku(isExpanded ? null : sku.sku_id)}
                              className="text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer text-[11px]"
                            >
                              <span>{sku.warnings.length} warning(s)</span>
                              {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          ) : (
                            <span className="text-slate-600">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Expanded warnings box */}
            {expandedWarningSku && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200">
                <span className="font-semibold block mb-1">Warnings for {expandedWarningSku}:</span>
                <ul className="list-disc list-inside">
                  {skusList.find((s) => s.sku_id === expandedWarningSku)?.warnings.map((w, idx) => (
                    <li key={idx}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Footer Action */}
          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => navigate(`/sessions/${session.id}/assumptions`)}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 cursor-pointer transition-all"
            >
              <span>Continue to Assumptions</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
