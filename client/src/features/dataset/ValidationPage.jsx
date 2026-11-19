import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { COPY } from "../../lib/copy.js";
import { fmtInt, fmtNum, fmtPct } from "../../lib/format.js";
import { useConfirmDatasetMutation, useGetValidationQuery, usePutMappingMutation } from "../../lib/api.js";
import { JobProgress } from "../jobs/JobProgress.jsx";
import { useJobTracker } from "../jobs/useJobTracker.js";
import { ColumnMappingPanel } from "./ColumnMappingPanel.jsx";

export default function ValidationPage() {
  const { session } = useOutletContext();
  const navigate = useNavigate();

  const { data: valData, isLoading, error, refetch } = useGetValidationQuery(session.id);

  // Job tracking for validation or transformation
  const [jobId, setJobId] = useState(() => {
    return (
      sessionStorage.getItem(`sp:job:${session.id}:transformation`) ||
      sessionStorage.getItem(`sp:job:${session.id}:validation`) ||
      null
    );
  });

  const { job } = useJobTracker(session.id, jobId, (finishedJob) => {
    if (finishedJob.stage === "transformation") {
      sessionStorage.removeItem(`sp:job:${session.id}:transformation`);
      if (finishedJob.status === "succeeded") {
        navigate(`/sessions/${session.id}/forecast`);
      }
    }
  });

  const [confirmDataset, { isLoading: isConfirming }] = useConfirmDatasetMutation();
  const [putMapping, { isLoading: isRemapping }] = usePutMappingMutation();

  const [showMappingPanel, setShowMappingPanel] = useState(false);
  const [confirmAggDuplicates, setConfirmAggDuplicates] = useState(false);
  const [confirmCompleteCoverage, setConfirmCompleteCoverage] = useState(false);
  const [acknowledgeDroppedNegatives, setAcknowledgeDroppedNegatives] = useState(false);
  const [confirmError, setConfirmError] = useState("");

  const [showPreview, setShowPreview] = useState(false);

  if (isLoading) {
    return (
      <div className="p-12 flex items-center justify-center">
        <Loader2 className="animate-spin text-slate-500" size={28} />
      </div>
    );
  }

  if (error || !valData) {
    return (
      <div className="bg-[#13151c] border border-rose-500/20 rounded-2xl p-8 flex flex-col items-center justify-center gap-3">
        <p className="text-rose-400 text-sm font-medium">
          {error?.data?.message || "Failed to load validation details."}
        </p>
        {error?.data?.requestId && (
          <span className="text-[11px] text-slate-500">Reference: {error.data.requestId}</span>
        )}
        <button
          onClick={() => refetch()}
          className="mt-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-xs font-medium"
        >
          Retry
        </button>
      </div>
    );
  }

  const { summary, status, preview, columns, mapping } = {
    summary: valData.validationSummary,
    status: valData.status,
    preview: valData.preview || [],
    columns: valData.columns || [],
    mapping: valData.mapping || null,
  };

  const isFailed = status === "validation_failed";
  const isValidated = status === "validated";
  const droppedNegCount = summary?.droppedNegativeRows || 0;

  const canConfirm =
    confirmAggDuplicates &&
    confirmCompleteCoverage &&
    (droppedNegCount > 0 ? acknowledgeDroppedNegatives : true);

  const handleConfirm = async () => {
    if (!canConfirm || isConfirming) return;
    setConfirmError("");

    try {
      const res = await confirmDataset({
        id: session.id,
        body: {
          confirmAggregateDuplicates: true,
          assumeCompleteCoverage: true,
          acknowledgeDroppedNegativeRows: droppedNegCount > 0 ? true : false,
        },
      }).unwrap();

      const newJobId = res.jobId;
      setJobId(newJobId);
      sessionStorage.setItem(`sp:job:${session.id}:transformation`, newJobId);
    } catch (err) {
      setConfirmError(err.data?.message || err.message || "Failed to confirm dataset.");
    }
  };

  const handleRemappingSubmit = async (mappingPayload) => {
    try {
      const res = await putMapping({
        id: session.id,
        body: mappingPayload,
      }).unwrap();

      const newJobId = res.jobId;
      setJobId(newJobId);
      sessionStorage.setItem(`sp:job:${session.id}:validation`, newJobId);
      setShowMappingPanel(false);
    } catch (err) {
      setConfirmError(err.data?.message || err.message || "Failed to update mapping.");
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-5xl mx-auto">
      <div>
        <h2 className="text-xl font-bold text-white tracking-tight">Dataset Validation Report</h2>
        <p className="text-xs text-slate-400 mt-1">
          Review the health summary, missing calendar dates, and column alignment before generating demand series.
        </p>
      </div>

      {jobId && <JobProgress sessionId={session.id} job={job} />}

      {isFailed && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-rose-300 font-semibold text-xs">
            <AlertCircle size={16} />
            <span>Validation Failed: {valData.error?.message || "Invalid dataset records."}</span>
          </div>

          <div className="flex items-center gap-3 mt-1">
            <button
              type="button"
              onClick={() => setShowMappingPanel((prev) => !prev)}
              className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-xs rounded-xl font-medium cursor-pointer"
            >
              {showMappingPanel ? "Hide Mapping" : "Change Column Mapping"}
            </button>
            <button
              type="button"
              onClick={() => navigate(`/sessions/${session.id}/upload`)}
              className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
            >
              Upload a different file
            </button>
          </div>
        </div>
      )}

      {showMappingPanel && (
        <ColumnMappingPanel
          columns={columns}
          preview={preview}
          initialMapping={mapping}
          onSubmit={handleRemappingSubmit}
          isLoading={isRemapping}
        />
      )}

      {summary && (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-[#13151c] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Total Rows</span>
              <span className="text-base font-bold text-slate-100">{fmtInt(summary.totalDataRows)}</span>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Accepted Rows</span>
              <span className="text-base font-bold text-emerald-400">{fmtInt(summary.acceptedRows)}</span>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Rejected Rows</span>
              <span className="text-base font-bold text-rose-400">{fmtInt(summary.rejectedRows)}</span>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Distinct SKUs</span>
              <span className="text-base font-bold text-slate-100">{fmtInt(summary.distinctSkus)}</span>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Date Range</span>
              <span className="text-xs font-semibold text-slate-100">
                {summary.dateRange ? `${summary.dateRange.min} → ${summary.dateRange.max}` : "-"}
              </span>
              <span className="text-[10px] text-slate-500 font-mono">
                {summary.calendarDaysInRange} days span
              </span>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-xl p-3.5 flex flex-col gap-1">
              <span className="text-[11px] text-slate-400">Missing Days</span>
              <span className="text-base font-bold text-amber-400">{fmtInt(summary.missingCalendarDays)}</span>
              <span className="text-[10px] text-slate-500">Zero-filled</span>
            </div>
          </div>

          {/* Warnings List */}
          {summary.warnings && summary.warnings.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                <AlertTriangle size={15} />
                <span>Dataset Ingestion Warnings</span>
              </div>
              <ul className="list-disc list-inside text-xs text-amber-200/80 flex flex-col gap-1">
                {summary.warnings.map((w, idx) => (
                  <li key={idx}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Rejection Details & Facts */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <h3 className="text-xs font-semibold text-slate-300">Rejected Rows by Reason</h3>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-slate-500">
                    <th scope="col" className="py-2">Reason</th>
                    <th scope="col" className="py-2 text-right">Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.02] text-slate-300">
                  <tr>
                    <td className="py-2">Invalid SKU length or empty</td>
                    <td className="py-2 text-right font-mono">{fmtInt(summary.rejectedByReason.invalid_sku)}</td>
                  </tr>
                  <tr>
                    <td className="py-2">Invalid date format</td>
                    <td className="py-2 text-right font-mono">{fmtInt(summary.rejectedByReason.invalid_date)}</td>
                  </tr>
                  <tr>
                    <td className="py-2">Non-numeric quantity</td>
                    <td className="py-2 text-right font-mono">{fmtInt(summary.rejectedByReason.non_numeric_quantity)}</td>
                  </tr>
                  <tr>
                    <td className="py-2">Negative quantity</td>
                    <td className="py-2 text-right font-mono">{fmtInt(summary.rejectedByReason.negative_quantity)}</td>
                  </tr>
                  <tr>
                    <td className="py-2">Malformed row columns count</td>
                    <td className="py-2 text-right font-mono">{fmtInt(summary.rejectedByReason.malformed_row)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <h3 className="text-xs font-semibold text-slate-300">Dataset Properties</h3>
              <div className="flex flex-col gap-2 text-xs text-slate-300 divide-y divide-white/[0.02]">
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Duplicate SKU & Date rows</span>
                  <span className="font-mono font-medium">{fmtInt(summary.duplicateSkuDateRecords)} (summed)</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Zero-quantity rows</span>
                  <span className="font-mono font-medium">{fmtInt(summary.zeroQuantityRows)}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Dropped negative rows</span>
                  <span className="font-mono font-medium text-amber-300">{fmtInt(summary.droppedNegativeRows)}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Days with active orders</span>
                  <span className="font-mono font-medium">{fmtInt(summary.daysWithAnyRecord)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Top SKU Coverage Table */}
          {summary.topSkuCoverage && summary.topSkuCoverage.length > 0 && (
            <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-semibold text-slate-300">
                  Top SKU Coverage (Top {summary.topSkuCoverage.length})
                </h3>
                <span className="text-[11px] text-slate-500">Sorted by total demand</span>
              </div>

              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-500 bg-white/[0.01]">
                      <th scope="col" className="px-3 py-2">SKU</th>
                      <th scope="col" className="px-3 py-2 text-right">Total Units</th>
                      <th scope="col" className="px-3 py-2 text-right">Active Days</th>
                      <th scope="col" className="px-3 py-2">Date Span</th>
                      <th scope="col" className="px-3 py-2 text-right">Coverage %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.02] text-slate-300">
                    {summary.topSkuCoverage.map((sku) => (
                      <tr key={sku.skuId} className="hover:bg-white/[0.01]">
                        <td className="px-3 py-2 font-mono font-medium text-slate-100">{sku.skuId}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtNum(sku.totalQuantity, 0)}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmtInt(sku.activeDays)}</td>
                        <td className="px-3 py-2 text-slate-400 text-[11px]">
                          {sku.firstDate} → {sku.lastDate} ({sku.spanDays}d)
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full"
                                style={{ width: `${sku.coveragePct}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px]">{fmtPct(sku.coveragePct / 100, 1)}</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Toggle Raw Preview */}
          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className="self-start text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1 font-medium cursor-pointer"
            >
              <span>{showPreview ? "Hide CSV preview" : "Show CSV raw preview"}</span>
              {showPreview ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showPreview && preview.length > 0 && (
              <div className="overflow-x-auto max-h-56 border border-white/[0.04] rounded-xl bg-slate-950/40 p-2">
                <table className="w-full text-left text-[11px] font-mono">
                  <thead>
                    <tr className="border-b border-white/[0.06] text-slate-400">
                      {columns.map((c) => (
                        <th key={c} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.02] text-slate-300">
                    {preview.map((row, rIdx) => (
                      <tr key={rIdx}>
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
            )}
          </div>

          {/* Confirmation Box (when validated) */}
          {isValidated && (
            <div className="bg-[#13151c] border border-indigo-500/30 rounded-2xl p-6 flex flex-col gap-4 shadow-xl">
              <div>
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-400" />
                  <span>Confirm Dataset Ingestion</span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  Please acknowledge the aggregation and coverage rules to prepare contiguous time-series files.
                </p>
              </div>

              {confirmError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  {confirmError}
                </div>
              )}

              <div className="flex flex-col gap-3 text-xs text-slate-300">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmAggDuplicates}
                    onChange={(e) => setConfirmAggDuplicates(e.target.checked)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <span>Sum multiple records for the same SKU and date into one daily total.</span>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={confirmCompleteCoverage}
                    onChange={(e) => setConfirmCompleteCoverage(e.target.checked)}
                    className="mt-0.5 accent-indigo-500"
                  />
                  <span>
                    I confirm: {COPY.seriesNote} (missing calendar days will be filled with 0 demand).
                  </span>
                </label>

                {droppedNegCount > 0 && (
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={acknowledgeDroppedNegatives}
                      onChange={(e) => setAcknowledgeDroppedNegatives(e.target.checked)}
                      className="mt-0.5 accent-indigo-500"
                    />
                    <span className="text-amber-300">
                      Exclude {droppedNegCount} negative-quantity rows; they are treated as returns, not demand.
                    </span>
                  </label>
                )}
              </div>

              <button
                type="button"
                disabled={!canConfirm || isConfirming}
                onClick={handleConfirm}
                className="self-end px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white shadow-md shadow-indigo-700/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 cursor-pointer transition-all"
              >
                {isConfirming ? <Loader2 size={14} className="animate-spin" /> : null}
                <span>Confirm and Prepare Dataset</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
