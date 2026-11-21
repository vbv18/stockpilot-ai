import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  Edit2,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { StatusBadge } from "../../components/StatusBadge.jsx";
import {
  useCreateSessionMutation,
  useListSessionsQuery,
  usePatchSessionMutation,
} from "../../lib/api.js";
import { fmtDateTime } from "../../lib/format.js";

export default function SessionsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);

  const {
    data: response,
    isLoading,
    error,
    refetch,
  } = useListSessionsQuery({
    page,
    limit: 20,
    archived: showArchived,
  });

  const [createSession, { isLoading: isCreating }] = useCreateSessionMutation();
  const [patchSession] = usePatchSessionMutation();

  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");

  const sessions = response?.data || [];
  const meta = response?.meta || { total: 0, page: 1, limit: 20 };

  const handleCreate = async () => {
    try {
      const res = await createSession({}).unwrap();
      navigate(`/sessions/${res.id}/upload`);
    } catch (err) {
      console.error("Failed to create session", err);
    }
  };

  const handleRename = async (id, currentName) => {
    if (editingName.trim() && editingName.trim() !== currentName) {
      await patchSession({ id, name: editingName.trim() });
    }
    setEditingId(null);
  };

  const handleToggleArchive = async (id, isArchived) => {
    await patchSession({ id, archived: !isArchived });
  };

  return (
    <div className="min-h-screen bg-[#0d0f14] text-slate-100 flex flex-col">
      <header className="border-b border-white/[0.08] bg-[#13151c]/60 backdrop-blur-md px-8 py-5 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-base font-bold text-white tracking-tight flex items-center gap-2"
          >
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 inline-block" />
            StockPilot AI
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-sm font-medium text-slate-400">Analyses</span>
        </div>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setShowArchived((prev) => !prev)}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            {showArchived ? "Show Active Sessions" : "Show Archived"}
          </button>

          <button
            type="button"
            disabled={isCreating}
            onClick={handleCreate}
            className="flex items-center gap-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 transition-all cursor-pointer disabled:opacity-60"
          >
            {isCreating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} />
            )}
            <span>New Analysis</span>
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-8 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              {showArchived ? "Archived Analyses" : "Inventory Analyses"}
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Select an analysis to inspect forecasts, safety stocks, and
              simulated policies.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-12 flex items-center justify-center">
            <Loader2 className="animate-spin text-slate-500" size={28} />
          </div>
        ) : error ? (
          <div className="bg-[#13151c] border border-rose-500/20 rounded-2xl p-8 flex flex-col items-center justify-center gap-3">
            <p className="text-rose-400 text-sm font-medium">
              {error?.data?.message || "Failed to load sessions."}
            </p>
            {error?.data?.requestId && (
              <span className="text-[11px] text-slate-500">
                Reference: {error.data.requestId}
              </span>
            )}
            <button
              onClick={() => refetch()}
              className="mt-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium"
            >
              Retry
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-16 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <Sparkles size={24} />
            </div>
            <h3 className="text-base font-semibold text-slate-200">
              No sessions found
            </h3>
            <p className="text-xs text-slate-400 max-w-sm">
              {showArchived
                ? "You do not have any archived sessions."
                : "Get started by uploading your daily inventory sales CSV to run demand forecasting and safety stock optimization."}
            </p>
            {!showArchived && (
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="mt-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md transition-all cursor-pointer"
              >
                Create Analysis
              </button>
            )}
          </div>
        ) : (
          <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.08] text-slate-400 bg-white/[0.02]">
                    <th scope="col" className="px-5 py-3.5 font-medium">
                      Name
                    </th>
                    <th scope="col" className="px-5 py-3.5 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-5 py-3.5 font-medium">
                      Stage Summary
                    </th>
                    <th scope="col" className="px-5 py-3.5 font-medium">
                      Updated
                    </th>
                    <th
                      scope="col"
                      className="px-5 py-3.5 font-medium text-right"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {sessions.map((sess) => {
                    const isEditing = editingId === sess.id;
                    const isArchived = Boolean(sess.archivedAt);

                    return (
                      <tr
                        key={sess.id}
                        onClick={(e) => {
                          if (
                            e.target.closest("button") ||
                            e.target.closest("input")
                          )
                            return;
                          navigate(`/sessions/${sess.id}`);
                        }}
                        className="hover:bg-white/[0.02] cursor-pointer transition-colors"
                      >
                        <td className="px-5 py-4 font-medium text-slate-200">
                          {isEditing ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleRename(sess.id, sess.name);
                              }}
                              className="flex items-center gap-2"
                            >
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                autoFocus
                                onBlur={() => handleRename(sess.id, sess.name)}
                                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                              />
                            </form>
                          ) : (
                            <div className="flex items-center gap-2 group">
                              <span className="font-semibold text-slate-100 hover:text-indigo-300">
                                {sess.name}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setEditingId(sess.id);
                                  setEditingName(sess.name);
                                }}
                                className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-slate-300 transition-opacity p-1"
                                aria-label="Rename"
                              >
                                <Edit2 size={12} />
                              </button>
                            </div>
                          )}
                        </td>

                        <td className="px-5 py-4">
                          <StatusBadge status={sess.status} />
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {[
                              "dataset",
                              "forecast",
                              "optimization",
                              "simulation",
                            ].map((stg) => {
                              const s =
                                sess.stages?.[stg]?.status || "not_started";
                              return (
                                <span
                                  key={stg}
                                  className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                                    s === "succeeded"
                                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                                      : s === "running"
                                        ? "bg-amber-500/10 text-amber-300 border border-amber-500/20"
                                        : s === "failed"
                                          ? "bg-rose-500/10 text-rose-300 border border-rose-500/20"
                                          : "bg-slate-800/60 text-slate-500"
                                  }`}
                                >
                                  {stg.slice(0, 3)}
                                </span>
                              );
                            })}
                          </div>
                        </td>

                        <td className="px-5 py-4 text-slate-400">
                          {fmtDateTime(sess.updatedAt)}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleArchive(sess.id, isArchived);
                            }}
                            className="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-slate-800 transition-colors"
                            title={
                              isArchived
                                ? "Unarchive session"
                                : "Archive session"
                            }
                          >
                            {isArchived ? (
                              <ArchiveRestore size={14} />
                            ) : (
                              <Archive size={14} />
                            )}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {meta.total > 20 && (
              <div className="border-t border-white/[0.06] px-5 py-3 flex items-center justify-between text-xs text-slate-400">
                <span>Total: {meta.total}</span>
                <div className="flex gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-2.5 py-1 bg-slate-800 rounded disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    disabled={page * 20 >= meta.total}
                    onClick={() => setPage((p) => p + 1)}
                    className="px-2.5 py-1 bg-slate-800 rounded disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
