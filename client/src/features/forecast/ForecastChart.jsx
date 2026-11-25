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
import { getDemandClassBadge } from "./demandClassBadge.js";

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
      const actualVal = skuEvaluation.actual[i];
      const isInside = hasBand ? actualVal >= p10 && actualVal <= p90 : null;

      data.push({
        date: dt.toISOString().slice(0, 10),
        actual: actualVal,
        isInside,
        autoets: skuEvaluation.autoets_mean?.[i] ?? null,
        seasonalNaive: skuEvaluation.seasonal_naive_mean?.[i] ?? null,
        bandBase: hasBand ? p10 : null,
        bandWidth: hasBand ? Math.max(0, p90 - p10) : null,
        p10,
        p90,
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
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-indigo-400">
              {skuId}
            </span>
            {skuForecast?.demand_class && (
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-sans font-medium uppercase tracking-wider ${
                  getDemandClassBadge(skuForecast.demand_class).className
                }`}
              >
                {getDemandClassBadge(skuForecast.demand_class).label}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-300 font-medium mt-0.5">
            {skuId}: {skuForecast?.autoets_model_spec || "AutoETS"} averages{" "}
            {fmtNum(avgForecast, 1)} units/day over the next 28 days; P10-P90
            average {fmtNum(avgP10, 1)}-{fmtNum(avgP90, 1)}.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isHoldoutView && skuEvaluation?.interval_metrics && (
            <span
              className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold border ${
                (skuEvaluation.coverage_minus_nominal ??
                  skuEvaluation.interval_metrics.coverage - 0.8) >= -0.05
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                  : "bg-amber-500/10 text-amber-300 border-amber-500/20"
              }`}
            >
              Coverage: {fmtPct(skuEvaluation.interval_metrics.coverage, 1)}{" "}
              (Nominal 80%,{" "}
              {(skuEvaluation.coverage_minus_nominal ??
                skuEvaluation.interval_metrics.coverage - 0.8) >= 0
                ? "+"
                : ""}
              {fmtPct(
                skuEvaluation.coverage_minus_nominal ??
                  skuEvaluation.interval_metrics.coverage - 0.8,
                1,
              )}
              )
            </span>
          )}

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
                backgroundColor: "#ffffff",
                borderColor: "#e5dfd5",
                color: "#1c1917",
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
                dot={(props) => {
                  const { cx, cy, payload } = props;
                  if (cx == null || cy == null || payload?.actual == null)
                    return null;
                  const isInside = payload.isInside;
                  const fill = isInside ? "#10b981" : "#ef4444";
                  return (
                    <circle
                      key={`dot-${payload.date}`}
                      cx={cx}
                      cy={cy}
                      r={3.5}
                      fill={fill}
                      stroke="#0f172a"
                      strokeWidth={1.5}
                    />
                  );
                }}
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
        {isHoldoutView ? (
          <>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
              <span>Actual inside P10-P90</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
              <span>Actual outside P10-P90</span>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-0.5 bg-slate-400 inline-block" />
            <span>Observed</span>
          </div>
        )}
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
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold text-slate-300">
                8-Origin Rolling Evaluation & Selection
              </span>
              {skuEvaluation.chosen_model && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-sans font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Winner: {skuEvaluation.chosen_model}
                </span>
              )}
            </div>
            {skuEvaluation.baseline_improvement && (
              <span className="text-[11px] font-mono text-emerald-400">
                vs Naive: MAE +
                {fmtNum(skuEvaluation.baseline_improvement.mae_pct, 1)}% | RMSE
                +{fmtNum(skuEvaluation.baseline_improvement.rmse_pct, 1)}% |
                WAPE +{fmtNum(skuEvaluation.baseline_improvement.wape_pct, 1)}%
              </span>
            )}
          </div>
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
                  MASE
                </th>
                <th scope="col" className="py-1 text-right">
                  Pinball
                </th>
                <th scope="col" className="py-1 text-right">
                  Coverage (80%)
                </th>
                <th scope="col" className="py-1 text-center">
                  Winner
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.02] text-slate-300">
              {[
                {
                  key: "AutoETS",
                  name: "AutoETS",
                  metrics:
                    skuEvaluation.models?.AutoETS || skuEvaluation.autoets,
                  isChosen: skuEvaluation.chosen_model === "AutoETS",
                },
                {
                  key: "SeasonalNaive",
                  name: "Seasonal Naive",
                  metrics:
                    skuEvaluation.models?.SeasonalNaive ||
                    skuEvaluation.seasonal_naive,
                  isChosen: skuEvaluation.chosen_model === "SeasonalNaive",
                },
                ...(skuEvaluation.models?.GlobalLGBM ||
                skuEvaluation.global_lgbm
                  ? [
                      {
                        key: "GlobalLGBM",
                        name: "Global LGBM",
                        metrics:
                          skuEvaluation.models?.GlobalLGBM ||
                          skuEvaluation.global_lgbm,
                        isChosen: skuEvaluation.chosen_model === "GlobalLGBM",
                      },
                    ]
                  : []),
                ...(skuEvaluation.models?.Naive || skuEvaluation.naive
                  ? [
                      {
                        key: "Naive",
                        name: "Naive",
                        metrics:
                          skuEvaluation.models?.Naive || skuEvaluation.naive,
                        isChosen: skuEvaluation.chosen_model === "Naive",
                      },
                    ]
                  : []),
                ...(skuEvaluation.models?.CrostonSBA ||
                skuEvaluation.croston_sba
                  ? [
                      {
                        key: "CrostonSBA",
                        name: "Croston SBA",
                        metrics:
                          skuEvaluation.models?.CrostonSBA ||
                          skuEvaluation.croston_sba,
                        isChosen: skuEvaluation.chosen_model === "CrostonSBA",
                      },
                    ]
                  : []),
              ].map(({ key, name, metrics, isChosen }) => (
                <tr
                  key={key}
                  className={
                    isChosen
                      ? "bg-indigo-600/15 font-semibold text-white border-l-2 border-indigo-500"
                      : ""
                  }
                >
                  <td className="py-1.5 px-2 font-sans flex items-center gap-1.5">
                    <span>{name}</span>
                    {isChosen && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-sans font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Winner
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 text-right">
                    {fmtNum(metrics?.mae, 2)}
                  </td>
                  <td className="py-1.5 text-right">
                    {fmtNum(metrics?.rmse, 2)}
                  </td>
                  <td className="py-1.5 text-right">
                    {fmtPct(metrics?.wape, 1)}
                  </td>
                  <td
                    className={`py-1.5 text-right ${isChosen ? "text-indigo-300 font-bold" : ""}`}
                  >
                    {fmtNum(metrics?.mase, 3)}
                  </td>
                  <td className="py-1.5 text-right">
                    {fmtNum(metrics?.pinball_loss, 2)}
                  </td>
                  <td className="py-1.5 text-right">
                    {fmtPct(
                      metrics?.coverage ??
                        skuEvaluation.interval_metrics?.coverage,
                      1,
                    )}
                  </td>
                  <td className="py-1.5 text-center font-sans">
                    {isChosen ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        Winner
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-500">
                        Candidate
                      </span>
                    )}
                  </td>
                </tr>
              ))}
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
