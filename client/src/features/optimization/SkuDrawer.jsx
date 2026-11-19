import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle, ShieldAlert, X } from "lucide-react";
import { COPY } from "../../lib/copy.js";
import { fmtNum } from "../../lib/format.js";

export function SkuDrawer({ sku, risk, onClose }) {
  if (!sku) return null;

  const ltd = sku.ltd || {};
  const chartData = [
    { name: "P10", value: ltd.p10 ?? 0 },
    { name: "P50", value: ltd.p50 ?? 0 },
    { name: "Mean", value: ltd.mean ?? 0 },
    { name: "P90", value: ltd.p90 ?? 0 },
  ];

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[500px] bg-[#13151c] border-l border-white/[0.08] shadow-2xl z-50 p-6 flex flex-col gap-6 overflow-y-auto">
      <div className="flex items-center justify-between pb-3 border-b border-white/[0.06]">
        <div>
          <span className="text-[11px] text-slate-500 font-medium">SKU Optimization Details</span>
          <h3 className="text-lg font-bold text-white font-mono">{sku.sku_id}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* FR-09: Distinction between Model Output and Recommendation */}
      <div className="bg-indigo-600/10 border border-indigo-500/30 rounded-2xl p-4 flex flex-col gap-1.5 shadow-sm">
        <span className="text-[10px] font-bold text-indigo-400 tracking-wider uppercase">
          Recommendation (Decision Support)
        </span>
        <p className="text-xs text-indigo-100 font-medium leading-relaxed">
          Consider reordering <span className="font-bold underline text-white">{sku.eoq}</span> units when inventory position reaches{" "}
          <span className="font-bold underline text-white">{sku.rop_uncertainty_aware ?? sku.rop_deterministic}</span> units.
        </p>
      </div>

      {/* Model Intermediates Grid */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-slate-300">Model Output & Mathematical Intermediates</span>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-900/60 border border-white/[0.04] p-3.5 rounded-xl">
          <div>
            <span className="text-slate-500 block text-[10px]">Annual Demand (D)</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.annual_demand, 0)} units</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">EOQ Raw → Int</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.eoq_raw, 2)} → {sku.eoq}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Expected Lead Demand (mu_L)</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.mu_l, 2)}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Daily Error Std (sigma_d)</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.sigma_daily_error, 2)}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Lead-time Std (sigma_L)</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.sigma_l, 2)}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Normal Z Score</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.z_score, 2)}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Deterministic ROP Raw</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.rop_deterministic_raw, 2)} → {sku.rop_deterministic}</span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">Uncertainty ROP Raw</span>
            <span className="text-slate-200 font-medium">{fmtNum(sku.rop_uncertainty_aware_raw, 2)} → {sku.rop_uncertainty_aware}</span>
          </div>
        </div>
      </div>

      {/* Lead-Time Demand Distribution Chart */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-slate-300">Lead-Time Demand Percentiles</span>
        <div className="h-48 w-full bg-slate-900/40 border border-white/[0.04] p-2 rounded-xl">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis dataKey="name" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={10} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#13151c",
                  borderColor: "rgba(255,255,255,0.1)",
                  borderRadius: "0.5rem",
                  fontSize: "11px",
                }}
              />
              <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} />
              {sku.rop_deterministic && (
                <ReferenceLine
                  y={sku.rop_deterministic}
                  stroke="#f59e0b"
                  strokeDasharray="3 3"
                  label={{ value: `ROP_d: ${sku.rop_deterministic}`, fill: "#f59e0b", fontSize: 9 }}
                />
              )}
              {sku.rop_uncertainty_aware && (
                <ReferenceLine
                  y={sku.rop_uncertainty_aware}
                  stroke="#10b981"
                  strokeDasharray="3 3"
                  label={{ value: `ROP_u: ${sku.rop_uncertainty_aware}`, fill: "#10b981", fontSize: 9 }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Risk Flags & Screen Criteria */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300">Risk Assessment</span>
          <span
            className={`text-[10px] font-semibold px-2 py-0.5 rounded uppercase ${
              risk?.level === "high"
                ? "bg-rose-500/20 text-rose-300"
                : risk?.level === "medium"
                ? "bg-amber-500/20 text-amber-300"
                : "bg-emerald-500/20 text-emerald-300"
            }`}
          >
            {risk?.level || "low"} risk ({risk?.score || 0} flags)
          </span>
        </div>

        {risk?.flags && risk.flags.length > 0 ? (
          <div className="flex flex-col gap-2">
            {risk.flags.map((flag, idx) => (
              <div
                key={idx}
                className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 flex flex-col gap-1 text-xs"
              >
                <div className="flex items-center gap-1.5 text-rose-300 font-semibold">
                  <ShieldAlert size={14} />
                  <span>{flag.code.replace(/_/g, " ")}</span>
                </div>
                <p className="text-rose-200/80 text-[11px] leading-relaxed">{flag.message}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-3 flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle size={15} />
            <span>No screening risk flags triggered for this SKU.</span>
          </div>
        )}
        <p className="text-[10px] text-slate-500 mt-1">{COPY.riskCriteria}</p>
      </div>

      {/* Engine Warnings */}
      {sku.warnings && sku.warnings.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3.5 flex flex-col gap-1.5 text-xs text-amber-200">
          <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
            <AlertTriangle size={14} />
            <span>Engine Warnings</span>
          </div>
          <ul className="list-disc list-inside text-[11px] flex flex-col gap-1">
            {sku.warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
