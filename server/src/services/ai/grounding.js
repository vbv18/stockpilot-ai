export function numbersMatch(claimed, actual) {
  const tol = Math.max(0.005, Math.abs(actual) * 0.001);
  return Math.abs(claimed - actual) <= tol;
}

function matchesAny(claimed, unit, candidates) {
  const percentLike = unit === "percent";
  return candidates.some(
    (v) =>
      numbersMatch(claimed, v) ||
      (percentLike &&
        (numbersMatch(claimed / 100, v) || numbersMatch(claimed, v * 100))),
  );
}

const SAFE_INTS = new Set([0, 1, 2, 3, 4, 5, 7, 10, 28, 50, 56, 90, 365, 500]);

export function extractNumbers(text, knownSkuIds = []) {
  if (!text || typeof text !== "string") return [];
  let t = text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ");
  for (const sku of [...knownSkuIds].sort((a, b) => b.length - a.length)) {
    t = t.split(sku).join(" ");
  }
  const re = /(?<![\w.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?(?![\w])/g;
  const out = [];
  for (const m of t.matchAll(re)) {
    const raw = m[0];
    const percent = raw.endsWith("%");
    const value = Number(raw.replace(/,/g, "").replace("%", ""));
    if (Number.isFinite(value)) out.push({ raw, value, percent });
  }
  return out;
}

export function groundDraft(args) {
  const {
    draft,
    ledger,
    sessionId,
    toolActions,
    extraWarnings = [],
    knownSkuIds = [],
  } = args;
  let droppedEvidence = 0;
  let removedFindings = 0;

  const evidenceMap = new Map();
  const addEvidence = (evidenceId, metricKeys = [], note = null) => {
    const e = ledger.get(evidenceId);
    if (!e) {
      droppedEvidence++;
      return;
    }
    const prior = evidenceMap.get(evidenceId);
    const keys = [
      ...new Set([
        ...(prior?.metricKeys ?? []),
        ...metricKeys.filter((k) => e.keys.includes(k)),
      ]),
    ].slice(0, 20);
    evidenceMap.set(evidenceId, {
      evidenceId,
      artifactType: e.artifactType,
      artifactId: e.artifactId,
      skuId: e.skuId,
      metricKeys: keys,
      note: note ?? prior?.note ?? null,
    });
  };

  for (const ev of draft.evidence || []) {
    addEvidence(ev.evidenceId, ev.metricKeys, ev.note);
  }

  const keyFindings = [];
  for (const f of draft.keyFindings || []) {
    const entry = ledger.get(f.evidenceId);
    if (!entry) {
      removedFindings++;
      continue;
    }
    if (
      typeof f.value === "number" &&
      !matchesAny(f.value, f.unit, entry.numbers)
    ) {
      removedFindings++;
      continue;
    }
    keyFindings.push(f);
    if (!evidenceMap.has(f.evidenceId)) {
      addEvidence(f.evidenceId, [], null);
    }
  }

  const all = ledger.allNumbers();
  const unverified = new Set();
  const numbersToCheck = [
    ...extractNumbers(draft.message || "", knownSkuIds),
    ...extractNumbers(draft.summary || "", knownSkuIds),
  ];

  for (const n of numbersToCheck) {
    if (!n.percent && Number.isInteger(n.value) && SAFE_INTS.has(n.value))
      continue;
    if (!matchesAny(n.value, n.percent ? "percent" : "none", all)) {
      unverified.add(n.raw);
    }
  }
  const unverifiedNumbers = [...unverified].slice(0, 10);

  const warnings = [...(draft.warnings || []), ...extraWarnings];
  if (removedFindings > 0) {
    warnings.push(
      `${removedFindings} finding(s) were removed because they could not be matched to the analysis results.`,
    );
  }
  if (unverifiedNumbers.length > 0) {
    warnings.push(
      `Some numbers in the explanation could not be verified against the analysis results: ${unverifiedNumbers.join(", ")}.`,
    );
  }

  const status =
    removedFindings === 0 && unverifiedNumbers.length === 0
      ? "verified"
      : draft.keyFindings &&
          draft.keyFindings.length > 0 &&
          keyFindings.length === 0
        ? "unverified"
        : "partial";

  return {
    schemaVersion: "1.0",
    sessionId,
    intent: draft.intent,
    message: draft.message,
    summary: draft.summary,
    keyFindings,
    evidence: [...evidenceMap.values()].slice(0, 30),
    toolActions: (toolActions || []).slice(0, 12),
    warnings: warnings.slice(0, 14),
    followUpSuggestions: draft.followUpSuggestions || [],
    grounding: { status, removedFindings, droppedEvidence, unverifiedNumbers },
  };
}
