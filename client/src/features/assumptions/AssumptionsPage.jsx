import { useState, useMemo, useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  Loader2,
  Play,
} from "lucide-react";
import { COPY } from "../../lib/copy.js";
import { fmtDateTime, fmtInr, fmtPct } from "../../lib/format.js";
import {
  useCreateAssumptionsMutation,
  useGetAssumptionDefaultsQuery,
  useListAssumptionsQuery,
  useGetForecastQuery,
} from "../../lib/api.js";
import { skuAssumptionRowSchema } from "./schema.js";

export default function AssumptionsPage() {
  const { session } = useOutletContext();
  const navigate = useNavigate();

  const { data: defaultsData } = useGetAssumptionDefaultsQuery(session.id);
  const { data: versionsList = [] } = useListAssumptionsQuery(session.id);
  const { data: forecastData } = useGetForecastQuery(session.id);
  const [createAssumptions, { isLoading: isSubmitting }] =
    useCreateAssumptionsMutation();

  const latestVersion = versionsList.length > 0 ? versionsList[0] : null;

  // Determine list of SKUs in the session
  const skuIds = useMemo(() => {
    if (defaultsData?.skuIds && defaultsData.skuIds.length > 0) {
      return defaultsData.skuIds;
    }
    if (latestVersion?.skus && Object.keys(latestVersion.skus).length > 0) {
      return Object.keys(latestVersion.skus);
    }
    if (forecastData?.eligibleSkuIds && forecastData.eligibleSkuIds.length > 0) {
      return forecastData.eligibleSkuIds;
    }
    if (forecastData?.forecast?.skus && forecastData.forecast.skus.length > 0) {
      return forecastData.forecast.skus.map((s) => s.sku_id);
    }
    if (defaultsData?.skus && Object.keys(defaultsData.skus).length > 0) {
      return Object.keys(defaultsData.skus);
    }
    return [];
  }, [defaultsData, latestVersion, forecastData]);

  const defaultRowValues = useMemo(
    () => ({
      ordering_cost: 200,
      holding_cost_annual: 1825,
      shortage_penalty: 50,
      lead_time_mean: 7,
      lead_time_std: 0,
      service_level: 0.95,
      unit_cost: 100,
    }),
    [],
  );

  // Form rows state: { [skuId]: { ordering_cost, holding_cost_annual, shortage_penalty, lead_time_mean, lead_time_std, service_level, unit_cost } }
  const [rows, setRows] = useState({});
  const [budget, setBudget] = useState("");
  const [capacity, setCapacity] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [initializedKey, setInitializedKey] = useState(null);

  const currentKey =
    latestVersion?.id || (skuIds.length > 0 ? "defaults" : null);

  useEffect(() => {
    if (!currentKey || initializedKey === currentKey || skuIds.length === 0) {
      return;
    }

    const initialRows = {};
    for (const skuId of skuIds) {
      const src =
        latestVersion?.skus?.[skuId] ||
        defaultsData?.skus?.[skuId] ||
        defaultRowValues;

      initialRows[skuId] = {
        ordering_cost: src.ordering_cost ?? defaultRowValues.ordering_cost,
        holding_cost_annual:
          src.holding_cost_annual ?? defaultRowValues.holding_cost_annual,
        shortage_penalty:
          src.shortage_penalty ?? defaultRowValues.shortage_penalty,
        lead_time_mean: src.lead_time_mean ?? defaultRowValues.lead_time_mean,
        lead_time_std: src.lead_time_std ?? defaultRowValues.lead_time_std,
        service_level: src.service_level ?? defaultRowValues.service_level,
        unit_cost: src.unit_cost ?? defaultRowValues.unit_cost,
      };
    }
    setRows(initialRows);

    if (session?.budget !== undefined && session?.budget !== null) {
      setBudget(session.budget);
    } else if (
      latestVersion?.budget !== undefined &&
      latestVersion?.budget !== null
    ) {
      setBudget(latestVersion.budget);
    }

    if (session?.capacity !== undefined && session?.capacity !== null) {
      setCapacity(session.capacity);
    } else if (
      latestVersion?.capacity !== undefined &&
      latestVersion?.capacity !== null
    ) {
      setCapacity(latestVersion.capacity);
    }

    setInitializedKey(currentKey);
  }, [
    currentKey,
    initializedKey,
    skuIds,
    latestVersion,
    defaultsData,
    defaultRowValues,
    session?.budget,
    session?.capacity,
  ]);

  const handleCellChange = (skuId, field, rawValue) => {
    setRows((prev) => ({
      ...prev,
      [skuId]: {
        ...(prev[skuId] || defaultRowValues),
        [field]: rawValue === "" ? "" : Number(rawValue),
      },
    }));
  };

  // Validation per row
  const validationResults = useMemo(() => {
    const rowStatus = {};
    let allValid = skuIds.length > 0;

    for (const skuId of skuIds) {
      const row = rows[skuId];
      if (!row) {
        rowStatus[skuId] = { valid: false, errors: { _row: "Missing row" } };
        allValid = false;
        continue;
      }
      const parsed = skuAssumptionRowSchema.safeParse(row);
      if (!parsed.success) {
        const fieldErrors = {};
        for (const issue of parsed.error.issues) {
          fieldErrors[issue.path[0]] = issue.message;
        }
        rowStatus[skuId] = { valid: false, errors: fieldErrors };
        allValid = false;
      } else {
        rowStatus[skuId] = { valid: true, errors: {} };
      }
    }
    return { rowStatus, allValid };
  }, [skuIds, rows]);

  const isAllValid = validationResults.allValid;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAllValid || !confirmed || isSubmitting || skuIds.length === 0) return;
    setSubmitError("");

    const parsedPayload = {};
    for (const skuId of skuIds) {
      parsedPayload[skuId] = skuAssumptionRowSchema.parse(rows[skuId]);
    }

    const numBudget =
      budget === "" || budget === null || budget === undefined
        ? null
        : Number(budget);
    const numCapacity =
      capacity === "" || capacity === null || capacity === undefined
        ? null
        : Number(capacity);

    if (numBudget !== null && (Number.isNaN(numBudget) || numBudget <= 0)) {
      setSubmitError("Budget must be a positive number if provided.");
      return;
    }
    if (
      numCapacity !== null &&
      (Number.isNaN(numCapacity) || numCapacity <= 0)
    ) {
      setSubmitError("Capacity must be a positive number if provided.");
      return;
    }

    try {
      await createAssumptions({
        id: session.id,
        body: {
          skus: parsedPayload,
          confirmed: true,
          budget: numBudget,
          capacity: numCapacity,
        },
      }).unwrap();

      navigate(`/sessions/${session.id}/optimization`);
    } catch (err) {
      setSubmitError(
        err.data?.message || err.message || "Failed to save assumptions.",
      );
    }
  };

  const handlePrefillFromVersion = (ver) => {
    if (ver.budget !== undefined && ver.budget !== null) {
      setBudget(ver.budget);
    }
    if (ver.capacity !== undefined && ver.capacity !== null) {
      setCapacity(ver.capacity);
    }
    if (!ver.skus) return;
    setRows((prev) => {
      const next = { ...prev };
      for (const skuId of skuIds) {
        if (ver.skus[skuId]) {
          next[skuId] = { ...ver.skus[skuId] };
        }
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-6 max-w-7xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Per-SKU Inventory Assumptions
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Configure independent operational costs, supplier lead times, and
          service level targets for each SKU in this session.
        </p>
      </div>

      <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3 text-xs text-amber-300">
        <Info size={16} className="shrink-0" />
        <span>{COPY.assumptionsLabel}</span>
      </div>

      {submitError && (
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl p-3 text-xs text-rose-300 flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{submitError}</span>
        </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 flex flex-col gap-6 shadow-xl"
      >
        {/* Session Constraints */}
        <div className="bg-[#0d0f14]/80 border border-white/[0.06] rounded-xl p-5 flex flex-col gap-4">
          <div>
            <h4 className="text-xs font-semibold text-slate-200">
              Session Portfolio Constraints
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Set session-level inventory boundaries. Both are optional here, but at least one must be set to run multi-SKU Portfolio Optimization.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Max Total Budget (₹)
              </label>
              <input
                type="number"
                step="any"
                min="1"
                placeholder="e.g. 500000"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Upper limit on total inventory investment: sum(avg_inventory_i · unit_cost_i) ≤ budget
              </span>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-300 mb-1">
                Max Total Capacity (units)
              </label>
              <input
                type="number"
                step="any"
                min="1"
                placeholder="e.g. 10000"
                value={capacity}
                onChange={(e) => setCapacity(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <span className="text-[10px] text-slate-500 mt-1 block">
                Upper limit on total units across all SKUs: sum(avg_inventory_i) ≤ capacity
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div>
            <h3 className="text-xs font-semibold text-slate-200">
              Assumptions Table ({skuIds.length} SKUs)
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Edit individual cell values. Service level must be between 0.80
              and 0.99. Lead time mean must be between 1 and 28 days.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-[11px] px-2.5 py-1 rounded-lg font-medium flex items-center gap-1.5 ${
                isAllValid
                  ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
                  : "bg-rose-500/10 text-rose-300 border border-rose-500/20"
              }`}
            >
              {isAllValid ? (
                <>
                  <CheckCircle size={12} />
                  <span>All rows valid</span>
                </>
              ) : (
                <>
                  <AlertCircle size={12} />
                  <span>Pending validation</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Editable Table */}
        <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0d0f14]/80">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-white/[0.08] text-slate-400 bg-white/[0.02]">
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  SKU
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  Ordering Cost (₹)
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  Annual Holding (₹)
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  Shortage Penalty (₹)
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  Lead Time Mean (d)
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  Lead Time Std (d)
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  Service Level (0.80–0.99)
                </th>
                <th scope="col" className="px-3 py-3 font-semibold text-slate-300">
                  Unit Cost (₹)
                </th>
                <th scope="col" className="px-2 py-3 text-center font-semibold text-slate-400">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] text-slate-200 font-mono">
              {skuIds.map((skuId) => {
                const row = rows[skuId] || defaultRowValues;
                const status = validationResults.rowStatus[skuId] || {
                  valid: true,
                  errors: {},
                };
                const errs = status.errors;

                return (
                  <tr
                    key={skuId}
                    className={`hover:bg-white/[0.02] transition-colors ${
                      !status.valid ? "bg-rose-500/[0.02]" : ""
                    }`}
                  >
                    <td className="px-3 py-2 font-sans font-bold text-slate-100 whitespace-nowrap">
                      {skuId}
                    </td>

                    {/* ordering_cost */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        value={row.ordering_cost ?? ""}
                        onChange={(e) =>
                          handleCellChange(skuId, "ordering_cost", e.target.value)
                        }
                        className={`w-28 bg-slate-900 border rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 ${
                          errs.ordering_cost
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-slate-700"
                        }`}
                        title={errs.ordering_cost}
                      />
                    </td>

                    {/* holding_cost_annual */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        value={row.holding_cost_annual ?? ""}
                        onChange={(e) =>
                          handleCellChange(
                            skuId,
                            "holding_cost_annual",
                            e.target.value,
                          )
                        }
                        className={`w-28 bg-slate-900 border rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 ${
                          errs.holding_cost_annual
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-slate-700"
                        }`}
                        title={errs.holding_cost_annual}
                      />
                    </td>

                    {/* shortage_penalty */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        value={row.shortage_penalty ?? ""}
                        onChange={(e) =>
                          handleCellChange(
                            skuId,
                            "shortage_penalty",
                            e.target.value,
                          )
                        }
                        className={`w-28 bg-slate-900 border rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 ${
                          errs.shortage_penalty
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-slate-700"
                        }`}
                        title={errs.shortage_penalty}
                      />
                    </td>

                    {/* lead_time_mean */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="1"
                        min="1"
                        max="28"
                        value={row.lead_time_mean ?? ""}
                        onChange={(e) =>
                          handleCellChange(
                            skuId,
                            "lead_time_mean",
                            e.target.value,
                          )
                        }
                        className={`w-24 bg-slate-900 border rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 ${
                          errs.lead_time_mean
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-slate-700"
                        }`}
                        title={errs.lead_time_mean}
                      />
                    </td>

                    {/* lead_time_std */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        max="28"
                        value={row.lead_time_std ?? ""}
                        onChange={(e) =>
                          handleCellChange(
                            skuId,
                            "lead_time_std",
                            e.target.value,
                          )
                        }
                        className={`w-24 bg-slate-900 border rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 ${
                          errs.lead_time_std
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-slate-700"
                        }`}
                        title={errs.lead_time_std}
                      />
                    </td>

                    {/* service_level */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="0.01"
                        min="0.80"
                        max="0.99"
                        value={row.service_level ?? ""}
                        onChange={(e) =>
                          handleCellChange(
                            skuId,
                            "service_level",
                            e.target.value,
                          )
                        }
                        className={`w-28 bg-slate-900 border rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 ${
                          errs.service_level
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-slate-700"
                        }`}
                        title={errs.service_level}
                      />
                    </td>

                    {/* unit_cost */}
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0.01"
                        value={row.unit_cost ?? ""}
                        onChange={(e) =>
                          handleCellChange(skuId, "unit_cost", e.target.value)
                        }
                        className={`w-28 bg-slate-900 border rounded-lg px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 ${
                          errs.unit_cost
                            ? "border-rose-500 bg-rose-500/10"
                            : "border-slate-700"
                        }`}
                        title={errs.unit_cost}
                      />
                    </td>

                    <td className="px-2 py-1.5 text-center">
                      {status.valid ? (
                        <CheckCircle
                          size={14}
                          className="text-emerald-400 mx-auto"
                        />
                      ) : (
                        <AlertCircle
                          size={14}
                          className="text-rose-400 mx-auto"
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Confirmation & Submission Bar */}
        <div className="pt-4 border-t border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300 font-medium">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="accent-indigo-500 w-4 h-4 cursor-pointer"
            />
            <span>I confirm these per-SKU assumptions for this analysis</span>
          </label>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {!isAllValid && (
              <span className="text-xs text-rose-400 font-sans">
                Every row must have valid parameters to run optimization.
              </span>
            )}

            <button
              type="submit"
              disabled={!isAllValid || !confirmed || isSubmitting || skuIds.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
            >
              {isSubmitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              <span>Run Optimization</span>
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </form>

      {/* Previous Versions Collapsible */}
      {versionsList.length > 0 && (
        <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setShowHistory((prev) => !prev)}
            className="flex items-center justify-between text-xs font-semibold text-slate-300 cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <History size={15} className="text-indigo-400" />
              <span>Assumption Versions History ({versionsList.length})</span>
            </div>
            {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>

          {showHistory && (
            <div className="divide-y divide-white/[0.04] mt-2">
              {versionsList.map((v) => {
                const skuCount = v.skus ? Object.keys(v.skus).length : 0;
                return (
                  <div
                    key={v.id}
                    className="py-3 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-semibold text-slate-200">
                        Version {v.version}
                      </span>
                      <span className="text-slate-500 ml-2">
                        Confirmed {fmtDateTime(v.confirmedAt)}
                      </span>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Configured {skuCount} SKUs with per-SKU parameters
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handlePrefillFromVersion(v)}
                      className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded-lg text-slate-200 cursor-pointer"
                    >
                      Use these values
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}