import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Info,
} from "lucide-react";
import { formatFindingValue } from "./format.js";
import { COPY } from "../../lib/copy.js";
import { shortId } from "../../lib/format.js";

const TOOL_FRIENDLY_NAMES = {
  get_sku_forecast: "Forecast lookup",
  get_inventory_recommendation: "Recommendation lookup",
  compare_inventory_policies: "Policy comparison",
  run_what_if_scenario: "What-if scenario",
  get_inventory_risk_summary: "Risk summary",
};

const PROVENANCE_STYLES = {
  observed: "bg-slate-500/10 text-slate-300 border-slate-500/20",
  forecast: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  assumption: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  calculated: "bg-indigo-500/10 text-indigo-300 border-indigo-500/20",
  simulated: "bg-teal-500/10 text-teal-300 border-teal-500/20",
  what_if: "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

function EvidencePopover({ ev, sessionId, onClose }) {
  const getPageLink = () => {
    switch (ev.artifactType) {
      case "forecast_run":
      case "evaluation":
        return `/sessions/${sessionId}/forecast`;
      case "optimization_run":
        return `/sessions/${sessionId}/optimization`;
      case "assumption_set":
        return `/sessions/${sessionId}/assumptions`;
      case "simulation_run":
        return `/sessions/${sessionId}/simulation`;
      case "dataset":
        return `/sessions/${sessionId}/validation`;
      case "session_digest":
        return `/sessions/${sessionId}/overview`;
      case "what_if_run":
      default:
        return null;
    }
  };

  const link = getPageLink();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#13151c] border border-white/[0.12] rounded-2xl p-5 max-w-sm w-full shadow-2xl flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06]">
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
            Evidence {ev.evidenceId}
          </span>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="space-y-1.5 text-xs text-slate-300">
          <div>
            <span className="text-slate-500">Artifact: </span>
            <span className="capitalize">
              {ev.artifactType?.replace(/_/g, " ")}
            </span>
          </div>
          <div>
            <span className="text-slate-500">ID: </span>
            <span className="font-mono text-slate-400">
              {shortId(ev.artifactId)}
            </span>
          </div>
          {ev.skuId && (
            <div>
              <span className="text-slate-500">SKU: </span>
              <span className="font-mono text-white">{ev.skuId}</span>
            </div>
          )}
          {ev.metricKeys && ev.metricKeys.length > 0 && (
            <div>
              <span className="text-slate-500">Metrics: </span>
              <div className="flex flex-wrap gap-1 mt-1">
                {ev.metricKeys.map((k, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-400"
                  >
                    {k}
                  </span>
                ))}
              </div>
            </div>
          )}
          {ev.note && (
            <div className="text-slate-400 italic pt-1">{ev.note}</div>
          )}
        </div>

        {link && (
          <Link
            to={link}
            className="inline-flex items-center justify-center gap-1.5 w-full mt-2 py-2 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 text-xs font-medium border border-indigo-500/30 transition-colors"
          >
            <span>View analysis page</span>
            <ExternalLink size={12} />
          </Link>
        )}
      </div>
    </div>
  );
}

export function AssistantMessageCard({
  message,
  sessionId,
  onSuggestionClick,
}) {
  const [showTools, setShowTools] = useState(false);
  const [activeEvidencePopover, setActiveEvidencePopover] = useState(null);

  if (message.status === "error") {
    return (
      <div className="bg-[#13151c] border border-rose-500/20 rounded-2xl p-5 shadow-lg flex flex-col gap-2">
        <div className="flex items-center gap-2 text-rose-400 text-xs font-medium">
          <AlertTriangle size={14} />
          <span>This answer could not be generated</span>
        </div>
        <p className="text-xs text-slate-400">
          {message.content ||
            "An error occurred while communicating with the AI assistant."}
        </p>
        {message.errorCode && (
          <span className="text-[10px] text-slate-500 font-mono">
            Code: {message.errorCode}
          </span>
        )}
      </div>
    );
  }

  const structured = message.structured;
  const rawText = message.content || "";

  if (!structured) {
    return (
      <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-5 shadow-lg text-xs text-slate-200 whitespace-pre-wrap leading-relaxed">
        {rawText}
      </div>
    );
  }

  const {
    message: prose,
    summary,
    keyFindings = [],
    evidence = [],
    toolActions = [],
    warnings = [],
    followUpSuggestions = [],
    grounding = {},
  } = structured;

  const hasWhatIf = toolActions.some((t) => t.tool === "run_what_if_scenario");

  return (
    <div className="bg-[#13151c] border border-white/[0.08] rounded-2xl p-6 shadow-xl flex flex-col gap-5 text-xs text-slate-200">
      {/* 1. Plain Text Message (Safe against HTML injection) */}
      <div className="whitespace-pre-wrap leading-relaxed text-sm text-slate-100 font-normal">
        {prose}
      </div>

      {/* 2. Bold Summary Line */}
      {summary && (
        <div className="font-semibold text-slate-200 border-l-2 border-indigo-500 pl-3 py-0.5 text-xs bg-indigo-500/5 rounded-r">
          {summary}
        </div>
      )}

      {/* 3. Key Findings Table */}
      {keyFindings.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-white/[0.06] bg-[#0d0f14]/60">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-white/[0.06] text-slate-400 bg-white/[0.02]">
                <th scope="col" className="py-2.5 px-3 font-medium">
                  Label
                </th>
                <th scope="col" className="py-2.5 px-3 font-medium">
                  Value
                </th>
                <th scope="col" className="py-2.5 px-3 font-medium">
                  SKU
                </th>
                <th scope="col" className="py-2.5 px-3 font-medium">
                  Type
                </th>
                <th scope="col" className="py-2.5 px-3 font-medium">
                  Evidence
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {keyFindings.map((f, i) => {
                const provStyle =
                  PROVENANCE_STYLES[f.provenance] || PROVENANCE_STYLES.observed;
                return (
                  <tr key={i} className="hover:bg-white/[0.02]">
                    <td className="py-2 px-3 text-slate-300 font-medium">
                      {f.label}
                    </td>
                    <td className="py-2 px-3 font-semibold text-white">
                      {formatFindingValue(f.value, f.unit)}
                    </td>
                    <td className="py-2 px-3 font-mono text-slate-400">
                      {f.skuId || "-"}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-medium border capitalize ${provStyle}`}
                      >
                        {f.provenance?.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      <button
                        onClick={() => {
                          const evObj = evidence.find(
                            (e) => e.evidenceId === f.evidenceId,
                          ) || {
                            evidenceId: f.evidenceId,
                            artifactType: "unknown",
                            artifactId: f.evidenceId,
                            skuId: f.skuId,
                          };
                          setActiveEvidencePopover(evObj);
                        }}
                        className="px-2 py-0.5 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 text-[10px] font-mono border border-indigo-500/20 transition-colors"
                      >
                        {f.evidenceId}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 4. Evidence Chips */}
      {evidence.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-slate-400 font-medium">
            Evidence cited:
          </span>
          {evidence.map((ev, i) => (
            <button
              key={i}
              onClick={() => setActiveEvidencePopover(ev)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-[11px] text-slate-300 border border-white/[0.06] transition-colors"
            >
              <span className="font-mono text-indigo-400 font-semibold">
                {ev.evidenceId}
              </span>
              <span className="capitalize">
                {ev.artifactType?.replace(/_/g, " ")}
              </span>
              {ev.skuId && (
                <span className="font-mono text-slate-400">({ev.skuId})</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Evidence Popover */}
      {activeEvidencePopover && (
        <EvidencePopover
          ev={activeEvidencePopover}
          sessionId={sessionId}
          onClose={() => setActiveEvidencePopover(null)}
        />
      )}

      {/* 5. How this was computed (Collapsible) */}
      {toolActions.length > 0 && (
        <div className="border border-white/[0.06] rounded-xl overflow-hidden bg-white/[0.01]">
          <button
            onClick={() => setShowTools(!showTools)}
            className="w-full flex items-center justify-between p-3 text-xs text-slate-400 hover:text-white transition-colors"
          >
            <div className="flex items-center gap-2">
              <Brain size={14} className="text-indigo-400" />
              <span>
                How this was computed ({toolActions.length} calculation actions)
              </span>
              {hasWhatIf && (
                <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px]">
                  What-if scenario (separate from your baseline)
                </span>
              )}
            </div>
            {showTools ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showTools && (
            <div className="p-3 border-t border-white/[0.06] space-y-2 text-xs bg-[#0d0f14]/50">
              {toolActions.map((t, idx) => {
                const label = TOOL_FRIENDLY_NAMES[t.tool] || t.tool;
                return (
                  <div
                    key={idx}
                    className="flex items-start justify-between gap-3 p-2 rounded-lg bg-slate-800/40 border border-white/[0.04]"
                  >
                    <div>
                      <div className="font-medium text-slate-200">{label}</div>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5 break-all">
                        {t.argsSummary}
                      </div>
                    </div>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded uppercase font-medium ${
                        t.status === "ok"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-rose-500/10 text-rose-400"
                      }`}
                    >
                      {t.status}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 6. Warnings Panel */}
      {warnings.length > 0 && (
        <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle size={14} className="text-amber-400" />
            <span>Analysis Notes & Limitations</span>
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-[11px] text-amber-300/90 pl-1">
            {warnings.map((w, idx) => (
              <li key={idx}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 7. Grounding Badge */}
      <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-white/[0.04]">
        <div className="flex items-center gap-2">
          {grounding.status === "verified" ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle size={12} />
              Numbers verified against analysis results
            </span>
          ) : grounding.status === "partial" ? (
            <span
              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20"
              title={`Removed findings: ${grounding.removedFindings || 0}. Unverified: ${(grounding.unverifiedNumbers || []).join(", ") || "none"}`}
            >
              <Info size={12} />
              Partially verified
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-rose-500/10 text-rose-400 border border-rose-500/20">
              <AlertTriangle size={12} />
              Could not verify numbers
            </span>
          )}
        </div>

        {/* 9. Muted Decision Support Footer */}
        <span className="italic text-slate-500 text-[10px]">
          {COPY.decisionSupport}
        </span>
      </div>

      {/* 8. Follow-up Suggestions */}
      {followUpSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-2">
          {followUpSuggestions.map((sug, i) => (
            <button
              key={i}
              onClick={() => onSuggestionClick && onSuggestionClick(sug)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-300 text-xs font-medium border border-indigo-500/20 transition-colors text-left"
            >
              <span>{sug}</span>
              <ArrowRight size={12} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
