import { z } from "zod";
import { IsoDate, ObjectIdString, SkuId } from "./common.js";
import { HoldingCostUnit } from "./pipeline.js";
import {
  PyDemandClass,
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
  "get_portfolio_plan",
  "get_model_comparison",
  "get_dependency_pairs",
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

export const GetInventoryRecommendationInput = z
  .object({ skuId: SkuId })
  .strict();
export const CompareInventoryPoliciesInput = z
  .object({ skuId: SkuId.nullish() })
  .strict();

export const SkuWhatIfOverrides = z
  .object({
    ordering_cost: z.number().finite().positive().max(1_000_000_000).optional(),
    holding_cost_annual: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000)
      .optional(),
    shortage_penalty: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000)
      .optional(),
    order_cost: z.number().finite().positive().max(1_000_000_000).optional(),
    holding_rate: z.number().finite().positive().max(1_000_000_000).optional(),
    shortage_cost: z.number().finite().positive().max(1_000_000_000).optional(),
    lead_time_mean: z.number().int().min(1).max(28).optional(),
    lead_time_std: z.number().finite().min(0).max(28).optional(),
    service_level: z.number().finite().min(0.8).max(0.99).optional(),
    target_service_level: z.number().finite().min(0.8).max(0.99).optional(),
    unit_cost: z.number().finite().positive().max(1_000_000_000).optional(),
    moq: z.number().int().min(1).optional(),
    pack_size: z.number().int().min(1).optional(),
    initial_stock: z.number().int().min(0).optional(),
  })
  .strict()
  .refine((o) => Object.values(o).some((v) => v !== undefined), {
    message: "Provide at least one override for this SKU",
  });

export const WhatIfOverrides = z
  .record(SkuId, SkuWhatIfOverrides)
  .refine((m) => Object.keys(m).length > 0, {
    message: "Provide overrides for at least one SKU",
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

export const GetPortfolioPlanInput = z
  .object({
    skuId: SkuId.nullish(),
  })
  .strict();

export const GetModelComparisonInput = z
  .object({
    skuId: SkuId.nullish(),
    sku: SkuId.nullish(),
  })
  .strict();

export const GetDependencyPairsInput = z
  .object({
    skuId: SkuId.nullish(),
    sku: SkuId.nullish(),
  })
  .strict();

export const TOOL_INPUT_SCHEMAS = {
  get_sku_forecast: GetSkuForecastInput,
  get_inventory_recommendation: GetInventoryRecommendationInput,
  compare_inventory_policies: CompareInventoryPoliciesInput,
  run_what_if_scenario: RunWhatIfInput,
  get_inventory_risk_summary: GetRiskSummaryInput,
  get_portfolio_plan: GetPortfolioPlanInput,
  get_model_comparison: GetModelComparisonInput,
  get_dependency_pairs: GetDependencyPairsInput,
};

// ---------- tool outputs ----------
export const SkuAssumptions = z
  .object({
    sku_id: SkuId.optional(),
    ordering_cost: num.optional(),
    holding_cost_annual: num.optional(),
    shortage_penalty: num.optional(),
    order_cost: num.optional(),
    holding_rate: num.optional(),
    shortage_cost: num.optional(),
    lead_time_mean: z.number().int(),
    lead_time_std: num,
    service_level: num.optional(),
    target_service_level: num.optional(),
    unit_cost: num,
    moq: z.number().int().optional(),
    pack_size: z.number().int().optional(),
    initial_stock: z.number().int().optional(),
  })
  .strict();

export const AssumptionsView = z
  .object({
    version: z.number().int(),
    skuId: SkuId,
    ordering_cost: num.optional(),
    holding_cost_annual: num.optional(),
    shortage_penalty: num.optional(),
    order_cost: num.optional(),
    holding_rate: num.optional(),
    shortage_cost: num.optional(),
    lead_time_mean: z.number().int(),
    lead_time_std: num,
    service_level: num.optional(),
    target_service_level: num.optional(),
    unit_cost: num,
    moq: z.number().int().optional(),
    pack_size: z.number().int().optional(),
    initial_stock: z.number().int().optional(),
  })
  .strict();

export const RiskFlagView = z
  .object({ code: z.string(), message: z.string() })
  .strict();
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
    demandClass: PyDemandClass.optional().nullable(),
    adi: num.optional().nullable(),
    cv2: num.optional().nullable(),
    chosenModel: z.string().optional().nullable(),
    maseImprovement: num.optional().nullable(),
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
    overrides: z.record(SkuId, z.record(z.union([z.number(), z.string()]))),
    baselineAssumptions: z.record(SkuId, SkuAssumptions),
    scenarioAssumptions: z.record(SkuId, SkuAssumptions),
    baseline: z
      .object({
        deterministic: WhatIfPolicyTotals,
        uncertaintyAware: WhatIfPolicyTotals,
        quantile: WhatIfPolicyTotals.optional(),
      })
      .strict(),
    scenario: z
      .object({
        deterministic: WhatIfPolicyTotals,
        uncertaintyAware: WhatIfPolicyTotals,
        quantile: WhatIfPolicyTotals.optional(),
      })
      .strict(),
    deltas: z
      .object({
        deterministicTotalCost: num,
        uncertaintyAwareTotalCost: num,
        quantileTotalCost: num.optional(),
        deterministicServiceLevel: num,
        uncertaintyAwareServiceLevel: num,
        quantileServiceLevel: num.optional(),
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
          ropQuantileBaseline: z.number().int().optional(),
          ropQuantileScenario: z.number().int().optional(),
          totalCostDeterministicDelta: num,
          totalCostUncertaintyAwareDelta: num,
          totalCostQuantileDelta: num.optional(),
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
      .object({
        low: z.number().int(),
        medium: z.number().int(),
        high: z.number().int(),
      })
      .strict(),
    criteria: z.string(),
  })
  .strict();

export const SkuPortfolioPlanItem = z
  .object({
    skuId: SkuId,
    serviceLevel: num,
    rop: z.number().int(),
    avgInventory: num,
    inventoryInvestment: num,
    totalCost: num,
    turnover: num,
    greedyServiceLevel: num.optional().nullable(),
    exactServiceLevel: num.optional().nullable(),
    greedyCost: num.optional().nullable(),
    exactCost: num.optional().nullable(),
    greedyRop: z.number().int().optional().nullable(),
    exactRop: z.number().int().optional().nullable(),
  })
  .strict();

export const PortfolioPlanTotals = z
  .object({
    totalCost: num,
    totalInventoryInvestment: num,
    totalUnits: num,
    avgServiceLevel: num,
    turnover: num,
  })
  .strict();

export const SkuPortfolioComparison = z
  .object({
    skuId: SkuId,
    unconstrained: SkuPortfolioPlanItem,
    constrained: SkuPortfolioPlanItem,
    costDelta: num,
    serviceLevelDelta: num,
  })
  .strict();

export const GetPortfolioPlanOutput = z
  .object({
    status: z.enum(["succeeded", "not_run", "infeasible"]),
    portfolioRunId: z.string().nullable().optional(),
    budget: num.nullable().optional(),
    capacity: num.nullable().optional(),
    bindingConstraints: z.array(z.string()),
    budgetShadowPrice: num.nullable().optional(),
    shadowPrice: num.nullable().optional(),
    exactCost: num.nullable().optional(),
    greedyCost: num.nullable().optional(),
    optimalityGapPct: num.nullable().optional(),
    minimumFeasibleBudget: num.nullable().optional(),
    totalCostDelta: num.nullable().optional(),
    budgetUsagePct: num.nullable().optional(),
    capacityUsagePct: num.nullable().optional(),
    unconstrained: PortfolioPlanTotals.nullable().optional(),
    constrained: PortfolioPlanTotals.nullable().optional(),
    sku: SkuPortfolioComparison.nullable().optional(),
    skus: z.array(SkuPortfolioComparison).optional(),
    message: z.string().nullable().optional(),
  })
  .strict();

export const BaselineImprovementSummary = z
  .object({
    maePct: num.nullable().optional(),
    rmsePct: num.nullable().optional(),
    wapePct: num.nullable().optional(),
    coverageMinusNominal: num.nullable().optional(),
  })
  .strict();

export const ModelMetricsSummary = z
  .object({
    mae: num.nullable().optional(),
    rmse: num.nullable().optional(),
    wape: num.nullable().optional(),
    mase: num.nullable().optional(),
    coverage: num.nullable().optional(),
    pinballLoss: num.nullable().optional(),
  })
  .strict();

export const SkuModelComparison = z
  .object({
    skuId: SkuId,
    status: z.string(),
    chosenModel: z.string().nullable().optional(),
    maseImprovement: num.nullable().optional(),
    autoets: ModelMetricsSummary.nullable().optional(),
    seasonalNaive: ModelMetricsSummary.nullable().optional(),
    crostonSba: ModelMetricsSummary.nullable().optional(),
    naive: ModelMetricsSummary.nullable().optional(),
    globalLgbm: ModelMetricsSummary.nullable().optional(),
    baselineImprovement: BaselineImprovementSummary.nullable().optional(),
    coverageMinusNominal: num.nullable().optional(),
    intervalCoverage: num.nullable().optional(),
    intervalMeanWidth: num.nullable().optional(),
  })
  .strict();

export const ModelAggregateSummary = z
  .object({
    maeMean: num.nullable().optional(),
    rmseMean: num.nullable().optional(),
    wapePooled: num.nullable().optional(),
    maseMean: num.nullable().optional(),
    coverageMean: num.nullable().optional(),
    pinballLossMean: num.nullable().optional(),
  })
  .strict();

export const GetModelComparisonOutput = z
  .object({
    status: z.enum(["evaluated", "not_evaluated"]),
    forecastRunId: z.string().nullable().optional(),
    sku: SkuModelComparison.nullable().optional(),
    aggregate: z
      .object({
        autoets: ModelAggregateSummary.nullable().optional(),
        seasonalNaive: ModelAggregateSummary.nullable().optional(),
        crostonSba: ModelAggregateSummary.nullable().optional(),
        naive: ModelAggregateSummary.nullable().optional(),
        globalLgbm: ModelAggregateSummary.nullable().optional(),
        baselineImprovement: BaselineImprovementSummary.nullable().optional(),
        coverageMinusNominal: num.nullable().optional(),
        coverageMean: num.nullable().optional(),
        meanWidthMean: num.nullable().optional(),
      })
      .nullable()
      .optional(),
    chosenModelCounts: z.record(z.string(), z.number().int()).optional(),
    skus: z.array(SkuModelComparison).optional(),
    message: z.string().nullable().optional(),
  })
  .strict();

export const DependencyPairView = z
  .object({
    sku_i: z.string(),
    sku_j: z.string(),
    rho: num,
    relation: z.enum(["complementary", "substitute-like"]),
  })
  .strict();

export const GetDependencyPairsOutput = z
  .object({
    status: z.enum(["computed", "not_available"]),
    optimizationRunId: z.string().nullable().optional(),
    skuId: SkuId.nullable().optional(),
    poolingRatio: num.nullable().optional(),
    pairsCount: z.number().int().optional(),
    pairs: z.array(DependencyPairView),
    message: z.string().nullable().optional(),
  })
  .strict();

export const ToolErrorOutput = z
  .object({
    error: z.object({ code: z.string(), message: z.string() }).strict(),
  })
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
  "portfolio_run",
  "replay_run",
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
