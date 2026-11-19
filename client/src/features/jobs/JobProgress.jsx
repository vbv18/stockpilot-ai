import { useCancelJobMutation } from "../../lib/api.js";
import { AlertCircle, CheckCircle, Clock, Loader2, RefreshCw, XCircle } from "lucide-react";

export function JobProgress({ sessionId, job, onRetry }) {
  const [cancelJob, { isLoading: isCancelling }] = useCancelJobMutation();

  if (!job) return null;

  const isTerminal = ["succeeded", "failed", "cancelled"].includes(job.status);
  const isFailed = job.status === "failed";
  const pct = Math.min(100, Math.max(0, job.progress?.pct ?? 0));

  return (
    <div className="bg-[#13151c] border border-white/[0.08] rounded-xl p-4 my-4 shadow-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {job.status === "running" && <Loader2 className="animate-spin text-indigo-400" size={16} />}
          {job.status === "queued" && <Clock className="text-amber-400" size={16} />}
          {job.status === "succeeded" && <CheckCircle className="text-emerald-400" size={16} />}
          {job.status === "failed" && <AlertCircle className="text-rose-400" size={16} />}
          {job.status === "cancelled" && <XCircle className="text-slate-400" size={16} />}

          <span className="text-sm font-medium text-white capitalize">
            {job.type} Job: {job.status}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!isTerminal && (
            <button
              onClick={() => cancelJob({ sessionId, jobId: job.id })}
              disabled={isCancelling}
              className="text-xs text-rose-400 hover:text-rose-300 font-medium px-2 py-1 rounded bg-rose-500/10 hover:bg-rose-500/20 transition-colors disabled:opacity-50"
            >
              {isCancelling ? "Cancelling..." : "Cancel Job"}
            </button>
          )}

          {isFailed && onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 font-medium px-2 py-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 transition-colors"
            >
              <RefreshCw size={12} />
              Retry
            </button>
          )}
        </div>
      </div>

      {job.progress?.message && (
        <p className="text-xs text-slate-400 mb-2">{job.progress.message}</p>
      )}

      {/* Progress Bar */}
      <div className="w-full bg-slate-800/80 rounded-full h-2 overflow-hidden mb-1">
        <div
          className={`h-full transition-all duration-300 ease-out ${
            job.status === "succeeded"
              ? "bg-emerald-500"
              : job.status === "failed"
                ? "bg-rose-500"
                : "bg-indigo-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between items-center text-[10px] text-slate-500">
        <span>Job ID: {job.id}</span>
        <span>{pct}%</span>
      </div>

      {isFailed && job.error && (
        <div className="mt-3 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex flex-col gap-1">
          <div className="font-medium">{job.error.message || "An error occurred."}</div>
          {job.error.code && (
            <div className="text-[10px] text-rose-400/80">Code: {job.error.code}</div>
          )}
        </div>
      )}
    </div>
  );
}
