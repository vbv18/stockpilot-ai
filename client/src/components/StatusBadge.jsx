export function StatusBadge({ status }) {
  const label = status ? status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "Unknown";

  const isFailed = status && (status.includes("failed") || status === "cancelled");
  const isRunning = ["validating", "forecasting", "optimizing", "simulating", "uploading"].includes(status);
  const isCompleted = status === "completed" || status.includes("ready") || status === "succeeded";

  let colorClasses = "bg-slate-800 text-slate-300 border-slate-700";
  if (isFailed) {
    colorClasses = "bg-rose-500/10 text-rose-300 border-rose-500/30";
  } else if (isRunning) {
    colorClasses = "bg-amber-500/10 text-amber-300 border-amber-500/30 animate-pulse";
  } else if (isCompleted) {
    colorClasses = "bg-emerald-500/10 text-emerald-300 border-emerald-500/30";
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${colorClasses}`}>
      {label}
    </span>
  );
}
