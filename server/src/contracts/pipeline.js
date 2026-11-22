import { z } from "zod";
import { Seed, SkuId } from "./common.js";
import {
  DEMO_ASSUMPTION_DEFAULTS,
  SIMULATION_BOUNDS,
  SIMULATION_DEFAULTS,
} from "../config/constants.js";

export const HOLDING_COST_UNITS = ["per_unit_per_day", "per_unit_per_year"];
export const HoldingCostUnit = z.enum(HOLDING_COST_UNITS);

export const ForecastBody = z.object({ seed: Seed.optional() }).strict();

export const SkuAssumptionsInput = z
  .object({
    ordering_cost: z.number().finite().positive().max(1_000_000_000),
    holding_cost_annual: z.number().finite().positive().max(1_000_000_000),
    shortage_penalty: z.number().finite().positive().max(1_000_000_000),
    lead_time_mean: z.number().int().min(1).max(28),
    lead_time_std: z.number().finite().min(0).max(28).default(0),
    service_level: z.number().finite().min(0.80).max(0.99),
    unit_cost: z.number().finite().positive().max(1_000_000_000),
  })
  .strict();

export const AssumptionsBody = z
  .object({
    skus: z
      .record(SkuId, SkuAssumptionsInput)
      .refine((map) => Object.keys(map).length > 0, {
        message: "At least one SKU assumption is required",
      }),
    confirmed: z.literal(true),
    budget: z.number().finite().positive().max(1_000_000_000_000).optional().nullable(),
    capacity: z.number().finite().positive().max(1_000_000_000_000).optional().nullable(),
  })
  .strict();

export const AssumptionFieldKey = z.enum([
  "ordering_cost",
  "holding_cost_annual",
  "shortage_penalty",
  "lead_time_mean",
  "lead_time_std",
  "service_level",
  "unit_cost",
]);
export const AssumptionProvenance = z.enum([
  "demonstration_default",
  "user_provided",
]);

export function holdingCostDaily(a) {
  if (a.holding_cost_annual !== undefined) {
    return a.holding_cost_annual / 365;
  }
  return a.holdingCostUnit === "per_unit_per_day"
    ? a.holdingCost
    : a.holdingCost / 365;
}

export function computeProvenance(skusMap) {
  const d = DEMO_ASSUMPTION_DEFAULTS;
  const p = (same) => (same ? "demonstration_default" : "user_provided");
  const prov = {};
  for (const [skuId, s] of Object.entries(skusMap)) {
    prov[skuId] = {
      ordering_cost: p(s.ordering_cost === d.ordering_cost),
      holding_cost_annual: p(s.holding_cost_annual === d.holding_cost_annual),
      shortage_penalty: p(s.shortage_penalty === d.shortage_penalty),
      lead_time_mean: p(s.lead_time_mean === d.lead_time_mean),
      lead_time_std: p(s.lead_time_std === (d.lead_time_std ?? 0)),
      service_level: p(s.service_level === d.service_level),
      unit_cost: p(s.unit_cost === d.unit_cost),
    };
  }
  return prov;
}

export const SimulationBody = z
  .object({
    nScenarios: z
      .number()
      .int()
      .min(SIMULATION_BOUNDS.nScenariosMin)
      .max(SIMULATION_BOUNDS.nScenariosMax)
      .default(SIMULATION_DEFAULTS.nScenarios),
    horizonDays: z
      .number()
      .int()
      .min(SIMULATION_BOUNDS.horizonMin)
      .max(SIMULATION_BOUNDS.horizonMax)
      .default(SIMULATION_DEFAULTS.horizonDays),
    seed: Seed.optional(),
  })
  .strict();

export const ReplayBody = z
  .object({
    seed: Seed.optional(),
    holdoutDays: z.number().int().min(7).max(56).default(28),
  })
  .strict();

export const SessionCreateBody = z
  .object({ name: z.string().trim().min(1).max(120).optional() })
  .strict();
export const SessionPatchBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    archived: z.boolean().optional(),
    budget: z.number().finite().positive().max(1_000_000_000_000).optional().nullable(),
    capacity: z.number().finite().positive().max(1_000_000_000_000).optional().nullable(),
  })
  .strict()
  .refine(
    (b) =>
      b.name !== undefined ||
      b.archived !== undefined ||
      b.budget !== undefined ||
      b.capacity !== undefined,
    {
      message: "Provide at least one field to update",
    },
  );

export const PortfolioRunBody = z
  .object({
    budget: z.number().finite().positive().max(1_000_000_000_000).optional().nullable(),
    capacity: z.number().finite().positive().max(1_000_000_000_000).optional().nullable(),
  })
  .strict();

export const IdParam = z
  .object({ sessionId: z.string().regex(/^[a-fA-F0-9]{24}$/) })
  .strict();
