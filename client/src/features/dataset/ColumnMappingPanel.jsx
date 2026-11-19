import { useState } from "react";
import { Loader2 } from "lucide-react";

export function ColumnMappingPanel({ columns = [], preview = [], initialMapping, onSubmit, isLoading }) {
  const [skuColumn, setSkuColumn] = useState(initialMapping?.skuColumn || "");
  const [dateColumn, setDateColumn] = useState(initialMapping?.dateColumn || "");
  const [quantityColumn, setQuantityColumn] = useState(initialMapping?.quantityColumn || "");
  const [dateFormat, setDateFormat] = useState(initialMapping?.dateFormat || "iso");
  const [negativeQuantityPolicy, setNegativeQuantityPolicy] = useState(
    initialMapping?.negativeQuantityPolicy || "drop",
  );

  const isValid =
    skuColumn &&
    dateColumn &&
    quantityColumn &&
    skuColumn !== dateColumn &&
    skuColumn !== quantityColumn &&
    dateColumn !== quantityColumn;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!isValid || isLoading) return;
    onSubmit({
      skuColumn,
      dateColumn,
      quantityColumn,
      dateFormat,
      negativeQuantityPolicy,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 flex flex-col gap-5">
        <h3 className="text-sm font-semibold text-slate-200">Map CSV Columns</h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              SKU / Item Identifier <span className="text-rose-400">*</span>
            </label>
            <select
              value={skuColumn}
              onChange={(e) => setSkuColumn(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Select column...</option>
              {columns.map((c) => (
                <option key={c} value={c} disabled={c === dateColumn || c === quantityColumn}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Date Column <span className="text-rose-400">*</span>
            </label>
            <select
              value={dateColumn}
              onChange={(e) => setDateColumn(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Select column...</option>
              {columns.map((c) => (
                <option key={c} value={c} disabled={c === skuColumn || c === quantityColumn}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-slate-300">
              Quantity Sold / Demand <span className="text-rose-400">*</span>
            </label>
            <select
              value={quantityColumn}
              onChange={(e) => setQuantityColumn(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="">Select column...</option>
              {columns.map((c) => (
                <option key={c} value={c} disabled={c === skuColumn || c === dateColumn}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Date format & Negative policy */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-white/[0.06]">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-300">Date Format</span>
            <div className="flex flex-col gap-2 text-xs text-slate-400">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dateFormat"
                  value="iso"
                  checked={dateFormat === "iso"}
                  onChange={() => setDateFormat("iso")}
                  className="accent-indigo-500"
                />
                <span>2011-12-31 (YYYY-MM-DD)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dateFormat"
                  value="dmy"
                  checked={dateFormat === "dmy"}
                  onChange={() => setDateFormat("dmy")}
                  className="accent-indigo-500"
                />
                <span>31/12/2011 (day first)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="dateFormat"
                  value="mdy"
                  checked={dateFormat === "mdy"}
                  onChange={() => setDateFormat("mdy")}
                  className="accent-indigo-500"
                />
                <span>12/31/2011 (month first)</span>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-slate-300">Negative Quantities</span>
            <div className="flex flex-col gap-2 text-xs text-slate-400">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="negativePolicy"
                  value="drop"
                  checked={negativeQuantityPolicy === "drop"}
                  onChange={() => setNegativeQuantityPolicy("drop")}
                  className="accent-indigo-500"
                />
                <span>Exclude negative rows (treated as returns, not demand)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="negativePolicy"
                  value="reject"
                  checked={negativeQuantityPolicy === "reject"}
                  onChange={() => setNegativeQuantityPolicy("reject")}
                  className="accent-indigo-500"
                />
                <span>Stop if any are found</span>
              </label>
            </div>
          </div>
        </div>

        {preview && preview.length > 0 && (
          <div className="flex flex-col gap-2 pt-4 border-t border-white/[0.06]">
            <span className="text-xs font-medium text-slate-400">CSV Data Preview (first 20 rows)</span>
            <div className="overflow-x-auto max-h-56 border border-white/[0.04] rounded-xl bg-slate-950/40">
              <table className="w-full text-left text-[11px] font-mono">
                <thead>
                  <tr className="border-b border-white/[0.06] text-slate-400 bg-white/[0.02]">
                    {columns.map((c) => (
                      <th key={c} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.02] text-slate-300">
                  {preview.map((row, rIdx) => (
                    <tr key={rIdx} className="hover:bg-white/[0.01]">
                      {row.map((cell, cIdx) => (
                        <td key={cIdx} className="px-3 py-1.5 whitespace-nowrap">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={!isValid || isLoading}
          className="self-end px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all cursor-pointer"
        >
          {isLoading ? <Loader2 size={14} className="animate-spin" /> : null}
          <span>Validate Data</span>
        </button>
      </div>
    </form>
  );
}
