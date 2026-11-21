import { z } from "zod";

export const assumptionsFormSchema = z.object({
  orderingCost: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000),
  holdingCost: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000),
  holdingCostUnit: z.enum(["per_unit_per_day", "per_unit_per_year"]),
  shortagePenalty: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000),
  leadTimeDays: z
    .number({ invalid_type_error: "Enter a whole number" })
    .int("Must be a whole number of days")
    .min(1, "At least 1 day")
    .max(28, "At most 28 days (the forecast horizon)"),
  targetServiceLevelPct: z
    .number({ invalid_type_error: "Enter a number" })
    .gt(0, "Must be above 0%")
    .lt(100, "Must be below 100%"),
});
