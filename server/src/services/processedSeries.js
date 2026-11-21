import { parse } from "csv-parse";
import { AppError } from "../lib/errors.js";
import { getStorage } from "../lib/storage.js";
import { DatasetModel } from "../models/dataset.model.js";

export async function loadProcessedSeries(userId, datasetId) {
  const dataset = await DatasetModel.findOne({ _id: datasetId, userId });
  if (!dataset) {
    throw new AppError("NOT_FOUND", "Dataset not found");
  }

  if (dataset.status !== "ready" || !dataset.processedFileRef?.key) {
    throw new AppError("INVALID_STATE", "Dataset is not processed or ready.");
  }

  const storage = getStorage();
  const fileStream = storage.getStream(dataset.processedFileRef.key);

  const parser = fileStream.pipe(
    parse({
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }),
  );

  const seriesBySku = new Map(); // skuId -> Array<{ date: string, quantity: number }>

  for await (const row of parser) {
    const skuId = row.sku_id;
    const date = row.date;
    const quantity = Number(row.quantity);

    if (!skuId || !date || !Number.isFinite(quantity)) {
      continue;
    }

    if (!seriesBySku.has(skuId)) {
      seriesBySku.set(skuId, []);
    }
    seriesBySku.get(skuId).push({ date, quantity });
  }

  const result = [];
  const sortedSkuIds = Array.from(seriesBySku.keys()).sort();

  for (const skuId of sortedSkuIds) {
    const rows = seriesBySku.get(skuId);
    if (rows.length === 0) continue;

    const startDate = rows[0].date;
    const values = [];
    let expectedDayIndex = Math.floor(
      Date.parse(`${startDate}T00:00:00Z`) / 86_400_000,
    );

    for (let i = 0; i < rows.length; i++) {
      const curDayIndex = Math.floor(
        Date.parse(`${rows[i].date}T00:00:00Z`) / 86_400_000,
      );
      if (curDayIndex !== expectedDayIndex) {
        throw new AppError(
          "INTERNAL_ERROR",
          `Processed dataset series for SKU ${skuId} has non-contiguous dates at index ${i}`,
        );
      }
      values.push(rows[i].quantity);
      expectedDayIndex++;
    }

    result.push({ skuId, startDate, values });
  }

  return result;
}
