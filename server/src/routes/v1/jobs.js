import { Router } from "express";
import { z } from "zod";
import { getUser } from "../../auth/currentUser.js";
import { IdParam } from "../../contracts/pipeline.js";
import { JobStage } from "../../contracts/common.js";
import { validate, getValidated } from "../../middlewares/validate.js";
import { cancelJob } from "../../services/jobRunner.js";
import { JobModel } from "../../models/job.model.js";
import { AppError } from "../../lib/errors.js";

const router = Router({ mergeParams: true });

function toJobDto(d) {
  const doc = d.toObject ? d.toObject() : d;
  return {
    id: doc._id.toString(),
    stage: doc.stage,
    status: doc.status,
    progress: {
      pct: doc.progress?.pct ?? 0,
      message: doc.progress?.message ?? "",
    },
    errorCode: doc.errorCode ?? null,
    userMessage: doc.userMessage ?? null,
    retryable: doc.retryable ?? false,
    resultRef: doc.resultRef
      ? {
          collection: doc.resultRef.collection,
          id: doc.resultRef.id ? doc.resultRef.id.toString() : null,
        }
      : null,
    createdAt: doc.createdAt ? doc.createdAt.toISOString() : null,
    startedAt: doc.startedAt ? doc.startedAt.toISOString() : null,
    finishedAt: doc.finishedAt ? doc.finishedAt.toISOString() : null,
  };
}

const JobQuery = z
  .object({
    stage: JobStage.optional(),
  })
  .strict();

const JobIdParam = IdParam.extend({
  jobId: z.string().regex(/^[a-fA-F0-9]{24}$/),
}).strict();

// GET /sessions/:sessionId/jobs
router.get(
  "/",
  validate({ params: IdParam, query: JobQuery }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params, query } = getValidated(res);
      const filter = {
        userId: user.userId,
        sessionId: params.sessionId,
      };
      if (query.stage) {
        filter.stage = query.stage;
      }
      const jobs = await JobModel.find(filter)
        .sort({ createdAt: -1 })
        .limit(20);

      return res.status(200).json({ data: jobs.map(toJobDto) });
    } catch (err) {
      next(err);
    }
  },
);

// GET /sessions/:sessionId/jobs/:jobId
router.get(
  "/:jobId",
  validate({ params: JobIdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const job = await JobModel.findOne({
        _id: params.jobId,
        userId: user.userId,
        sessionId: params.sessionId,
      });
      if (!job) {
        throw new AppError("NOT_FOUND", "Job not found");
      }
      return res.status(200).json({ data: toJobDto(job) });
    } catch (err) {
      next(err);
    }
  },
);

// POST /sessions/:sessionId/jobs/:jobId/cancel
router.post(
  "/:jobId/cancel",
  validate({ params: JobIdParam }),
  async (req, res, next) => {
    try {
      const user = getUser(res);
      const { params } = getValidated(res);
      const job = await cancelJob(user.userId, params.sessionId, params.jobId);
      return res.status(200).json({ data: toJobDto(job) });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
