import { z } from "zod";

export const skuAssumptionRowSchema = z.object({
  ordering_cost: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000),
  holding_cost_annual: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000),
  shortage_penalty: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000),
  lead_time_mean: z
    .number({ invalid_type_error: "Enter a whole number" })
    .int("Must be a whole number of days")
    .min(1, "At least 1 day")
    .max(28, "At most 28 days"),
  lead_time_std: z
    .number({ invalid_type_error: "Enter a number" })
    .min(0, "Cannot be negative")
    .max(28, "At most 28 days")
    .default(0),
  service_level: z
    .number({ invalid_type_error: "Enter a number" })
    .min(0.8, "At least 0.80 (80%)")
    .max(0.99, "At most 0.99 (99%)"),
  unit_cost: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000),
});

export const assumptionsFormSchema = z.record(
  z.string().min(1),
  skuAssumptionRowSchema,
);

export const sessionConstraintsSchema = z.object({
  budget: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000_000)
    .nullable()
    .optional(),
  capacity: z
    .number({ invalid_type_error: "Enter a number" })
    .positive("Must be greater than 0")
    .max(1_000_000_000_000)
    .nullable()
    .optional(),
});
