import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Brain,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import {
  useCreateConversationMutation,
  useListAiSessionsQuery,
  useListConversationsQuery,
  useReindexSessionMutation,
} from "../../lib/api.js";
import { fmtDateTime, shortId } from "../../lib/format.js";
import { StatusBadge } from "../../components/StatusBadge.jsx";

function SessionCard({ session }) {
  const navigate = useNavigate();
  const [showHistory, setShowHistory] = useState(false);

  const [createConversation, { isLoading: isCreating }] = useCreateConversationMutation();
  const [reindexSession, { isLoading: isReindexing }] = useReindexSessionMutation();

  const { data: convList = [] } = useListConversationsQuery(
    { sessionId: session.id },
    { skip: !showHistory },
  );

  const handleStartConversation = async () => {
    try {
      const res = await createConversation({ sessionId: session.id }).unwrap();
      navigate(`/ask-ai/${res.id}`);
    } catch (err) {
      console.error("Failed to start conversation", err);
    }
  };

  const getContextChip = () => {
    switch (session.aiIndexStatus) {
      case "indexed":
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            AI context ready
          </span>
        );
      case "pending":
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
            Preparing AI context
          </span>
        );
      case "failed":
      case "skipped":
      case "not_indexed":
      default:
        return (
          <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 text-slate-400 border border-white/[0.06]">
            Limited context: calculation tools only
          </span>
        );
    }
  };

  return (
    <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-xl flex flex-col gap-5 hover:border-indigo-500/30 transition-all">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-white">{session.name}</h3>
            <StatusBadge status={session.status} />
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
            <span>Updated {fmtDateTime(session.updatedAt)}</span>
            <span>•</span>
            <span className="font-mono">ID: {shortId(session.id)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">{getContextChip()}</div>
      </div>

      {/* Availability Chips */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`px-2 py-0.5 rounded ${
            session.hasForecast
              ? "bg-blue-500/10 text-blue-400 border border-blue-500/20"
              : "bg-slate-800 text-slate-500"
          }`}
        >
          Forecast
        </span>
        <span
          className={`px-2 py-0.5 rounded ${
            session.hasOptimization
              ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
              : "bg-slate-800 text-slate-500"
          }`}
        >
          Optimization
        </span>
        <span
          className={`px-2 py-0.5 rounded ${
            session.hasSimulation
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              : "bg-slate-800 text-slate-500"
          }`}
        >
          Simulation
        </span>
      </div>

      {!session.isComplete && (
        <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs">
          This analysis is partially complete; answers cover the completed stages only.
        </div>
      )}

      {/* Action Strip */}
      <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
        <div className="flex items-center gap-3">
          <button
            onClick={handleStartConversation}
            disabled={isCreating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors disabled:opacity-50"
          >
            {isCreating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            <span>Start new conversation</span>
          </button>

          {["failed", "skipped", "not_indexed"].includes(session.aiIndexStatus) && (
            <button
              onClick={() => reindexSession(session.id)}
              disabled={isReindexing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-300 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={isReindexing ? "animate-spin" : ""} />
              <span>Rebuild AI context</span>
            </button>
          )}
        </div>

        <button
          onClick={() => setShowHistory(!showHistory)}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <span>Previous conversations</span>
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Collapsible History Drawer */}
      {showHistory && (
        <div className="pt-2 border-t border-white/[0.06] space-y-2">
          {convList.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">No previous conversations for this session.</p>
          ) : (
            convList.map((c) => (
              <Link
                key={c.id}
                to={`/ask-ai/${c.id}`}
                className="flex items-center justify-between p-3 rounded-xl bg-slate-800/40 hover:bg-slate-800/80 border border-white/[0.04] text-xs text-slate-300 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <MessageSquare size={14} className="text-indigo-400" />
                  <span className="font-medium text-white">{c.title}</span>
                </div>
                <div className="flex items-center gap-3 text-slate-500 text-[11px]">
                  <span>{c.messageCount} messages</span>
                  <span>{fmtDateTime(c.lastMessageAt || c.createdAt)}</span>
                </div>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function AskAiSelectorPage() {
  const { data: sessions = [], isLoading, error, refetch } = useListAiSessionsQuery();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#0d0f14] text-white p-8 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-500" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-[#0d0f14] text-white p-8 flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-rose-400 font-medium">
          {error?.data?.message || "Failed to load AI sessions"}
        </p>
        <button
          onClick={refetch}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs rounded-xl font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0f14] text-white p-6 sm:p-10">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Brain size={16} />
            <span>Inventory Decision Support</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Ask StockPilot AI</h1>
          <p className="text-sm text-slate-400 mt-1">
            Select an analysis session to inspect demand forecast models, investigate inventory risks, and simulate what-if scenarios.
          </p>
        </div>

        {sessions.length === 0 ? (
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-12 text-center flex flex-col items-center gap-4 shadow-xl">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 flex items-center justify-center text-indigo-400">
              <Sparkles size={24} />
            </div>
            <div>
              <h3 className="text-base font-semibold text-white">No eligible analysis sessions</h3>
              <p className="text-xs text-slate-400 max-w-sm mt-1">
                AI analysis requires a session with at least a completed demand forecast.
              </p>
            </div>
            <Link
              to="/sessions"
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors"
            >
              Go to Sessions
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {sessions.map((s) => (
              <SessionCard key={s.id} session={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default AskAiSelectorPage;
