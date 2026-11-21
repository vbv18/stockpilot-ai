import { parse } from "csv-parse";
import { z } from "zod";
import { MAX_SKUS_PER_SESSION } from "../config/constants.js";
import { SkuId } from "../contracts/common.js";
import {
  TransformationConfig,
  ValidationSummary,
} from "../contracts/dataset.js";
import {
  dayIndexFromIso,
  isoFromDayIndex,
  parseDateToIso,
  parseQuantity,
} from "../lib/csvDate.js";
import { AppError } from "../lib/errors.js";
import { getStorage } from "../lib/storage.js";
import { DatasetModel } from "../models/dataset.model.js";
import { registerJobHandler } from "./jobRunner.js";
import { setStage, transition } from "./sessionService.js";

// ==================== Validation Job Handler ====================
registerJobHandler("validation", {
  async run(ctx) {
    const { datasetId, mapping } = ctx.input;
    const dataset = await DatasetModel.findOne({
      _id: datasetId,
      userId: ctx.userId,
    });
    if (!dataset) {
      throw new AppError("NOT_FOUND", "Dataset not found");
    }

    const storage = getStorage();
    const stream = storage.getStream(dataset.originalFileRef.key);
    const encoding = dataset.originalFileRef.encoding || "utf-8";
    const delimiter = dataset.originalFileRef.delimiter || ",";

    const parser = stream.pipe(
      parse({
        delimiter,
        bom: true,
        relax_quotes: true,
        relax_column_count: true,
        skip_empty_lines: true,
        columns: false,
        encoding,
      }),
    );

    let totalDataRows = 0;
    let acceptedRows = 0;
    let droppedNegativeRows = 0;
    let negativeQuantityRows = 0;
    let zeroQuantityRows = 0;

    const rejectedByReason = {
      invalid_sku: 0,
      invalid_date: 0,
      non_numeric_quantity: 0,
      negative_quantity: 0,
      malformed_row: 0,
    };

    let header = null;
    let skuColIdx = -1;
    let dateColIdx = -1;
    let qtyColIdx = -1;

    // Map: sku -> Map(dayIndex -> summed quantity)
    const skuMap = new Map();
    let minDay = Infinity;
    let maxDay = -Infinity;

    for await (const record of parser) {
      if (!header) {
        header = record.map((c) => String(c).trim());
        skuColIdx = header.indexOf(mapping.skuColumn);
        dateColIdx = header.indexOf(mapping.dateColumn);
        qtyColIdx = header.indexOf(mapping.quantityColumn);

        if (skuColIdx === -1 || dateColIdx === -1 || qtyColIdx === -1) {
          throw new AppError(
            "UNPROCESSABLE",
            "Mapped columns not found in header",
          );
        }
        continue;
      }

      totalDataRows++;
      if (totalDataRows > 600_000) {
        throw new AppError(
          "DATASET_VALIDATION_FAILED",
          "The file has more rows than the allowed maximum.",
        );
      }

      if (record.length !== header.length) {
        rejectedByReason.malformed_row++;
        continue;
      }

      const rawSku = record[skuColIdx];
      const sku = typeof rawSku === "string" ? rawSku.trim() : "";
      if (!sku || sku.length > 64) {
        rejectedByReason.invalid_sku++;
        continue;
      }

      const rawDate = record[dateColIdx];
      const isoDate = parseDateToIso(String(rawDate || ""), mapping.dateFormat);
      if (!isoDate) {
        rejectedByReason.invalid_date++;
        continue;
      }

      const rawQty = record[qtyColIdx];
      const qty = parseQuantity(String(rawQty || ""));
      if (qty === null) {
        rejectedByReason.non_numeric_quantity++;
        continue;
      }

      if (qty < 0) {
        negativeQuantityRows++;
        if (mapping.negativeQuantityPolicy === "drop") {
          droppedNegativeRows++;
          rejectedByReason.negative_quantity++;
          continue;
        } else {
          rejectedByReason.negative_quantity++;
          continue;
        }
      }

      if (qty === 0) {
        zeroQuantityRows++;
      }

      acceptedRows++;
      const dayIdx = dayIndexFromIso(isoDate);
      if (dayIdx < minDay) minDay = dayIdx;
      if (dayIdx > maxDay) maxDay = dayIdx;

      if (!skuMap.has(sku)) {
        skuMap.set(sku, new Map());
      }
      const dayMap = skuMap.get(sku);
      dayMap.set(dayIdx, (dayMap.get(dayIdx) || 0) + qty);
    }

    let distinctDayIndices = new Set();
    let totalMapEntries = 0;
    const topSkuCoverageList = [];

    for (const [sku, dayMap] of skuMap.entries()) {
      totalMapEntries += dayMap.size;
      let skuTotalQty = 0;
      let skuMinDay = Infinity;
      let skuMaxDay = -Infinity;

      for (const [dayIdx, q] of dayMap.entries()) {
        distinctDayIndices.add(dayIdx);
        skuTotalQty += q;
        if (dayIdx < skuMinDay) skuMinDay = dayIdx;
        if (dayIdx > skuMaxDay) skuMaxDay = dayIdx;
      }

      const spanDays = skuMaxDay >= skuMinDay ? skuMaxDay - skuMinDay + 1 : 1;
      const activeDays = dayMap.size;
      const coveragePct = Number(
        Math.round((activeDays / spanDays) * 10000) / 100,
      );

      topSkuCoverageList.push({
        skuId: sku,
        totalQuantity: skuTotalQty,
        activeDays,
        firstDate: isoFromDayIndex(skuMinDay),
        lastDate: isoFromDayIndex(skuMaxDay),
        spanDays,
        coveragePct,
      });
    }

    // Sort topSkuCoverage: descending totalQuantity, tie: sku ascending
    topSkuCoverageList.sort((a, b) => {
      if (b.totalQuantity !== a.totalQuantity) {
        return b.totalQuantity - a.totalQuantity;
      }
      return a.skuId.localeCompare(b.skuId);
    });
    const topSkuCoverage = topSkuCoverageList.slice(0, 50);

    const duplicateSkuDateRecords = acceptedRows - totalMapEntries;
    const distinctSkus = skuMap.size;
    const calendarDaysInRange = minDay <= maxDay ? maxDay - minDay + 1 : 0;
    const daysWithAnyRecord = distinctDayIndices.size;
    const missingCalendarDays = Math.max(
      0,
      calendarDaysInRange - daysWithAnyRecord,
    );
    const rejectedRows =
      rejectedByReason.invalid_sku +
      rejectedByReason.invalid_date +
      rejectedByReason.non_numeric_quantity +
      rejectedByReason.negative_quantity +
      rejectedByReason.malformed_row;

    const warnings = [];
    if (missingCalendarDays > 0) {
      warnings.push(
        `${missingCalendarDays} calendar days in the date range have no records for any SKU. Confirming zero-fill treats them as zero demand.`,
      );
    }
    if (duplicateSkuDateRecords > 0) {
      warnings.push(
        `${duplicateSkuDateRecords} duplicate SKU/date records will be summed into one daily total.`,
      );
    }
    if (droppedNegativeRows > 0) {
      warnings.push(
        `${droppedNegativeRows} negative-quantity rows will be excluded (treated as returns, not demand).`,
      );
    }
    const nonNegativeRejections =
      rejectedRows -
      (mapping.negativeQuantityPolicy === "drop" ? droppedNegativeRows : 0);
    if (nonNegativeRejections > 0) {
      warnings.push(
        `${nonNegativeRejections} rows were rejected because of invalid values.`,
      );
    }

    const summaryObj = {
      totalDataRows,
      acceptedRows,
      rejectedRows,
      rejectedByReason,
      negativeQuantityRows,
      droppedNegativeRows,
      zeroQuantityRows,
      duplicateSkuDateRecords,
      distinctSkus,
      dateRange:
        minDay <= maxDay
          ? { min: isoFromDayIndex(minDay), max: isoFromDayIndex(maxDay) }
          : null,
      calendarDaysInRange,
      daysWithAnyRecord,
      missingCalendarDays,
      topSkuCoverage,
      warnings,
    };

    const validatedSummary = ValidationSummary.parse(summaryObj);

    // Write aggregated.json
    const skusArray = [];
    for (const [skuId, dayMap] of skuMap.entries()) {
      const points = Array.from(dayMap.entries()).sort((a, b) => a[0] - b[0]);
      skusArray.push({ skuId, points });
    }
    const aggregatedPayload = JSON.stringify({
      version: 1,
      minDay: minDay <= maxDay ? minDay : 0,
      maxDay: minDay <= maxDay ? maxDay : 0,
      skus: skusArray,
    });

    const aggKey = `datasets/${ctx.userId}/${ctx.sessionId}/${datasetId}/aggregated.json`;
    const aggRef = await storage.putBuffer(
      aggKey,
      Buffer.from(aggregatedPayload, "utf-8"),
    );

    dataset.validationSummary = validatedSummary;
    dataset.aggregatedFileRef = aggRef;
    dataset.rowCounts = {
      ...dataset.rowCounts,
      totalDataRows,
      acceptedRows,
      rejectedRows,
    };

    if (acceptedRows === 0) {
      dataset.status = "validation_failed";
      dataset.error = {
        code: "DATASET_VALIDATION_FAILED",
        message:
          "No valid rows were found. Check the column mapping and date format.",
      };
      await dataset.save();
      throw new AppError("DATASET_VALIDATION_FAILED", dataset.error.message);
    }

    if (
      mapping.negativeQuantityPolicy === "reject" &&
      negativeQuantityRows > 0
    ) {
      dataset.status = "validation_failed";
      dataset.error = {
        code: "NEGATIVE_QUANTITY_POLICY_REQUIRED",
        message: `${negativeQuantityRows} rows have negative quantities. Choose 'exclude negative rows' to continue; they will be treated as returns, not demand.`,
      };
      await dataset.save();
      throw new AppError(
        "NEGATIVE_QUANTITY_POLICY_REQUIRED",
        dataset.error.message,
      );
    }

    dataset.status = "validated";
    dataset.error = { code: null, message: null };
    await dataset.save();

    return { resultRef: { collection: "datasets", id: datasetId } };
  },

  async onFailed(ctx, failure) {
    const { datasetId } = ctx.input;
    await DatasetModel.updateOne(
      { _id: datasetId, userId: ctx.userId },
      {
        $set: {
          status: "validation_failed",
          "error.code": failure.code,
          "error.message": failure.userMessage,
        },
      },
    );
    await transition(ctx.userId, ctx.sessionId, "validation_failed").catch(
      () => {},
    );
    await setStage(ctx.userId, ctx.sessionId, "dataset", {
      status: "failed",
      errorCode: failure.code,
      userMessage: failure.userMessage,
      retryable: failure.retryable,
    });
  },

  async onCancelled(ctx) {
    const { datasetId } = ctx.input;
    await DatasetModel.updateOne(
      { _id: datasetId, userId: ctx.userId },
      { $set: { status: "uploaded" } },
    );
    await transition(ctx.userId, ctx.sessionId, "uploading").catch(() => {});
    await setStage(ctx.userId, ctx.sessionId, "dataset", {
      status: "cancelled",
    });
  },
});

// ==================== Transformation Job Handler ====================
registerJobHandler("transformation", {
  async run(ctx) {
    const { datasetId } = ctx.input;
    const dataset = await DatasetModel.findOne({
      _id: datasetId,
      userId: ctx.userId,
    });
    if (!dataset) {
      throw new AppError("NOT_FOUND", "Dataset not found");
    }

    const storage = getStorage();
    const aggKey = `datasets/${ctx.userId}/${ctx.sessionId}/${datasetId}/aggregated.json`;
    const aggBuf = await storage.readBuffer(aggKey);
    const aggJson = JSON.parse(aggBuf.toString("utf-8"));

    const AggSchema = z.object({
      version: z.literal(1),
      minDay: z.number().int(),
      maxDay: z.number().int(),
      skus: z.array(
        z.object({
          skuId: SkuId,
          points: z.array(z.tuple([z.number().int(), z.number().finite()])),
        }),
      ),
    });

    const parsedAgg = AggSchema.parse(aggJson);
    const maxDay = parsedAgg.maxDay;

    // Compute total quantity per SKU and sort
    const skuWithTotals = parsedAgg.skus.map((s) => {
      const totalQty = s.points.reduce((acc, p) => acc + p[1], 0);
      return { ...s, totalQty };
    });

    skuWithTotals.sort((a, b) => {
      if (b.totalQty !== a.totalQty) {
        return b.totalQty - a.totalQty;
      }
      return a.skuId.localeCompare(b.skuId);
    });

    const keptSkus = skuWithTotals.slice(0, MAX_SKUS_PER_SESSION);
    // Sort kept SKUs by skuId ascending for CSV rows
    keptSkus.sort((a, b) => a.skuId.localeCompare(b.skuId));

    let processedCsv = "sku_id,date,quantity\n";
    let processedRowsCount = 0;

    for (const skuItem of keptSkus) {
      const pointMap = new Map(skuItem.points);
      const firstDay =
        skuItem.points.length > 0 ? skuItem.points[0][0] : maxDay;

      for (let dayIdx = firstDay; dayIdx <= maxDay; dayIdx++) {
        const dateStr = isoFromDayIndex(dayIdx);
        const rawQty = pointMap.get(dayIdx) || 0;
        // Print with up to 4 decimals, trimmed trailing zeros
        const formattedQty = Number(rawQty.toFixed(4)).toString();
        processedCsv += `${skuItem.skuId},${dateStr},${formattedQty}\n`;
        processedRowsCount++;
      }
    }

    const procKey = `datasets/${ctx.userId}/${ctx.sessionId}/${datasetId}/processed.csv`;
    const procRef = await storage.putBuffer(
      procKey,
      Buffer.from(processedCsv, "utf-8"),
    );

    const transConfigObj = {
      aggregation: "sum_by_sku_date",
      zeroFill: true,
      seriesStart: "first_observed_date_per_sku",
      seriesEnd: "dataset_max_date",
      negativeQuantityPolicy: dataset.mapping.negativeQuantityPolicy,
      dateFormat: dataset.mapping.dateFormat,
      skuIds: keptSkus.map((s) => s.skuId),
      seriesEndDate: isoFromDayIndex(maxDay),
    };
    const validatedTransConfig = TransformationConfig.parse(transConfigObj);

    dataset.processedFileRef = procRef;
    dataset.transformationConfig = validatedTransConfig;
    dataset.rowCounts = {
      ...dataset.rowCounts,
      processedRows: processedRowsCount,
    };
    dataset.status = "ready";
    await dataset.save();

    await transition(ctx.userId, ctx.sessionId, "dataset_ready");
    await setStage(ctx.userId, ctx.sessionId, "dataset", {
      status: "succeeded",
      finishedAt: new Date(),
    });

    return { resultRef: { collection: "datasets", id: datasetId } };
  },

  async onFailed(ctx, failure) {
    const { datasetId } = ctx.input;
    await DatasetModel.updateOne(
      { _id: datasetId, userId: ctx.userId },
      { $set: { status: "validated" } },
    );
    await setStage(ctx.userId, ctx.sessionId, "dataset", {
      status: "failed",
      errorCode: failure.code,
      userMessage: failure.userMessage,
      retryable: failure.retryable,
    });
  },

  async onCancelled(ctx) {
    const { datasetId } = ctx.input;
    await DatasetModel.updateOne(
      { _id: datasetId, userId: ctx.userId },
      { $set: { status: "validated" } },
    );
    await setStage(ctx.userId, ctx.sessionId, "dataset", {
      status: "cancelled",
    });
  },
});
