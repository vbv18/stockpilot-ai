import { z } from "zod";
import { IsoDate, ObjectIdString, SkuId } from "./common.js";
import { HoldingCostUnit } from "./pipeline.js";
import {
  PyIntervalMetrics,
  PyIntervalStatus,
  PyPointMetrics,
  PySimulateAggregate,
  PySkuOptimization,
  PySkuSimulation,
  PySkuStatus,
} from "./python.js";

export const AI_SCHEMA_VERSION = "1.0";

export const TOOL_NAMES = [
  "get_sku_forecast",
  "get_inventory_recommendation",
  "compare_inventory_policies",
  "run_what_if_scenario",
  "get_inventory_risk_summary",
];
export const ToolName = z.enum(TOOL_NAMES);

const num = z.number().finite();
const numArr = z.array(num);

// ---------- tool inputs (sessionId/userId are NEVER model-supplied) ----------
export const GetSkuForecastInput = z
  .object({
    skuId: SkuId,
    includeHistoryDays: z.number().int().min(0).max(120).default(56),
  })
  .strict();

export const GetInventoryRecommendationInput = z.object({ skuId: SkuId }).strict();
export const CompareInventoryPoliciesInput = z.object({ skuId: SkuId.optional() }).strict();

export const WhatIfOverrides = z
  .object({
    orderingCost: z.number().finite().positive().max(1_000_000_000).optional(),
    holdingCost: z.number().finite().positive().max(1_000_000_000).optional(),
    holdingCostUnit: HoldingCostUnit.optional(),
    shortagePenalty: z.number().finite().positive().max(1_000_000_000).optional(),
    leadTimeDays: z.number().int().min(1).max(28).optional(),
    targetServiceLevel: z.number().finite().gt(0).lt(1).optional(),
  })
  .strict()
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: "Provide at least one override",
  });

export const RunWhatIfInput = z.object({ overrides: WhatIfOverrides }).strict();

export const RiskRankBy = z.enum([
  "risk_score",
  "stockout_units_deterministic",
  "stockout_units_uncertainty_aware",
]);
export const GetRiskSummaryInput = z
  .object({
    topN: z.number().int().min(1).max(15).default(5),
    rankBy: RiskRankBy.default("risk_score"),
  })
  .strict();

export const TOOL_INPUT_SCHEMAS = {
  get_sku_forecast: GetSkuForecastInput,
  get_inventory_recommendation: GetInventoryRecommendationInput,
  compare_inventory_policies: CompareInventoryPoliciesInput,
  run_what_if_scenario: RunWhatIfInput,
  get_inventory_risk_summary: GetRiskSummaryInput,
};

// ---------- tool outputs ----------
export const AssumptionsView = z
  .object({
    version: z.number().int(),
    orderingCost: num,
    holdingCost: num,
    holdingCostUnit: HoldingCostUnit,
    holdingCostPerUnitPerDay: num,
    shortagePenalty: num,
    leadTimeDays: z.number().int(),
    targetServiceLevel: num,
  })
  .strict();

export const RiskFlagView = z.object({ code: z.string(), message: z.string() }).strict();
export const SkuRiskView = z
  .object({
    skuId: SkuId,
    level: z.enum(["low", "medium", "high"]),
    score: z.number().int(),
    flags: z.array(RiskFlagView),
  })
  .strict();

export const GetSkuForecastOutput = z
  .object({
    skuId: SkuId,
    status: PySkuStatus,
    intervalStatus: PyIntervalStatus,
    message: z.string().nullable(),
    nObservations: z.number().int(),
    historyTail: z
      .object({ startDate: IsoDate, values: numArr })
      .strict()
      .nullable(),
    forecast: z
      .object({
        startDate: IsoDate,
        autoetsMean: numArr,
        seasonalNaiveMean: numArr,
        p10: numArr,
        p50: numArr,
        p90: numArr,
      })
      .strict()
      .nullable(),
    summary: z
      .object({
        avgDailyForecast: num,
        totalForecast28: num,
        avgP10: num.nullable(),
        avgP90: num.nullable(),
        last28Avg: num.nullable(),
        prior28Avg: num.nullable(),
        zeroDaysLast56: z.number().int().nullable(),
      })
      .strict()
      .nullable(),
    evaluation: z
      .object({
        autoets: PyPointMetrics.nullable(),
        seasonalNaive: PyPointMetrics.nullable(),
        intervalMetrics: PyIntervalMetrics.nullable(),
      })
      .strict()
      .nullable(),
    residualStd: num.nullable(),
    nResidualBlocks: z.number().int(),
    warnings: z.array(z.string()),
  })
  .strict();

export const GetInventoryRecommendationOutput = z
  .object({
    skuId: SkuId,
    assumptions: AssumptionsView,
    optimization: PySkuOptimization,
    risk: SkuRiskView,
    simulation: PySkuSimulation.nullable(),
    stale: z.boolean(),
  })
  .strict();

export const CompareInventoryPoliciesOutput = z
  .object({
    scope: z.enum(["sku", "aggregate"]),
    simulationRunId: z.string(),
    scenarioCount: z.number().int(),
    horizonDays: z.number().int(),
    seed: z.number().int(),
    sku: PySkuSimulation.nullable(),
    aggregate: PySimulateAggregate.nullable(),
    skuCount: z.number().int(),
  })
  .strict();

export const WhatIfPolicyTotals = z
  .object({
    totalCost: num,
    orderingCost: num,
    holdingCost: num,
    shortageCost: num,
    serviceLevel: num,
    stockoutUnits: num,
    avgInventory: num,
    orders: num,
  })
  .strict();

export const RunWhatIfOutput = z
  .object({
    whatIfRunId: z.string(),
    overrides: z.record(z.union([z.number(), z.string()])),
    baselineAssumptions: AssumptionsView.omit({ version: true }),
    scenarioAssumptions: AssumptionsView.omit({ version: true }),
    baseline: z
      .object({ deterministic: WhatIfPolicyTotals, uncertaintyAware: WhatIfPolicyTotals })
      .strict(),
    scenario: z
      .object({ deterministic: WhatIfPolicyTotals, uncertaintyAware: WhatIfPolicyTotals })
      .strict(),
    deltas: z
      .object({
        deterministicTotalCost: num,
        uncertaintyAwareTotalCost: num,
        deterministicServiceLevel: num,
        uncertaintyAwareServiceLevel: num,
      })
      .strict(),
    perSku: z.array(
      z
        .object({
          skuId: SkuId,
          eoqBaseline: z.number().int(),
          eoqScenario: z.number().int(),
          ropDeterministicBaseline: z.number().int(),
          ropDeterministicScenario: z.number().int(),
          ropUncertaintyAwareBaseline: z.number().int(),
          ropUncertaintyAwareScenario: z.number().int(),
          totalCostDeterministicDelta: num,
          totalCostUncertaintyAwareDelta: num,
        })
        .strict(),
    ),
    note: z.string(),
  })
  .strict();

export const GetRiskSummaryOutput = z
  .object({
    rankedBy: RiskRankBy,
    targetServiceLevel: num,
    simulationAvailable: z.boolean(),
    items: z.array(
      SkuRiskView.extend({
        stockoutUnitsDeterministic: num.nullable(),
        stockoutUnitsUncertaintyAware: num.nullable(),
      }),
    ),
    countsByLevel: z
      .object({ low: z.number().int(), medium: z.number().int(), high: z.number().int() })
      .strict(),
    criteria: z.string(),
  })
  .strict();

export const ToolErrorOutput = z
  .object({ error: z.object({ code: z.string(), message: z.string() }).strict() })
  .strict();

// ---------- assistant response ----------
export const AI_INTENTS = [
  "inventory_analysis",
  "recommendation_explanation",
  "what_if_analysis",
  "anomaly_investigation",
  "decision_support",
  "session_overview",
  "out_of_scope",
  "insufficient_evidence",
];
export const AiIntent = z.enum(AI_INTENTS);

export const EVIDENCE_ARTIFACT_TYPES = [
  "session_digest",
  "dataset",
  "forecast_run",
  "evaluation",
  "assumption_set",
  "optimization_run",
  "simulation_run",
  "what_if_run",
];
export const EvidenceId = z.string().regex(/^E\d{1,3}$/);

export const FINDING_UNITS = [
  "units",
  "inr",
  "inr_per_unit",
  "percent",
  "fraction",
  "days",
  "count",
  "ratio",
  "text",
  "none",
];
export const FINDING_PROVENANCE = [
  "observed",
  "forecast",
  "assumption",
  "calculated",
  "simulated",
  "what_if",
];

export const KeyFinding = z
  .object({
    label: z.string().min(1).max(120),
    value: z.union([z.number().finite(), z.string().max(80), z.null()]),
    unit: z.enum(FINDING_UNITS),
    skuId: SkuId.nullable(),
    evidenceId: EvidenceId,
    provenance: z.enum(FINDING_PROVENANCE),
  })
  .strict();

export const AssistantDraft = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    intent: AiIntent,
    message: z.string().min(1).max(4000),
    summary: z.string().min(1).max(500),
    keyFindings: z.array(KeyFinding).max(20),
    evidence: z
      .array(
        z
          .object({
            evidenceId: EvidenceId,
            metricKeys: z.array(z.string().min(1).max(80)).max(20),
            note: z.string().max(200).nullable(),
          })
          .strict(),
      )
      .max(30),
    warnings: z.array(z.string().max(300)).max(10),
    followUpSuggestions: z.array(z.string().max(200)).max(4),
  })
  .strict();

export const EvidenceRef = z
  .object({
    evidenceId: EvidenceId,
    artifactType: z.enum(EVIDENCE_ARTIFACT_TYPES),
    artifactId: z.string().min(1).max(64),
    skuId: SkuId.nullable(),
    metricKeys: z.array(z.string().max(80)).max(20),
    note: z.string().max(200).nullable(),
  })
  .strict();

export const ToolActionSummary = z
  .object({
    tool: ToolName,
    status: z.enum(["ok", "error"]),
    argsSummary: z.string().max(300),
    evidenceId: EvidenceId.nullable(),
  })
  .strict();

export const GroundingInfo = z
  .object({
    status: z.enum(["verified", "partial", "unverified"]),
    removedFindings: z.number().int().nonnegative(),
    droppedEvidence: z.number().int().nonnegative(),
    unverifiedNumbers: z.array(z.string().max(40)).max(10),
  })
  .strict();

export const AssistantResponse = z
  .object({
    schemaVersion: z.literal(AI_SCHEMA_VERSION),
    sessionId: ObjectIdString,
    intent: AiIntent,
    message: z.string().min(1).max(4000),
    summary: z.string().min(1).max(500),
    keyFindings: z.array(KeyFinding).max(20),
    evidence: z.array(EvidenceRef).max(30),
    toolActions: z.array(ToolActionSummary).max(12),
    warnings: z.array(z.string().max(300)).max(14),
    followUpSuggestions: z.array(z.string().max(200)).max(4),
    grounding: GroundingInfo,
  })
  .strict();

export const ConversationCreateBody = z
  .object({
    sessionId: ObjectIdString,
    title: z.string().trim().min(1).max(120).optional(),
  })
  .strict();

export const MessageCreateBody = z
  .object({
    content: z.string().trim().min(1).max(2000),
  })
  .strict();

export const ConversationIdParam = z
  .object({
    conversationId: ObjectIdString,
  })
  .strict();
