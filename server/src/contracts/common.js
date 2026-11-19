import { z } from "zod";

export const ObjectIdString = z.string().regex(/^[a-fA-F0-9]{24}$/, "Invalid id");

export const IsoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Invalid calendar date");

export const IsoDateTime = z.string().datetime();
export const SkuId = z.string().trim().min(1).max(64);
export const FiniteNumber = z.number().finite();
export const NonNegNumber = z.number().finite().nonnegative();
export const Seed = z.number().int().min(0).max(2_147_483_647);

export const PaginationQuery = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();

export const SESSION_STATUSES = [
  "created", "uploading", "validating", "dataset_ready", "forecasting", "forecast_ready",
  "assumptions_pending", "optimizing", "optimization_ready", "simulating", "completed",
  "validation_failed", "forecast_failed", "optimization_failed", "simulation_failed", "cancelled",
];
export const SessionStatus = z.enum(SESSION_STATUSES);

export const STAGE_NAMES = ["dataset", "forecast", "optimization", "simulation"];
export const StageName = z.enum(STAGE_NAMES);
export const StageStatus = z.enum(["not_started", "running", "succeeded", "failed", "cancelled"]);

export const JOB_STAGES = ["validation", "transformation", "forecast", "optimization", "simulation"];
export const JobStage = z.enum(JOB_STAGES);
export const JobStatus = z.enum(["queued", "running", "succeeded", "failed", "cancelled"]);

export const ERROR_CODES = [
  "VALIDATION_ERROR", "UNAUTHENTICATED", "NOT_FOUND", "CONFLICT", "INVALID_STATE",
  "FILE_TOO_LARGE", "UNSUPPORTED_MEDIA_TYPE", "UNPROCESSABLE", "RATE_LIMITED",
  "DATASET_VALIDATION_FAILED", "NEGATIVE_QUANTITY_POLICY_REQUIRED", "COVERAGE_ASSUMPTION_REQUIRED",
  "NO_ELIGIBLE_SKUS", "JOB_CANCELLED", "SERVER_RESTART",
  "UPSTREAM_STATS_ERROR", "UPSTREAM_LLM_ERROR", "UPSTREAM_VECTOR_ERROR", "AI_RESPONSE_INVALID",
  "AI_SESSION_NOT_ELIGIBLE", "SERVICE_UNAVAILABLE", "INTERNAL_ERROR",
];
export const ErrorCode = z.enum(ERROR_CODES);

export const HTTP_STATUS_BY_CODE = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_STATE: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  DATASET_VALIDATION_FAILED: 422,
  NEGATIVE_QUANTITY_POLICY_REQUIRED: 422,
  COVERAGE_ASSUMPTION_REQUIRED: 422,
  NO_ELIGIBLE_SKUS: 422,
  JOB_CANCELLED: 409,
  SERVER_RESTART: 503,
  UPSTREAM_STATS_ERROR: 502,
  UPSTREAM_LLM_ERROR: 502,
  UPSTREAM_VECTOR_ERROR: 502,
  AI_RESPONSE_INVALID: 502,
  AI_SESSION_NOT_ELIGIBLE: 409,
  SERVICE_UNAVAILABLE: 503,
  INTERNAL_ERROR: 500,
};

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
    requestId: z.string(),
  }),
});
