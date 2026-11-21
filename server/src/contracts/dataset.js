import { z } from "zod";
import { IsoDate, SkuId } from "./common.js";

export const DATE_FORMATS = ["iso", "dmy", "mdy"]; // iso=YYYY-MM-DD, dmy=D/M/YYYY, mdy=M/D/YYYY (time part ignored)
export const DateFormat = z.enum(DATE_FORMATS);
export const NegativeQuantityPolicy = z.enum(["reject", "drop"]);

export const ColumnMappingBody = z
  .object({
    skuColumn: z.string().min(1).max(200),
    dateColumn: z.string().min(1).max(200),
    quantityColumn: z.string().min(1).max(200),
    dateFormat: DateFormat,
    negativeQuantityPolicy: NegativeQuantityPolicy,
  })
  .strict()
  .refine(
    (m) => new Set([m.skuColumn, m.dateColumn, m.quantityColumn]).size === 3,
    {
      message:
        "skuColumn, dateColumn and quantityColumn must be three different columns",
      path: ["skuColumn"],
    },
  );

export const DatasetConfirmBody = z
  .object({
    confirmAggregateDuplicates: z.literal(true),
    assumeCompleteCoverage: z.literal(true),
    acknowledgeDroppedNegativeRows: z.boolean(),
  })
  .strict();

export const REJECTED_REASONS = [
  "invalid_sku",
  "invalid_date",
  "non_numeric_quantity",
  "negative_quantity",
  "malformed_row",
];
export const RejectedReason = z.enum(REJECTED_REASONS);

export const SkuCoverage = z
  .object({
    skuId: SkuId,
    totalQuantity: z.number().finite(),
    activeDays: z.number().int().nonnegative(),
    firstDate: IsoDate,
    lastDate: IsoDate,
    spanDays: z.number().int().positive(),
    coveragePct: z.number().min(0).max(100),
  })
  .strict();

export const ValidationSummary = z
  .object({
    totalDataRows: z.number().int().nonnegative(),
    acceptedRows: z.number().int().nonnegative(),
    rejectedRows: z.number().int().nonnegative(),
    rejectedByReason: z
      .object({
        invalid_sku: z.number().int().nonnegative(),
        invalid_date: z.number().int().nonnegative(),
        non_numeric_quantity: z.number().int().nonnegative(),
        negative_quantity: z.number().int().nonnegative(),
        malformed_row: z.number().int().nonnegative(),
      })
      .strict(),
    negativeQuantityRows: z.number().int().nonnegative(),
    droppedNegativeRows: z.number().int().nonnegative(),
    zeroQuantityRows: z.number().int().nonnegative(),
    duplicateSkuDateRecords: z.number().int().nonnegative(),
    distinctSkus: z.number().int().nonnegative(),
    dateRange: z.object({ min: IsoDate, max: IsoDate }).strict().nullable(),
    calendarDaysInRange: z.number().int().nonnegative(),
    daysWithAnyRecord: z.number().int().nonnegative(),
    missingCalendarDays: z.number().int().nonnegative(),
    topSkuCoverage: z.array(SkuCoverage).max(50),
    warnings: z.array(z.string().max(300)).max(20),
  })
  .strict();

export const TransformationConfig = z
  .object({
    aggregation: z.literal("sum_by_sku_date"),
    zeroFill: z.literal(true),
    seriesStart: z.literal("first_observed_date_per_sku"),
    seriesEnd: z.literal("dataset_max_date"),
    negativeQuantityPolicy: NegativeQuantityPolicy,
    dateFormat: DateFormat,
    skuIds: z.array(SkuId),
    seriesEndDate: IsoDate,
  })
  .strict();
