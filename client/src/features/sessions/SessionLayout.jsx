import { useEffect, useState } from "react";
import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { Check, ChevronRight, Edit2, Loader2, Sparkles } from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import { useGetSessionQuery, usePatchSessionMutation } from "../../lib/api.js";
import { fmtDateTime } from "../../lib/format.js";
import { maxReachableIndex, STEPS } from "./steps.js";

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

export default function SessionLayout() {
  const { sessionId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const {
    data: session,
    isLoading,
    error,
    refetch,
  } = useGetSessionQuery(sessionId);

  const isProcessing = [
    "validating",
    "forecasting",
    "optimizing",
    "simulating",
  ].includes(session?.status);

  useEffect(() => {
    if (!isProcessing) return;
    const interval = setInterval(refetch, 5000);
    return () => clearInterval(interval);
  }, [isProcessing, refetch]);

  const [patchSession] = usePatchSessionMutation();
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0d0f14] text-white flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-500" size={32} />
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="min-h-screen bg-[#0d0f14] text-white p-8 flex flex-col items-center justify-center gap-4">
        <p className="text-rose-400 font-medium">
          {error?.data?.message || "Failed to load session"}
        </p>
        <button
          onClick={() => refetch()}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm rounded-xl font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  const handleRename = async (e) => {
    e.preventDefault();
    if (newName.trim() && newName.trim() !== session.name) {
      await patchSession({ id: sessionId, name: newName.trim() });
    }
    setIsEditingName(false);
  };

  const maxIdx = maxReachableIndex(session.status);
  const aiEligible = AI_ELIGIBLE_STATUSES.includes(session.status);

  // Active sub-page
  const pathParts = location.pathname.split("/");
  const activeSubpage = pathParts[pathParts.length - 1];

  return (
    <div className="min-h-screen bg-[#0d0f14] text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="border-b border-white/[0.08] bg-[#13151c]/60 backdrop-blur-md px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-40">
        <div className="flex items-center gap-4">
          <Link
            to="/sessions"
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Sessions
          </Link>
          <ChevronRight size={14} className="text-slate-600" />

          {isEditingName ? (
            <form onSubmit={handleRename} className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                autoFocus
                onBlur={handleRename}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100 focus:outline-none focus:border-indigo-500"
              />
              <button
                type="submit"
                className="text-xs text-indigo-400 font-medium"
              >
                Save
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-lg font-semibold text-slate-100 tracking-tight">
                {session.name}
              </h1>
              <button
                type="button"
                onClick={() => {
                  setNewName(session.name);
                  setIsEditingName(true);
                }}
                className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-200 transition-opacity p-1"
                aria-label="Rename session"
              >
                <Edit2 size={13} />
              </button>
            </div>
          )}

          <StatusBadge status={session.status} />
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Updated {fmtDateTime(session.updatedAt)}
          </span>

          <Link
            to={`/sessions/${sessionId}/overview`}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              activeSubpage === "overview"
                ? "bg-slate-800 border-white/[0.16] text-white"
                : "bg-slate-900/50 border-white/[0.08] text-slate-300 hover:bg-slate-800"
            }`}
          >
            Overview
          </Link>

          <Link
            to={`/sessions/${sessionId}/summary`}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${
              activeSubpage === "summary"
                ? "bg-slate-800 border-white/[0.16] text-white"
                : "bg-slate-900/50 border-white/[0.08] text-slate-300 hover:bg-slate-800"
            }`}
          >
            Summary
          </Link>

          <Link
            to={aiEligible ? `/ask-ai?sessionId=${sessionId}` : "#"}
            onClick={(e) => {
              if (!aiEligible) {
                e.preventDefault();
              }
            }}
            title={!aiEligible ? "Complete forecasting first" : "Chat with AI"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
              aiEligible
                ? "bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border-indigo-500/30 shadow-sm"
                : "bg-slate-900/30 border-white/[0.04] text-slate-600 cursor-not-allowed"
            }`}
          >
            <Sparkles size={13} />
            <span>Ask AI</span>
          </Link>
        </div>
      </header>

      {/* Stepper Navigation */}
      <div className="border-b border-white/[0.06] bg-[#0d0f14]/80 px-6 py-3">
        <nav
          aria-label="Pipeline Stages"
          className="flex items-center gap-2 overflow-x-auto"
        >
          {STEPS.map((stepKey, idx) => {
            const isClickable = idx <= maxIdx;
            const isCurrent = activeSubpage === stepKey;
            const isCompleted = idx < maxIdx;
            const label = stepKey.charAt(0).toUpperCase() + stepKey.slice(1);

            return (
              <div key={stepKey} className="flex items-center gap-2">
                {idx > 0 && <span className="text-slate-700">/</span>}
                <button
                  type="button"
                  disabled={!isClickable}
                  onClick={() => navigate(`/sessions/${sessionId}/${stepKey}`)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    isCurrent
                      ? "bg-indigo-600/20 border border-indigo-500/30 text-indigo-200"
                      : isClickable
                        ? "text-slate-300 hover:bg-slate-800/60"
                        : "text-slate-600 cursor-not-allowed"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
                      isCompleted
                        ? "bg-emerald-500/20 text-emerald-400"
                        : isCurrent
                          ? "bg-indigo-500 text-white"
                          : "bg-slate-800 text-slate-500"
                    }`}
                  >
                    {isCompleted ? <Check size={10} /> : idx + 1}
                  </span>
                  <span>{label}</span>
                </button>
              </div>
            );
          })}
        </nav>
      </div>

      {/* Main Outlet */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto">
        <Outlet context={{ session, refetch }} />
      </main>
    </div>
  );
}
