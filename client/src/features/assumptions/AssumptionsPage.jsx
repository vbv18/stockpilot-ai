import { useState, useMemo } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  History,
  Info,
  Loader2,
} from "lucide-react";
import { COPY } from "../../lib/copy.js";
import { fmtDateTime, fmtInr, fmtPct } from "../../lib/format.js";
import {
  useCreateAssumptionsMutation,
  useGetAssumptionDefaultsQuery,
  useListAssumptionsQuery,
} from "../../lib/api.js";
import { assumptionsFormSchema } from "./schema.js";

export default function AssumptionsPage() {
  const { session } = useOutletContext();
  const navigate = useNavigate();

  const { data: defaultsData } = useGetAssumptionDefaultsQuery(session.id);
  const { data: versionsList = [] } = useListAssumptionsQuery(session.id);
  const [createAssumptions, { isLoading: isSubmitting }] =
    useCreateAssumptionsMutation();

  const latestVersion = versionsList.length > 0 ? versionsList[0] : null;
  const defaults = useMemo(
    () =>
      defaultsData?.values || {
        orderingCost: 200,
        holdingCost: 5,
        holdingCostUnit: "per_unit_per_day",
        shortagePenalty: 50,
        leadTimeDays: 7,
        targetServiceLevel: 0.95,
      },
    [defaultsData],
  );

  // Form inputs state
  const [orderingCost, setOrderingCost] = useState(200);
  const [holdingCost, setHoldingCost] = useState(5);
  const [holdingCostUnit, setHoldingCostUnit] = useState("per_unit_per_day");
  const [shortagePenalty, setShortagePenalty] = useState(50);
  const [leadTimeDays, setLeadTimeDays] = useState(7);
  const [targetServiceLevelPct, setTargetServiceLevelPct] = useState(95);
  const [confirmed, setConfirmed] = useState(false);

  const [errors, setErrors] = useState({});
  const [submitError, setSubmitError] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  // Initialize from latest version or defaults when data arrives
  const [initializedKey, setInitializedKey] = useState(null);
  const currentKey = latestVersion?.id || (defaultsData ? "defaults" : null);

  if (currentKey && initializedKey !== currentKey) {
    const src = latestVersion || defaults;
    setOrderingCost(src.orderingCost ?? 200);
    setHoldingCost(src.holdingCost ?? 5);
    setHoldingCostUnit(src.holdingCostUnit ?? "per_unit_per_day");
    setShortagePenalty(src.shortagePenalty ?? 50);
    setLeadTimeDays(src.leadTimeDays ?? 7);
    setTargetServiceLevelPct(
      src.targetServiceLevel ? src.targetServiceLevel * 100 : 95,
    );
    setInitializedKey(currentKey);
  }

  // Provenance helper
  const hasDemoDefault =
    orderingCost === defaults.orderingCost ||
    holdingCost === defaults.holdingCost ||
    holdingCostUnit === defaults.holdingCostUnit ||
    shortagePenalty === defaults.shortagePenalty ||
    leadTimeDays === defaults.leadTimeDays ||
    targetServiceLevelPct === defaults.targetServiceLevel * 100;

  const validateForm = () => {
    const parseResult = assumptionsFormSchema.safeParse({
      orderingCost: Number(orderingCost),
      holdingCost: Number(holdingCost),
      holdingCostUnit,
      shortagePenalty: Number(shortagePenalty),
      leadTimeDays: Number(leadTimeDays),
      targetServiceLevelPct: Number(targetServiceLevelPct),
    });

    if (!parseResult.success) {
      const fieldErrors = {};
      for (const issue of parseResult.error.issues) {
        fieldErrors[issue.path[0]] = issue.message;
      }
      setErrors(fieldErrors);
      return false;
    }
    setErrors({});
    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm() || !confirmed || isSubmitting) return;
    setSubmitError("");

    try {
      await createAssumptions({
        id: session.id,
        body: {
          orderingCost: Number(orderingCost),
          holdingCost: Number(holdingCost),
          holdingCostUnit,
          shortagePenalty: Number(shortagePenalty),
          leadTimeDays: Number(leadTimeDays),
          targetServiceLevel: Number(targetServiceLevelPct) / 100,
          confirmed: true,
        },
      }).unwrap();

      navigate(`/sessions/${session.id}/optimization`);
    } catch (err) {
      setSubmitError(
        err.data?.message || err.message || "Failed to save assumptions.",
      );
    }
  };

  const handlePrefill = (ver) => {
    setOrderingCost(ver.orderingCost);
    setHoldingCost(ver.holdingCost);
    setHoldingCostUnit(ver.holdingCostUnit);
    setShortagePenalty(ver.shortagePenalty);
    setLeadTimeDays(ver.leadTimeDays);
    setTargetServiceLevelPct(ver.targetServiceLevel * 100);
  };

  return (
    <div className="flex flex-col gap-6 max-w-4xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Inventory Optimization Assumptions
        </h2>
        <p className="text-xs text-slate-400 mt-1">
          Specify holding costs, fixed ordering fees, supplier lead times, and
          desired service level to compute safety stocks.
        </p>
      </div>

      {hasDemoDefault && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center gap-3 text-xs text-amber-300">
          <Info size={16} className="shrink-0" />
          <span>{COPY.assumptionsLabel}</span>
        </div>
      )}

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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Ordering Cost */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">
                Ordering Cost (S) <span className="text-rose-400">*</span>
              </label>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono ${orderingCost === defaults.orderingCost ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-indigo-500/10 text-indigo-300"}`}
              >
                {orderingCost === defaults.orderingCost
                  ? "Demo default"
                  : "Your value"}
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2 text-xs text-slate-500">
                ₹
              </span>
              <input
                type="number"
                step="any"
                value={orderingCost}
                onChange={(e) => setOrderingCost(e.target.value)}
                onBlur={validateForm}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <span className="text-[11px] text-slate-500">
              Fixed administrative fee incurred per replenishment order placed.
            </span>
            {errors.orderingCost && (
              <span className="text-xs text-rose-400">
                {errors.orderingCost}
              </span>
            )}
          </div>

          {/* Holding Cost */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">
                Holding Cost (H) <span className="text-rose-400">*</span>
              </label>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono ${holdingCost === defaults.holdingCost ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-indigo-500/10 text-indigo-300"}`}
              >
                {holdingCost === defaults.holdingCost
                  ? "Demo default"
                  : "Your value"}
              </span>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2 text-xs text-slate-500">
                  ₹
                </span>
                <input
                  type="number"
                  step="any"
                  value={holdingCost}
                  onChange={(e) => setHoldingCost(e.target.value)}
                  onBlur={validateForm}
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <select
                value={holdingCostUnit}
                onChange={(e) => setHoldingCostUnit(e.target.value)}
                className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-slate-300 focus:outline-none"
              >
                <option value="per_unit_per_day">per unit / day</option>
                <option value="per_unit_per_year">per unit / year</option>
              </select>
            </div>
            <span className="text-[11px] text-slate-500">
              Converted to a yearly figure for EOQ (daily x 365).
            </span>
            {errors.holdingCost && (
              <span className="text-xs text-rose-400">
                {errors.holdingCost}
              </span>
            )}
          </div>

          {/* Shortage Penalty */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">
                Shortage Penalty <span className="text-rose-400">*</span>
              </label>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono ${shortagePenalty === defaults.shortagePenalty ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-indigo-500/10 text-indigo-300"}`}
              >
                {shortagePenalty === defaults.shortagePenalty
                  ? "Demo default"
                  : "Your value"}
              </span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2 text-xs text-slate-500">
                ₹
              </span>
              <input
                type="number"
                step="any"
                value={shortagePenalty}
                onChange={(e) => setShortagePenalty(e.target.value)}
                onBlur={validateForm}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-7 pr-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>
            <span className="text-[11px] text-slate-500">
              Estimated lost margin or penalty per unit of unmet customer
              demand.
            </span>
            {errors.shortagePenalty && (
              <span className="text-xs text-rose-400">
                {errors.shortagePenalty}
              </span>
            )}
          </div>

          {/* Supplier Lead Time */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">
                Supplier Lead Time (Days){" "}
                <span className="text-rose-400">*</span>
              </label>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono ${leadTimeDays === defaults.leadTimeDays ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-indigo-500/10 text-indigo-300"}`}
              >
                {leadTimeDays === defaults.leadTimeDays
                  ? "Demo default"
                  : "Your value"}
              </span>
            </div>
            <input
              type="number"
              min="1"
              max="28"
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
              onBlur={validateForm}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <span className="text-[11px] text-slate-500">
              Days between order placement and receipt (max 28 days).
            </span>
            {errors.leadTimeDays && (
              <span className="text-xs text-rose-400">
                {errors.leadTimeDays}
              </span>
            )}
          </div>

          {/* Target Service Level */}
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-slate-300">
                Target Cycle Service Level (%){" "}
                <span className="text-rose-400">*</span>
              </label>
              <span
                className={`text-[10px] px-2 py-0.5 rounded font-mono ${targetServiceLevelPct === defaults.targetServiceLevel * 100 ? "bg-amber-500/10 text-amber-300 border border-amber-500/20" : "bg-indigo-500/10 text-indigo-300"}`}
              >
                {targetServiceLevelPct === defaults.targetServiceLevel * 100
                  ? "Demo default"
                  : "Your value"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.1"
                min="1"
                max="99.9"
                value={targetServiceLevelPct}
                onChange={(e) => setTargetServiceLevelPct(e.target.value)}
                onBlur={validateForm}
                className="w-32 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
              />
              <span className="text-xs text-slate-400">
                % cycle service level (e.g. 95% = 5% tolerance for stockout
                risk)
              </span>
            </div>
            {errors.targetServiceLevelPct && (
              <span className="text-xs text-rose-400">
                {errors.targetServiceLevelPct}
              </span>
            )}
          </div>
        </div>

        {/* Confirmation Checkbox */}
        <div className="pt-4 border-t border-white/[0.06] flex flex-col gap-4">
          <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300 font-medium">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="accent-indigo-500 w-4 h-4"
            />
            <span>I confirm these assumptions for this analysis</span>
          </label>

          <button
            type="submit"
            disabled={!confirmed || isSubmitting}
            className="self-end flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-all"
          >
            {isSubmitting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : null}
            <span>Save and Continue</span>
            <ArrowRight size={14} />
          </button>
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
              {versionsList.map((v) => (
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
                      S={fmtInr(v.orderingCost)} · H={fmtInr(v.holdingCost)} (
                      {v.holdingCostUnit.replace(/_/g, " ")}) · Lead=
                      {v.leadTimeDays}d · Service=
                      {fmtPct(v.targetServiceLevel, 0)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handlePrefill(v)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-xs font-medium rounded-lg text-slate-200 cursor-pointer"
                  >
                    Use these values
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
