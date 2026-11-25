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
import { AlertTriangle, X } from "lucide-react";
import { fmtInr, fmtNum, fmtPct } from "../../lib/format.js";

export function SkuDrawer({ sku, skuAssumptions, onClose }) {
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
          <span className="text-[11px] text-slate-500 font-medium">
            SKU Optimization Details
          </span>
          <h3 className="text-lg font-bold text-white font-mono">
            {sku.sku_id}
          </h3>
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
          Consider reordering{" "}
          <span className="font-bold underline text-white">{sku.eoq}</span>{" "}
          units when inventory position reaches{" "}
          <span className="font-bold underline text-white">
            {sku.s_emp ??
              sku.rop_uncertainty_aware ??
              sku.s_quant ??
              sku.rop_quantile ??
              sku.s_det ??
              sku.rop_deterministic}
          </span>{" "}
          units.
        </p>
      </div>

      {/* SKU Assumptions Panel */}
      {skuAssumptions && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold text-slate-300">
            Assumptions for this SKU
          </span>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-900/60 border border-white/[0.04] p-3.5 rounded-xl">
            <div>
              <span className="text-slate-500 block text-[10px]">
                Ordering Cost (S)
              </span>
              <span className="text-slate-200 font-medium">
                {fmtInr(skuAssumptions.ordering_cost)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">
                Annual Holding Cost (H)
              </span>
              <span className="text-slate-200 font-medium">
                {fmtInr(skuAssumptions.holding_cost_annual)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">
                Shortage Penalty
              </span>
              <span className="text-slate-200 font-medium">
                {fmtInr(skuAssumptions.shortage_penalty)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">
                Lead Time Mean
              </span>
              <span className="text-slate-200 font-medium">
                {skuAssumptions.lead_time_mean} days
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">
                Target Service Level
              </span>
              <span className="text-slate-200 font-medium">
                {fmtPct(skuAssumptions.service_level, 0)}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-[10px]">
                Unit Cost
              </span>
              <span className="text-slate-200 font-medium">
                {fmtInr(skuAssumptions.unit_cost)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Model Intermediates Grid */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-slate-300">
          Model Output & Mathematical Intermediates
        </span>
        <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-slate-900/60 border border-white/[0.04] p-3.5 rounded-xl">
          <div>
            <span className="text-slate-500 block text-[10px]">
              Annual Demand (D)
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.annual_demand, 0)} units
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              EOQ Raw → Int
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.eoq_raw, 2)} → {sku.eoq}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              Expected Lead Demand (mu_L)
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.mu_l, 2)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              Daily Error Std (sigma_d)
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.sigma_daily_error, 2)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              Lead-time Std (sigma_L)
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.sigma_l, 2)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              Normal Z Score
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.z_score, 2)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              Deterministic ROP Raw
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.rop_deterministic_raw, 2)} →{" "}
              {sku.s_det ?? sku.rop_deterministic}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              Quantile ROP Raw
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.rop_quantile_raw, 2)} →{" "}
              {sku.s_quant ?? sku.rop_quantile ?? "—"}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block text-[10px]">
              Uncertainty ROP Raw
            </span>
            <span className="text-slate-200 font-medium">
              {fmtNum(sku.rop_uncertainty_aware_raw, 2)} →{" "}
              {sku.s_emp ?? sku.rop_uncertainty_aware}
            </span>
          </div>
        </div>
      </div>

      {/* Lead-Time Demand Distribution Chart */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-semibold text-slate-300">
          Lead-Time Demand Percentiles
        </span>
        <div className="h-48 w-full bg-slate-900/40 border border-white/[0.04] p-2 rounded-xl">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="#e7e2d8"
                opacity={0.6}
              />
              <XAxis dataKey="name" stroke="#78716c" fontSize={10} />
              <YAxis stroke="#78716c" fontSize={10} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#ffffff",
                  borderColor: "#e7e2d8",
                  color: "#1c1917",
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
                  label={{
                    value: `ROP_d: ${sku.rop_deterministic}`,
                    fill: "#f59e0b",
                    fontSize: 9,
                  }}
                />
              )}
              {sku.rop_quantile && (
                <ReferenceLine
                  y={sku.rop_quantile}
                  stroke="#38bdf8"
                  strokeDasharray="3 3"
                  label={{
                    value: `ROP_q: ${sku.rop_quantile}`,
                    fill: "#38bdf8",
                    fontSize: 9,
                  }}
                />
              )}
              {sku.rop_uncertainty_aware && (
                <ReferenceLine
                  y={sku.rop_uncertainty_aware}
                  stroke="#10b981"
                  strokeDasharray="3 3"
                  label={{
                    value: `ROP_u: ${sku.rop_uncertainty_aware}`,
                    fill: "#10b981",
                    fontSize: 9,
                  }}
                />
              )}
            </BarChart>
          </ResponsiveContainer>
        </div>
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
