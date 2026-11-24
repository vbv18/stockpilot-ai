export function getDemandClassBadge(demandClass) {
  switch (demandClass) {
    case "smooth":
      return {
        label: "Smooth",
        className:
          "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
      };
    case "erratic":
      return {
        label: "Erratic",
        className: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
      };
    case "intermittent":
      return {
        label: "Intermittent",
        className: "bg-blue-500/10 text-blue-400 border border-blue-500/20",
      };
    case "lumpy":
      return {
        label: "Lumpy",
        className: "bg-rose-500/10 text-rose-400 border border-rose-500/20",
      };
    default:
      return {
        label: demandClass || "Unknown",
        className: "bg-slate-800 text-slate-400 border border-slate-700",
      };
  }
}
