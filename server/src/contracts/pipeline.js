import { z } from "zod";
import { Seed } from "./common.js";
import { DEMO_ASSUMPTION_DEFAULTS, SIMULATION_BOUNDS, SIMULATION_DEFAULTS } from "../config/constants.js";

export const HOLDING_COST_UNITS = ["per_unit_per_day", "per_unit_per_year"];
export const HoldingCostUnit = z.enum(HOLDING_COST_UNITS);

export const ForecastBody = z.object({ seed: Seed.optional() }).strict();

export const AssumptionsBody = z
  .object({
    orderingCost: z.number().finite().positive().max(1_000_000_000),
    holdingCost: z.number().finite().positive().max(1_000_000_000),
    holdingCostUnit: HoldingCostUnit,
    shortagePenalty: z.number().finite().positive().max(1_000_000_000),
    leadTimeDays: z.number().int().min(1).max(28),
    targetServiceLevel: z.number().finite().gt(0).lt(1),
    confirmed: z.literal(true),
  })
  .strict();

export const AssumptionFieldKey = z.enum([
  "orderingCost", "holdingCost", "holdingCostUnit", "shortagePenalty", "leadTimeDays", "targetServiceLevel",
]);
export const AssumptionProvenance = z.enum(["demonstration_default", "user_provided"]);

export function holdingCostDaily(a) {
  return a.holdingCostUnit === "per_unit_per_day" ? a.holdingCost : a.holdingCost / 365;
}

export function computeProvenance(a) {
  const d = DEMO_ASSUMPTION_DEFAULTS;
  const p = (same) => (same ? "demonstration_default" : "user_provided");
  return {
    orderingCost: p(a.orderingCost === d.orderingCost),
    holdingCost: p(a.holdingCost === d.holdingCost),
    holdingCostUnit: p(a.holdingCostUnit === d.holdingCostUnit),
    shortagePenalty: p(a.shortagePenalty === d.shortagePenalty),
    leadTimeDays: p(a.leadTimeDays === d.leadTimeDays),
    targetServiceLevel: p(a.targetServiceLevel === d.targetServiceLevel),
  };
}

export const SimulationBody = z
  .object({
    nScenarios: z.number().int().min(SIMULATION_BOUNDS.nScenariosMin).max(SIMULATION_BOUNDS.nScenariosMax).default(SIMULATION_DEFAULTS.nScenarios),
    horizonDays: z.number().int().min(SIMULATION_BOUNDS.horizonMin).max(SIMULATION_BOUNDS.horizonMax).default(SIMULATION_DEFAULTS.horizonDays),
    seed: Seed.optional(),
  })
  .strict();

export const SessionCreateBody = z.object({ name: z.string().trim().min(1).max(120).optional() }).strict();
export const SessionPatchBody = z
  .object({ name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() })
  .strict()
  .refine((b) => b.name !== undefined || b.archived !== undefined, { message: "Provide name or archived" });

export const IdParam = z.object({ sessionId: z.string().regex(/^[a-fA-F0-9]{24}$/) }).strict();
