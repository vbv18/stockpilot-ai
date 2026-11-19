import { Link, useOutletContext } from "react-router-dom";
import { Archive, ArchiveRestore, ArrowUpRight, Sparkles } from "lucide-react";
import { fmtDateTime, shortId } from "../../lib/format.js";
import { usePatchSessionMutation } from "../../lib/api.js";

const AI_ELIGIBLE_STATUSES = [
  "forecast_ready",
  "assumptions_pending",
  "optimizing",
  "optimization_ready",
  "optimization_failed",
  "simulating",
  "simulation_failed",
  "completed",
];

export default function OverviewPage() {
  const { session } = useOutletContext();
  const [patchSession] = usePatchSessionMutation();

  const stages = [
    {
      key: "dataset",
      title: "Dataset Ingestion & Cleaning",
      path: "validation",
      runId: session.activeDatasetId,
      record: session.stages?.dataset,
    },
    {
      key: "forecast",
      title: "Demand Forecasting & Backtest",
      path: "forecast",
      runId: session.activeForecastRunId,
      record: session.stages?.forecast,
    },
    {
      key: "optimization",
      title: "Safety Stock & EOQ Optimization",
      path: "optimization",
      runId: session.activeOptimizationRunId,
      record: session.stages?.optimization,
    },
    {
      key: "simulation",
      title: "Monte Carlo Policy Simulation",
      path: "simulation",
      runId: session.activeSimulationRunId,
      record: session.stages?.simulation,
    },
  ];

  const aiEligible = AI_ELIGIBLE_STATUSES.includes(session.status);
  const isArchived = Boolean(session.archivedAt);

  const handleToggleArchive = async () => {
    await patchSession({ id: session.id, archived: !isArchived });
  };

  const aiIndexStatus = session.aiIndex?.status || "not_indexed";
  const aiExplanation =
    aiIndexStatus === "indexed"
      ? "AI can retrieve this session"
      : aiIndexStatus === "pending"
      ? "Preparing AI context"
      : aiIndexStatus === "failed"
      ? "AI retrieval unavailable; deterministic results are unaffected"
      : "Not indexed yet";

  return (
    <div className="flex flex-col gap-8 max-w-5xl mx-auto">
      {/* Overview Header Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white tracking-tight">Analysis Overview</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Full stage status summary, active model run identifiers, and AI contextual index state.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to={aiEligible ? `/ask-ai?sessionId=${session.id}` : "#"}
            onClick={(e) => {
              if (!aiEligible) e.preventDefault();
            }}
            title={!aiEligible ? "Complete forecasting first" : ""}
            className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
              aiEligible
                ? "bg-indigo-600 hover:bg-indigo-500 text-white border-transparent shadow-md shadow-indigo-700/20"
                : "bg-slate-900 border-white/[0.06] text-slate-500 cursor-not-allowed"
            }`}
          >
            <Sparkles size={14} />
            <span>Ask AI about this analysis</span>
          </Link>

          <button
            type="button"
            onClick={handleToggleArchive}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-900 hover:bg-slate-800 border border-white/[0.08] text-xs font-medium rounded-xl text-slate-300 transition-colors cursor-pointer"
          >
            {isArchived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
            <span>{isArchived ? "Unarchive" : "Archive"}</span>
          </button>
        </div>
      </div>

      {/* AI Index Status Bar */}
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-4 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-slate-400 font-medium">AI Retrieval Index:</span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium uppercase ${
              aiIndexStatus === "indexed"
                ? "bg-emerald-500/20 text-emerald-300"
                : aiIndexStatus === "pending"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-slate-800 text-slate-400"
            }`}
          >
            {aiIndexStatus}
          </span>
          <span className="text-slate-500 text-[11px]">{aiExplanation}</span>
        </div>
        {session.aiIndex?.updatedAt && (
          <span className="text-slate-500 text-[11px]">Last indexed {fmtDateTime(session.aiIndex.updatedAt)}</span>
        )}
      </div>

      {/* 4 Pipeline Stage Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {stages.map((stg) => {
          const st = stg.record?.status || "not_started";
          const isSucceeded = st === "succeeded";
          const isFailed = st === "failed";
          const isRunning = st === "running";

          return (
            <div
              key={stg.key}
              className="bg-[#13151c] border border-white/[0.08] hover:border-white/[0.14] rounded-2xl p-5 flex flex-col justify-between gap-4 transition-all"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">{stg.title}</h3>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      isSucceeded
                        ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/20"
                        : isFailed
                        ? "bg-rose-500/15 text-rose-300 border border-rose-500/20"
                        : isRunning
                        ? "bg-amber-500/15 text-amber-300 border border-amber-500/20 animate-pulse"
                        : "bg-slate-800 text-slate-400"
                    }`}
                  >
                    {st.replace(/_/g, " ")}
                  </span>
                </div>

                <div className="flex flex-col gap-1 text-xs text-slate-400 font-mono mt-1">
                  {stg.runId && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-sans">Active Run:</span>
                      <span className="text-slate-200">{shortId(stg.runId)}</span>
                    </div>
                  )}
                  {stg.record?.startedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-sans">Started:</span>
                      <span>{fmtDateTime(stg.record.startedAt)}</span>
                    </div>
                  )}
                  {stg.record?.finishedAt && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500 font-sans">Finished:</span>
                      <span>{fmtDateTime(stg.record.finishedAt)}</span>
                    </div>
                  )}
                </div>

                {isFailed && stg.record?.userMessage && (
                  <p className="text-xs text-rose-300 mt-1 bg-rose-500/10 p-2 rounded-lg">
                    {stg.record.userMessage}
                  </p>
                )}
              </div>

              <Link
                to={`/sessions/${session.id}/${stg.path}`}
                className="self-start flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium transition-colors"
              >
                <span>Inspect Stage</span>
                <ArrowUpRight size={14} />
              </Link>
            </div>
          );
        })}
      </div>
    </div>
  );
}
