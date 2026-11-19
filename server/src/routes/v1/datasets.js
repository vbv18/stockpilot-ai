import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { getUser } from "../../auth/currentUser.js";
import { getEnv } from "../../config/env.js";
import { ColumnMappingBody, DatasetConfirmBody } from "../../contracts/dataset.js";
import { IdParam } from "../../contracts/pipeline.js";
import { AppError } from "../../lib/errors.js";
import { getStorage } from "../../lib/storage.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { DatasetModel } from "../../models/dataset.model.js";
import { JobModel } from "../../models/job.model.js";
import { enqueueJob } from "../../services/jobRunner.js";
import { getSessionOwned, requireStatus, setStage, transition } from "../../services/sessionService.js";
import { ACTION_ALLOWED_FROM } from "../../services/stateMachine.js";

const router = Router({ mergeParams: true });

// Setup multer disk storage
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `upload-${Date.now()}-${Math.random().toString(36).substring(2)}${ext}`);
    },
  }),
  limits: {
    fileSize: 62_914_560, // 60MB max
    files: 1,
    fields: 0,
  },
});

function detectDelimiter(line) {
  const counts = { ",": 0, ";": 0, "\t": 0 };
  for (const ch of line) {
    if (ch in counts) counts[ch]++;
  }
  let best = ",";
  let max = -1;
  for (const [delim, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      best = delim;
    }
  }
  return max >= 1 ? best : null;
}

function suggestMapping(columns) {
  const skuRegex = /^(sku|sku_id|stockcode|stock_code|item|item_id|product|product_id)$/i;
  const dateRegex = /^(date|invoicedate|invoice_date|order_date|day)$/i;
  const qtyRegex = /^(quantity|qty|units|units_sold|demand)$/i;

  return {
    skuColumn: columns.find((c) => skuRegex.test(c)) || null,
    dateColumn: columns.find((c) => dateRegex.test(c)) || null,
    quantityColumn: columns.find((c) => qtyRegex.test(c)) || null,
  };
}

// POST /sessions/:sessionId/dataset (multipart)
router.post(
  "/",
  upload.single("file"),
  async (req, res, next) => {
    let tmpFilePath = null;
    try {
      const user = getUser(res);
      const sessionId = req.params.sessionId;
      const session = await getSessionOwned(user.userId, sessionId);

      requireStatus(session, ACTION_ALLOWED_FROM.upload);

      // Check if a validation or transformation job is queued/running
      const activeJob = await JobModel.findOne({
        sessionId,
        stage: { $in: ["validation", "transformation"] },
        status: { $in: ["queued", "running"] },
      });
      if (activeJob) {
        throw new AppError("CONFLICT", "A validation or transformation job is already in progress.");
      }

      if (!req.file) {
        throw new AppError("VALIDATION_ERROR", "No file uploaded");
      }
      tmpFilePath = req.file.path;

      if (!req.file.originalname.toLowerCase().endsWith(".csv")) {
        throw new AppError("UNSUPPORTED_MEDIA_TYPE", "File must have a .csv extension");
      }

      // Check first 8192 bytes for NUL byte
      const fd = await fs.promises.open(tmpFilePath, "r");
      const checkBuf = Buffer.alloc(8192);
      const { bytesRead } = await fd.read(checkBuf, 0, 8192, 0);
      await fd.close();

      for (let i = 0; i < bytesRead; i++) {
        if (checkBuf[i] === 0x00) {
          throw new AppError("UNSUPPORTED_MEDIA_TYPE", "The file does not look like a text CSV");
        }
      }

      // Detect encoding
      const encBuf = Buffer.alloc(65536);
      const fdEnc = await fs.promises.open(tmpFilePath, "r");
      const { bytesRead: encBytes } = await fdEnc.read(encBuf, 0, 65536, 0);
      await fdEnc.close();

      let encoding = "utf-8";
      try {
        new TextDecoder("utf-8", { fatal: true }).decode(encBuf.subarray(0, encBytes));
      } catch {
        encoding = "latin1";
      }

      // Read file text to detect delimiter, columns, and preview
      const fullContent = await fs.promises.readFile(tmpFilePath, { encoding: encoding === "utf-8" ? "utf-8" : "latin1" });
      const cleanContent = fullContent.replace(/^\uFEFF/, ""); // strip BOM

      const lines = cleanContent.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        throw new AppError("UNPROCESSABLE", "The uploaded file is empty.");
      }

      const delimiter = detectDelimiter(lines[0]);
      if (!delimiter) {
        throw new AppError("UNSUPPORTED_MEDIA_TYPE", "Could not detect CSV columns");
      }

      const rawHeaders = lines[0].split(delimiter).map((h) => h.trim());
      if (rawHeaders.some((h) => !h) || new Set(rawHeaders).size !== rawHeaders.length) {
        throw new AppError("UNPROCESSABLE", "Header columns must be non-empty and unique");
      }

      const preview = lines.slice(1, 21).map((line) => line.split(delimiter).map((v) => v.trim()));

      // Storage
      const storage = getStorage();
      const datasetId = new DatasetModel()._id.toString();
      const storageKey = `datasets/${user.userId}/${sessionId}/${datasetId}/original.csv`;

      const readStream = fs.createReadStream(tmpFilePath);
      const fileRef = await storage.putStream(storageKey, readStream);
      fileRef.originalName = req.file.originalname;
      fileRef.encoding = encoding;
      fileRef.delimiter = delimiter;

      // If session had existing activeDatasetId, replace it and clean up storage
      if (session.activeDatasetId) {
        const oldId = session.activeDatasetId.toString();
        await DatasetModel.updateOne({ _id: oldId }, { $set: { status: "replaced" } });
        await storage.delete(`datasets/${user.userId}/${sessionId}/${oldId}/original.csv`);
        await storage.delete(`datasets/${user.userId}/${sessionId}/${oldId}/aggregated.json`);
        await storage.delete(`datasets/${user.userId}/${sessionId}/${oldId}/processed.csv`);
      }

      const dataset = await DatasetModel.create({
        _id: datasetId,
        userId: user.userId,
        sessionId,
        originalFileRef: fileRef,
        datasetSchema: { columns: rawHeaders },
        preview,
        status: "uploaded",
      });

      session.activeDatasetId = dataset._id;
      await session.save();

      await transition(user.userId, sessionId, "uploading");
      await setStage(user.userId, sessionId, "dataset", {
        status: "running",
        startedAt: new Date(),
        finishedAt: null,
        errorCode: null,
        userMessage: null,
      });

      const suggestedMapping = suggestMapping(rawHeaders);

      return res.status(201).json({
        data: {
          datasetId,
          originalName: fileRef.originalName,
          bytes: fileRef.bytes,
          delimiter,
          encoding,
          columns: rawHeaders,
          preview,
          suggestedMapping,
        },
      });
    } catch (err) {
      next(err);
    } finally {
      if (tmpFilePath) {
        fs.promises.unlink(tmpFilePath).catch(() => {});
      }
    }
  },
);

// PUT /sessions/:sessionId/dataset/mapping
router.put(
  "/mapping",
  validate({ params: IdParam, body: ColumnMappingBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      requireStatus(session, ACTION_ALLOWED_FROM.mapping);

      const dataset = await DatasetModel.findOne({
        _id: session.activeDatasetId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!dataset) {
        throw new AppError("NOT_FOUND", "Active dataset not found");
      }

      if (!["uploaded", "validated", "validation_failed"].includes(dataset.status)) {
        throw new AppError("INVALID_STATE", `Cannot map columns while dataset is ${dataset.status}`);
      }

      const cols = dataset.datasetSchema?.columns || [];
      if (!cols.includes(body.skuColumn) || !cols.includes(body.dateColumn) || !cols.includes(body.quantityColumn)) {
        throw new AppError("UNPROCESSABLE", "Mapped column not found in dataset columns");
      }

      dataset.mapping = body;
      dataset.status = "validating";
      await dataset.save();

      await transition(user.userId, params.sessionId, "validating");

      const requestId = res.locals.requestId || "req";
      const { job, deduplicated } = await enqueueJob({
        userId: user.userId,
        sessionId: params.sessionId,
        stage: "validation",
        hashInput: { datasetId: dataset._id.toString(), mapping: body },
        input: { datasetId: dataset._id.toString(), mapping: body },
        requestId,
      });

      const statusCode = deduplicated ? 200 : 202;
      return res.status(statusCode).json({
        data: { jobId: job._id.toString() },
        ...(deduplicated ? { meta: { deduplicated: true } } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions/:sessionId/dataset/validation
router.get(
  "/validation",
  validate({ params: IdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      if (!session.activeDatasetId) {
        throw new AppError("NOT_FOUND", "No active dataset for session");
      }

      const dataset = await DatasetModel.findOne({
        _id: session.activeDatasetId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!dataset) {
        throw new AppError("NOT_FOUND", "Dataset not found");
      }

      return res.status(200).json({
        data: {
          datasetId: dataset._id.toString(),
          status: dataset.status,
          columns: dataset.datasetSchema?.columns || [],
          preview: dataset.preview || [],
          mapping: dataset.mapping || null,
          validationSummary: dataset.validationSummary || null,
          rowCounts: dataset.rowCounts || {},
          error: dataset.error?.code ? dataset.error : null,
          transformationConfig: dataset.transformationConfig || null,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /sessions/:sessionId/dataset/confirm
router.post(
  "/confirm",
  validate({ params: IdParam, body: DatasetConfirmBody }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, body } = getValidated(res);
      const session = await getSessionOwned(user.userId, params.sessionId);

      requireStatus(session, ACTION_ALLOWED_FROM.confirmDataset);

      const dataset = await DatasetModel.findOne({
        _id: session.activeDatasetId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!dataset) {
        throw new AppError("NOT_FOUND", "Active dataset not found");
      }

      if (dataset.status !== "validated") {
        throw new AppError("INVALID_STATE", `Dataset must be in 'validated' status, got '${dataset.status}'`);
      }

      if ((dataset.validationSummary?.droppedNegativeRows || 0) > 0 && body.acknowledgeDroppedNegativeRows !== true) {
        throw new AppError("NEGATIVE_QUANTITY_POLICY_REQUIRED", "Acknowledge that negative-quantity rows will be excluded.");
      }

      dataset.status = "transforming";
      await dataset.save();

      const requestId = res.locals.requestId || "req";
      const { job, deduplicated } = await enqueueJob({
        userId: user.userId,
        sessionId: params.sessionId,
        stage: "transformation",
        hashInput: { datasetId: dataset._id.toString() },
        input: { datasetId: dataset._id.toString() },
        requestId,
      });

      const statusCode = deduplicated ? 200 : 202;
      return res.status(statusCode).json({
        data: { jobId: job._id.toString() },
        ...(deduplicated ? { meta: { deduplicated: true } } : {}),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
