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
import { fmtDateTime } from "../../lib/format.js";
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
    if (
      forecastData?.eligibleSkuIds &&
      forecastData.eligibleSkuIds.length > 0
    ) {
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
      unit_cost: 100,
      order_cost: 200,
      holding_rate: 18.25,
      shortage_cost: 50,
      lead_time_mean: 7,
      lead_time_std: 0,
      target_service_level: 0.95,
      moq: 1,
      pack_size: 1,
      initial_stock: 0,
    }),
    [],
  );

  // Form rows state: { [skuId]: { sku_id, unit_cost, order_cost, holding_rate, shortage_cost, lead_time_mean, lead_time_std, target_service_level, moq, pack_size, initial_stock } }
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
        sku_id: skuId,
        unit_cost: src.unit_cost ?? defaultRowValues.unit_cost,
        order_cost:
          src.order_cost ?? src.ordering_cost ?? defaultRowValues.order_cost,
        holding_rate:
          src.holding_rate ??
          src.holding_cost_annual ??
          defaultRowValues.holding_rate,
        shortage_cost:
          src.shortage_cost ??
          src.shortage_penalty ??
          defaultRowValues.shortage_cost,
        lead_time_mean: src.lead_time_mean ?? defaultRowValues.lead_time_mean,
        lead_time_std: src.lead_time_std ?? defaultRowValues.lead_time_std,
        target_service_level:
          src.target_service_level ??
          src.service_level ??
          defaultRowValues.target_service_level,
        moq: src.moq ?? defaultRowValues.moq,
        pack_size: src.pack_size ?? defaultRowValues.pack_size,
        initial_stock: src.initial_stock ?? defaultRowValues.initial_stock,
      };
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
        ...(prev[skuId] || { ...defaultRowValues, sku_id: skuId }),
        sku_id: skuId,
        [field]: rawValue === "" ? "" : Number(rawValue),
      },
    }));
  };

  // Validation per row/card
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
      const parsed = skuAssumptionRowSchema.safeParse({
        ...row,
        sku_id: skuId,
      });
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
    if (!isAllValid || !confirmed || isSubmitting || skuIds.length === 0)
      return;
    setSubmitError("");

    const parsedArray = [];
    for (const skuId of skuIds) {
      parsedArray.push(
        skuAssumptionRowSchema.parse({
          ...rows[skuId],
          sku_id: skuId,
        }),
      );
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
          skus: parsedArray,
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
          next[skuId] = {
            sku_id: skuId,
            unit_cost: ver.skus[skuId].unit_cost,
            order_cost:
              ver.skus[skuId].order_cost ?? ver.skus[skuId].ordering_cost,
            holding_rate:
              ver.skus[skuId].holding_rate ??
              ver.skus[skuId].holding_cost_annual,
            shortage_cost:
              ver.skus[skuId].shortage_cost ?? ver.skus[skuId].shortage_penalty,
            lead_time_mean: ver.skus[skuId].lead_time_mean,
            lead_time_std: ver.skus[skuId].lead_time_std ?? 0,
            target_service_level:
              ver.skus[skuId].target_service_level ??
              ver.skus[skuId].service_level,
            moq: ver.skus[skuId].moq ?? 1,
            pack_size: ver.skus[skuId].pack_size ?? 1,
            initial_stock: ver.skus[skuId].initial_stock ?? 0,
          };
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
              Set session-level inventory boundaries. Both are optional here,
              but at least one must be set to run multi-SKU Portfolio
              Optimization.
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
                Upper limit on total inventory investment: sum(avg_inventory_i ·
                unit_cost_i) ≤ budget
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
                Upper limit on total units across all SKUs: sum(avg_inventory_i)
                ≤ capacity
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <div>
            <h3 className="text-xs font-semibold text-slate-200">
              SKU Inventory Parameters ({skuIds.length} SKUs)
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Every field must be populated and valid for each SKU before
              optimization can proceed.
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
                  <span>All SKUs complete</span>
                </>
              ) : (
                <>
                  <AlertCircle size={12} />
                  <span>Incomplete SKUs pending</span>
                </>
              )}
            </span>
          </div>
        </div>

        {/* Editable Cards List - One per SKU */}
        <div className="flex flex-col gap-4">
          {skuIds.map((skuId) => {
            const row = rows[skuId] || { ...defaultRowValues, sku_id: skuId };
            const status = validationResults.rowStatus[skuId] || {
              valid: true,
              errors: {},
            };
            const errs = status.errors;

            return (
              <div
                key={skuId}
                className={`bg-[#0d0f14]/80 border rounded-xl p-4.5 transition-all ${
                  status.valid
                    ? "border-white/[0.08] hover:border-white/[0.16]"
                    : "border-rose-500/40 bg-rose-500/[0.02]"
                }`}
              >
                <div className="flex items-center justify-between pb-3 mb-3 border-b border-white/[0.06]">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold font-mono text-white bg-slate-800/80 px-2.5 py-1 rounded-md border border-white/[0.06]">
                      {skuId}
                    </span>
                    <span className="text-[11px] text-slate-400">
                      Inventory Policy Parameters
                    </span>
                  </div>
                  <div>
                    {status.valid ? (
                      <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                        <CheckCircle size={12} />
                        <span>Valid</span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-rose-400 font-medium flex items-center gap-1 bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20">
                        <AlertCircle size={12} />
                        <span>Requires Attention</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
                  {/* unit_cost */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Unit Cost (₹)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={row.unit_cost ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "unit_cost", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.unit_cost
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="e.g. 100"
                    />
                    {errs.unit_cost && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.unit_cost}
                      </span>
                    )}
                  </div>

                  {/* order_cost */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Order Cost (₹)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={row.order_cost ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "order_cost", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.order_cost
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="e.g. 200"
                    />
                    {errs.order_cost && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.order_cost}
                      </span>
                    )}
                  </div>

                  {/* holding_rate */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Holding Rate (₹/yr)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={row.holding_rate ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "holding_rate", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.holding_rate
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="e.g. 18.25"
                    />
                    {errs.holding_rate && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.holding_rate}
                      </span>
                    )}
                  </div>

                  {/* shortage_cost */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Shortage Cost (₹)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0.01"
                      value={row.shortage_cost ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "shortage_cost", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.shortage_cost
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="e.g. 50"
                    />
                    {errs.shortage_cost && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.shortage_cost}
                      </span>
                    )}
                  </div>

                  {/* lead_time_mean */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Lead Time Mean (d)
                    </label>
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
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.lead_time_mean
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="1-28"
                    />
                    {errs.lead_time_mean && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.lead_time_mean}
                      </span>
                    )}
                  </div>

                  {/* lead_time_std */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Lead Time Std (d)
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="0"
                      max="28"
                      value={row.lead_time_std ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "lead_time_std", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.lead_time_std
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="0-28"
                    />
                    {errs.lead_time_std && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.lead_time_std}
                      </span>
                    )}
                  </div>

                  {/* target_service_level */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Service Level (0.80–0.99)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.80"
                      max="0.99"
                      value={row.target_service_level ?? ""}
                      onChange={(e) =>
                        handleCellChange(
                          skuId,
                          "target_service_level",
                          e.target.value,
                        )
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.target_service_level
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="0.95"
                    />
                    {errs.target_service_level && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.target_service_level}
                      </span>
                    )}
                  </div>

                  {/* moq */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Min Order Qty (MOQ)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={row.moq ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "moq", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.moq
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="e.g. 1"
                    />
                    {errs.moq && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.moq}
                      </span>
                    )}
                  </div>

                  {/* pack_size */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Pack Size (units)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={row.pack_size ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "pack_size", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.pack_size
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="e.g. 1"
                    />
                    {errs.pack_size && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.pack_size}
                      </span>
                    )}
                  </div>

                  {/* initial_stock */}
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Initial Stock (units)
                    </label>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={row.initial_stock ?? ""}
                      onChange={(e) =>
                        handleCellChange(skuId, "initial_stock", e.target.value)
                      }
                      className={`w-full bg-slate-900 border rounded-lg px-2.5 py-1.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-indigo-500 ${
                        errs.initial_stock
                          ? "border-rose-500 bg-rose-500/10"
                          : "border-slate-700"
                      }`}
                      placeholder="e.g. 0"
                    />
                    {errs.initial_stock && (
                      <span className="text-[10px] text-rose-400 mt-1 block">
                        {errs.initial_stock}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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
                Every SKU must have all fields completed and valid before
                running optimization.
              </span>
            )}

            <button
              type="submit"
              disabled={
                !isAllValid || !confirmed || isSubmitting || skuIds.length === 0
              }
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
