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
    sku_id: SkuId,
    unit_cost: z.number().finite().positive().max(1_000_000_000),
    order_cost: z.number().finite().positive().max(1_000_000_000),
    holding_rate: z.number().finite().min(0).max(1_000_000_000),
    shortage_cost: z.number().finite().positive().max(1_000_000_000),
    lead_time_mean: z.number().int().min(1).max(28),
    lead_time_std: z.number().finite().min(0).max(28).default(0),
    target_service_level: z.number().finite().min(0.8).max(0.99),
    moq: z.number().int().min(1).default(1),
    pack_size: z.number().int().min(1).default(1),
    initial_stock: z.number().int().min(0).default(0),
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
    service_level: z.number().finite().min(0.8).max(0.99).optional(),
  })
  .strict();

export const AssumptionsBody = z
  .object({
    skus: z.union([
      z.array(SkuAssumptionsInput).min(1),
      z
        .record(SkuId, SkuAssumptionsInput)
        .refine((map) => Object.keys(map).length > 0, {
          message: "At least one SKU assumption is required",
        }),
    ]),
    confirmed: z.literal(true),
    budget: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000_000)
      .optional()
      .nullable(),
    capacity: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000_000)
      .optional()
      .nullable(),
  })
  .strict();

export const AssumptionFieldKey = z.enum([
  "sku_id",
  "unit_cost",
  "order_cost",
  "holding_rate",
  "shortage_cost",
  "lead_time_mean",
  "lead_time_std",
  "target_service_level",
  "moq",
  "pack_size",
  "initial_stock",
]);
export const AssumptionProvenance = z.enum([
  "demonstration_default",
  "user_provided",
]);

export function holdingCostDaily(a) {
  if (a.holding_cost_annual !== undefined && a.holding_cost_annual !== null) {
    return a.holding_cost_annual / 365;
  }
  if (a.holding_rate !== undefined && a.holding_rate !== null) {
    const annual = a.holding_rate * (a.unit_cost || 1);
    return annual / 365;
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
      unit_cost: p(s.unit_cost === d.unit_cost),
      order_cost: p((s.order_cost ?? s.ordering_cost) === d.order_cost),
      holding_rate: p(
        (s.holding_rate ?? s.holding_cost_annual) === d.holding_rate,
      ),
      shortage_cost: p(
        (s.shortage_cost ?? s.shortage_penalty) === d.shortage_cost,
      ),
      lead_time_mean: p(s.lead_time_mean === d.lead_time_mean),
      lead_time_std: p(s.lead_time_std === (d.lead_time_std ?? 0)),
      target_service_level: p(
        (s.target_service_level ?? s.service_level) === d.target_service_level,
      ),
      moq: p((s.moq ?? 1) === (d.moq ?? 1)),
      pack_size: p((s.pack_size ?? 1) === (d.pack_size ?? 1)),
      initial_stock: p((s.initial_stock ?? 0) === (d.initial_stock ?? 0)),
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
    budget: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000_000)
      .optional()
      .nullable(),
    capacity: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000_000)
      .optional()
      .nullable(),
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
    budget: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000_000)
      .optional()
      .nullable(),
    capacity: z
      .number()
      .finite()
      .positive()
      .max(1_000_000_000_000)
      .optional()
      .nullable(),
  })
  .strict();

export const IdParam = z
  .object({ sessionId: z.string().regex(/^[a-fA-F0-9]{24}$/) })
  .strict();
