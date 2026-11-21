import { useState, useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { COPY } from "../../lib/copy.js";
import { fmtNum, fmtPct } from "../../lib/format.js";

export function ForecastChart({
  skuId,
  skuForecast,
  skuEvaluation,
  historySeries,
}) {
  const [view, setView] = useState("forecast"); // "forecast" | "holdout"

  // 1. Forecast view data: last 90 days of history + 28 days of forecast
  const forecastData = useMemo(() => {
    if (!skuForecast) return [];

    const data = [];
    const histVals = historySeries?.values || [];
    const histStart = historySeries?.startDate
      ? new Date(historySeries.startDate)
      : new Date();

    // Last 90 points of history
    const sliceCount = Math.min(90, histVals.length);
    const startIdx = histVals.length - sliceCount;

    for (let i = startIdx; i < histVals.length; i++) {
      const dt = new Date(histStart.getTime() + i * 86400000);
      data.push({
        date: dt.toISOString().slice(0, 10),
        observed: histVals[i],
        autoets: null,
        seasonalNaive: null,
        bandBase: null,
        bandWidth: null,
      });
    }

    // 28 days forecast
    const fcStartDate = skuForecast.forecast_start_date
      ? new Date(skuForecast.forecast_start_date)
      : new Date();

    const h = skuForecast.autoets_mean?.length || 28;
    for (let i = 0; i < h; i++) {
      const dt = new Date(fcStartDate.getTime() + i * 86400000);
      const p10 = skuForecast.intervals?.p10?.[i] ?? null;
      const p90 = skuForecast.intervals?.p90?.[i] ?? null;
      const hasBand = p10 !== null && p90 !== null;

      data.push({
        date: dt.toISOString().slice(0, 10),
        observed: null,
        autoets: skuForecast.autoets_mean?.[i] ?? null,
        seasonalNaive: skuForecast.seasonal_naive_mean?.[i] ?? null,
        bandBase: hasBand ? p10 : null,
        bandWidth: hasBand ? Math.max(0, p90 - p10) : null,
      });
    }

    return data;
  }, [skuForecast, historySeries]);

  // 2. Holdout check data: 28 days holdout
  const holdoutData = useMemo(() => {
    if (!skuEvaluation || !skuEvaluation.actual) return [];

    const data = [];
    const holdoutStart = skuEvaluation.holdout_start_date
      ? new Date(skuEvaluation.holdout_start_date)
      : new Date();

    const n = skuEvaluation.actual.length;
    for (let i = 0; i < n; i++) {
      const dt = new Date(holdoutStart.getTime() + i * 86400000);
      const p10 = skuEvaluation.intervals?.p10?.[i] ?? null;
      const p90 = skuEvaluation.intervals?.p90?.[i] ?? null;
      const hasBand = p10 !== null && p90 !== null;

      data.push({
        date: dt.toISOString().slice(0, 10),
        actual: skuEvaluation.actual[i],
        autoets: skuEvaluation.autoets_mean?.[i] ?? null,
        seasonalNaive: skuEvaluation.seasonal_naive_mean?.[i] ?? null,
        bandBase: hasBand ? p10 : null,
        bandWidth: hasBand ? Math.max(0, p90 - p10) : null,
      });
    }

    return data;
  }, [skuEvaluation]);

  // Summary statistics
  const avgForecast = useMemo(() => {
    if (!skuForecast?.autoets_mean) return null;
    const sum = skuForecast.autoets_mean.reduce((a, b) => a + b, 0);
    return sum / skuForecast.autoets_mean.length;
  }, [skuForecast]);

  const avgP10 = useMemo(() => {
    if (!skuForecast?.intervals?.p10) return null;
    const sum = skuForecast.intervals.p10.reduce((a, b) => a + b, 0);
    return sum / skuForecast.intervals.p10.length;
  }, [skuForecast]);

  const avgP90 = useMemo(() => {
    if (!skuForecast?.intervals?.p90) return null;
    const sum = skuForecast.intervals.p90.reduce((a, b) => a + b, 0);
    return sum / skuForecast.intervals.p90.length;
  }, [skuForecast]);

  const isHoldoutView = view === "holdout";
  const chartData = isHoldoutView ? holdoutData : forecastData;

  return (
    <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-4 shadow-xl">
      {/* Header & Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="font-mono text-xs font-semibold text-indigo-400">
            {skuId}
          </span>
          <p className="text-xs text-slate-300 font-medium mt-0.5">
            {skuId}: AutoETS averages {fmtNum(avgForecast, 1)} units/day over
            the next 28 days; P10-P90 average {fmtNum(avgP10, 1)}-
            {fmtNum(avgP90, 1)}.
          </p>
        </div>

        <div className="flex items-center rounded-xl bg-slate-900 border border-white/[0.08] p-1 self-start">
          <button
            type="button"
            onClick={() => setView("forecast")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              view === "forecast"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Forecast
          </button>
          <button
            type="button"
            onClick={() => setView("holdout")}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              view === "holdout"
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            Holdout Check
          </button>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
          >
            <XAxis
              dataKey="date"
              tickLine={false}
              stroke="#64748b"
              fontSize={10}
              tickFormatter={(v) => v.slice(5)}
            />
            <YAxis tickLine={false} stroke="#64748b" fontSize={10} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#13151c",
                borderColor: "rgba(255,255,255,0.1)",
                borderRadius: "0.75rem",
                fontSize: "11px",
              }}
            />

            {/* P10-P90 band: stacked area */}
            <Area
              type="monotone"
              dataKey="bandBase"
              stackId="band"
              stroke="none"
              fill="transparent"
            />
            <Area
              type="monotone"
              dataKey="bandWidth"
              stackId="band"
              stroke="none"
              fill="#6366f1"
              fillOpacity={0.15}
            />

            {/* Lines */}
            {!isHoldoutView && (
              <Line
                type="monotone"
                dataKey="observed"
                name="Observed"
                stroke="#94a3b8"
                strokeWidth={1.5}
                dot={false}
              />
            )}
            {isHoldoutView && (
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual"
                stroke="#94a3b8"
                strokeWidth={1.5}
                dot={false}
              />
            )}
            <Line
              type="monotone"
              dataKey="autoets"
              name="AutoETS forecast"
              stroke="#6366f1"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="seasonalNaive"
              name="Seasonal Naive"
              stroke="#f59e0b"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
            />

            {!isHoldoutView && skuForecast?.forecast_start_date && (
              <ReferenceLine
                x={skuForecast.forecast_start_date}
                stroke="#e2e8f0"
                strokeDasharray="3 3"
                label={{
                  value: "Forecast starts",
                  fill: "#94a3b8",
                  fontSize: 10,
                }}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Legend & Notes */}
      <div className="flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-slate-400 inline-block" />
          <span>{isHoldoutView ? "Actual" : "Observed"}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-indigo-500 inline-block" />
          <span>AutoETS forecast</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-0.5 bg-amber-500 border-dashed border-b inline-block" />
          <span>Seasonal Naive</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 bg-indigo-500/20 rounded inline-block" />
          <span>P10-P90 band</span>
        </div>
      </div>

      {/* Holdout metrics table if holdout view */}
      {isHoldoutView && skuEvaluation && (
        <div className="mt-2 border-t border-white/[0.06] pt-3 overflow-x-auto">
          <table className="w-full text-left text-xs font-mono">
            <thead>
              <tr className="border-b border-white/[0.04] text-slate-500">
                <th scope="col" className="py-1">
                  Model
                </th>
                <th scope="col" className="py-1 text-right">
                  MAE
                </th>
                <th scope="col" className="py-1 text-right">
                  RMSE
                </th>
                <th scope="col" className="py-1 text-right">
                  WAPE
                </th>
                <th scope="col" className="py-1 text-right">
                  Coverage
                </th>
                <th scope="col" className="py-1 text-right">
                  Width
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02] text-slate-300">
              <tr>
                <td className="py-1 font-sans text-indigo-300">AutoETS</td>
                <td className="py-1 text-right">
                  {fmtNum(skuEvaluation.autoets?.mae, 2)}
                </td>
                <td className="py-1 text-right">
                  {fmtNum(skuEvaluation.autoets?.rmse, 2)}
                </td>
                <td className="py-1 text-right">
                  {fmtPct(skuEvaluation.autoets?.wape, 1)}
                </td>
                <td className="py-1 text-right">
                  {fmtPct(skuEvaluation.interval_metrics?.coverage, 1)}
                </td>
                <td className="py-1 text-right">
                  {fmtNum(skuEvaluation.interval_metrics?.mean_width, 1)}
                </td>
              </tr>
              <tr>
                <td className="py-1 font-sans text-amber-300">
                  Seasonal Naive
                </td>
                <td className="py-1 text-right">
                  {fmtNum(skuEvaluation.seasonal_naive?.mae, 2)}
                </td>
                <td className="py-1 text-right">
                  {fmtNum(skuEvaluation.seasonal_naive?.rmse, 2)}
                </td>
                <td className="py-1 text-right">
                  {fmtPct(skuEvaluation.seasonal_naive?.wape, 1)}
                </td>
                <td className="py-1 text-right">-</td>
                <td className="py-1 text-right">-</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[11px] text-slate-500 flex flex-col gap-1 border-t border-white/[0.04] pt-2">
        <p>{COPY.intervalDisclaimer}</p>
        <p>{COPY.seriesNote}</p>
      </div>
    </div>
  );
}
