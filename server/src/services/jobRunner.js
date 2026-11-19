import crypto from "node:crypto";
import { getEnv } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";
import { JobModel } from "../models/job.model.js";

const handlers = new Map();
const runningControllers = new Map();

// Semaphore for concurrency control
let activeJobCount = 0;
const waitingQueue = [];

function canonicalJson(obj) {
  if (obj === null || typeof obj !== "object") {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function registerJobHandler(stage, spec) {
  handlers.set(stage, spec);
}

function acquireLock() {
  const env = getEnv();
  const maxConcurrency = env.JOB_CONCURRENCY || 2;
  if (activeJobCount < maxConcurrency) {
    activeJobCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingQueue.push(resolve));
}

function releaseLock() {
  const env = getEnv();
  const maxConcurrency = env.JOB_CONCURRENCY || 2;
  if (waitingQueue.length > 0 && activeJobCount <= maxConcurrency) {
    const nextResolve = waitingQueue.shift();
    nextResolve();
  } else {
    activeJobCount = Math.max(0, activeJobCount - 1);
  }
}

async function executeJob(jobId) {
  await acquireLock();
  const controller = new AbortController();
  runningControllers.set(jobId, controller);

  let jobDoc;
  try {
    jobDoc = await JobModel.findById(jobId);
    if (!jobDoc || jobDoc.status !== "queued") {
      runningControllers.delete(jobId);
      releaseLock();
      return;
    }

    if (jobDoc.cancelRequested) {
      jobDoc.status = "cancelled";
      jobDoc.finishedAt = new Date();
      await jobDoc.save();
      runningControllers.delete(jobId);
      releaseLock();
      const spec = handlers.get(jobDoc.stage);
      if (spec?.onCancelled) {
        await spec.onCancelled(createContext(jobDoc, controller)).catch((err) => {
          logger.error({ err, jobId }, "Error in job onCancelled handler");
        });
      }
      return;
    }

    jobDoc.status = "running";
    jobDoc.startedAt = new Date();
    await jobDoc.save();

    const spec = handlers.get(jobDoc.stage);
    if (!spec) {
      throw new AppError("INTERNAL_ERROR", `No handler registered for stage ${jobDoc.stage}`);
    }

    const ctx = createContext(jobDoc, controller);
    logger.info({ requestId: jobDoc.requestId, jobId, sessionId: jobDoc.sessionId.toString(), stage: jobDoc.stage }, "Job started");

    const outcome = await spec.run(ctx);

    jobDoc.status = "succeeded";
    jobDoc.finishedAt = new Date();
    jobDoc.progress = { pct: 100, message: "Done" };
    if (outcome?.resultRef) {
      jobDoc.resultRef = outcome.resultRef;
    }
    await jobDoc.save();
    logger.info({ requestId: jobDoc.requestId, jobId, sessionId: jobDoc.sessionId.toString(), stage: jobDoc.stage }, "Job succeeded");
  } catch (err) {
    const isCancelled =
      err instanceof AppError && err.code === "JOB_CANCELLED" || controller.signal.aborted;

    if (isCancelled) {
      if (jobDoc) {
        jobDoc.status = "cancelled";
        jobDoc.finishedAt = new Date();
        await jobDoc.save();
        const spec = handlers.get(jobDoc.stage);
        if (spec?.onCancelled) {
          await spec.onCancelled(createContext(jobDoc, controller)).catch((e) => {
            logger.error({ err: e, jobId }, "Error in job onCancelled handler");
          });
        }
      }
      logger.info({ requestId: jobDoc?.requestId, jobId, sessionId: jobDoc?.sessionId?.toString() }, "Job cancelled");
    } else {
      const code = err instanceof AppError ? err.code : "INTERNAL_ERROR";
      const userMessage =
        err instanceof AppError
          ? err.message
          : "Something went wrong while processing. Please try again.";
      const retryable = err instanceof AppError ? err.retryable : false;

      if (jobDoc) {
        jobDoc.status = "failed";
        jobDoc.errorCode = code;
        jobDoc.userMessage = userMessage;
        jobDoc.retryable = retryable;
        jobDoc.finishedAt = new Date();
        await jobDoc.save();

        const spec = handlers.get(jobDoc.stage);
        if (spec?.onFailed) {
          await spec.onFailed(createContext(jobDoc, controller), { code, userMessage, retryable }).catch((e) => {
            logger.error({ err: e, jobId }, "Error in job onFailed handler");
          });
        }
      }
      logger.error({ err, requestId: jobDoc?.requestId, jobId, sessionId: jobDoc?.sessionId?.toString() }, "Job failed");
    }
  } finally {
    runningControllers.delete(jobId);
    releaseLock();
  }
}

function createContext(jobDoc, controller) {
  const jobId = jobDoc._id.toString();
  return {
    jobId,
    userId: jobDoc.userId.toString(),
    sessionId: jobDoc.sessionId.toString(),
    requestId: jobDoc.requestId,
    signal: controller.signal,
    input: jobDoc.input,
    async setProgress(pct, message) {
      const fresh = await JobModel.findById(jobId).select("cancelRequested");
      if (fresh?.cancelRequested) {
        controller.abort(new Error("cancelled"));
        throw new AppError("JOB_CANCELLED", "The job was cancelled.");
      }
      await JobModel.updateOne(
        { _id: jobId },
        { $set: { "progress.pct": Math.round(pct), "progress.message": message } },
      );
    },
    throwIfCancelled() {
      if (controller.signal.aborted) {
        throw new AppError("JOB_CANCELLED", "The job was cancelled.");
      }
    },
  };
}

export async function enqueueJob({ userId, sessionId, stage, hashInput, input, requestId }) {
  const canonical = canonicalJson({ stage, sessionId: sessionId.toString(), hashInput });
  const inputHash = crypto.createHash("sha256").update(canonical).digest("hex");

  try {
    const job = await JobModel.create({
      userId,
      sessionId,
      stage,
      status: "queued",
      inputHash,
      input,
      requestId,
      progress: { pct: 0, message: "Queued" },
    });

    const jobId = job._id.toString();
    setImmediate(() => {
      executeJob(jobId).catch((err) => {
        logger.error({ err, jobId }, "Unhandled error in executeJob loop");
      });
    });

    return { job: job.toObject(), deduplicated: false };
  } catch (err) {
    if (err.code === 11000) {
      const existing = await JobModel.findOne({
        sessionId,
        stage,
        inputHash,
        status: { $in: ["queued", "running"] },
      }).lean();
      if (existing) {
        return { job: existing, deduplicated: true };
      }
    }
    throw err;
  }
}

export async function cancelJob(userId, sessionId, jobId) {
  const job = await JobModel.findOne({ _id: jobId, userId, sessionId });
  if (!job) {
    throw new AppError("NOT_FOUND", "Job not found");
  }

  if (["succeeded", "failed", "cancelled"].includes(job.status)) {
    throw new AppError("INVALID_STATE", "This job has already finished.");
  }

  if (job.status === "queued") {
    job.status = "cancelled";
    job.finishedAt = new Date();
    await job.save();

    const controller = new AbortController();
    const spec = handlers.get(job.stage);
    if (spec?.onCancelled) {
      await spec.onCancelled(createContext(job, controller)).catch((err) => {
        logger.error({ err, jobId }, "Error in job onCancelled handler");
      });
    }
    return job.toObject();
  }

  if (job.status === "running") {
    job.cancelRequested = true;
    await job.save();

    const controller = runningControllers.get(jobId);
    if (controller) {
      controller.abort(new Error("cancelled"));
    }
    return job.toObject();
  }

  return job.toObject();
}

export async function recoverInterruptedJobs() {
  const interrupted = await JobModel.find({
    status: { $in: ["queued", "running"] },
  });

  for (const job of interrupted) {
    job.status = "failed";
    job.errorCode = "SERVER_RESTART";
    job.userMessage = "The server restarted while this job was running. Please retry.";
    job.retryable = true;
    job.finishedAt = new Date();
    await job.save();

    const spec = handlers.get(job.stage);
    if (spec?.onFailed) {
      const controller = new AbortController();
      const ctx = createContext(job, controller);
      await spec
        .onFailed(ctx, {
          code: "SERVER_RESTART",
          userMessage: job.userMessage,
          retryable: true,
        })
        .catch((err) => {
          logger.error({ err, jobId: job._id.toString() }, "Error recovering interrupted job");
        });
    }
  }
}
