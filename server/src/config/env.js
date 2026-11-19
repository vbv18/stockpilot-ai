import { z } from "zod";

const intFromString = (def, min, max) =>
  z.coerce.number().int().min(min).max(max).default(def);

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production"]).default("development"),
    PORT: intFromString(8000, 1, 65535),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
    CORS_ORIGINS: z.string().default("http://localhost:5173"), // comma-separated

    MONGODB_URI: z.string().min(1).default(process.env.MONGO_URI || ""),
    MONGODB_DB_NAME: z.string().min(1).optional(),

    STATS_SERVICE_URL: z.string().url().default("http://localhost:8000"),
    STATS_SERVICE_KEY: z.string().min(16),
    STATS_TIMEOUT_MS: intFromString(900_000, 1_000, 3_600_000),

    STORAGE_DIR: z.string().min(1).default("./storage"),
    UPLOAD_MAX_BYTES: intFromString(62_914_560, 1_024, 524_288_000),
    UPLOAD_MAX_ROWS: intFromString(600_000, 1_000, 5_000_000),

    JOB_CONCURRENCY: intFromString(2, 1, 8),

    QDRANT_URL: z.string().url().default("http://localhost:6333"),
    QDRANT_API_KEY: z.string().optional(),
    QDRANT_COLLECTION: z.string().min(1).default("stockpilot_session_artifacts"),

    // AI is optional: if LLM_PROVIDER is unset, AI endpoints return SERVICE_UNAVAILABLE.
    LLM_PROVIDER: z.enum(["gemini", "openai", "anthropic"]).optional(),
    LLM_MODEL: z.string().min(1).optional(),
    LLM_API_KEY: z.string().min(1).optional(),
    LLM_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.1),
    LLM_MAX_OUTPUT_TOKENS: intFromString(2048, 256, 8192),

    EMBEDDING_PROVIDER: z.enum(["gemini", "openai"]).optional(),
    EMBEDDING_MODEL: z.string().min(1).optional(),
    EMBEDDING_API_KEY: z.string().min(1).optional(),
    EMBEDDING_DIM: z.coerce.number().int().min(8).max(4096).optional(),

    RATE_LIMIT_UPLOADS_PER_HOUR: intFromString(10, 1, 1000),
    RATE_LIMIT_AI_PER_MINUTE: intFromString(20, 1, 600),
    RATE_LIMIT_GENERAL_PER_MINUTE: intFromString(300, 10, 10_000),
  })
  .superRefine((v, ctx) => {
    if (v.LLM_PROVIDER && (!v.LLM_MODEL || !v.LLM_API_KEY)) {
      ctx.addIssue({ code: "custom", message: "LLM_MODEL and LLM_API_KEY are required when LLM_PROVIDER is set", path: ["LLM_PROVIDER"] });
    }
    if (v.EMBEDDING_PROVIDER && (!v.EMBEDDING_MODEL || !v.EMBEDDING_API_KEY || !v.EMBEDDING_DIM)) {
      ctx.addIssue({ code: "custom", message: "EMBEDDING_MODEL, EMBEDDING_API_KEY and EMBEDDING_DIM are required when EMBEDDING_PROVIDER is set", path: ["EMBEDDING_PROVIDER"] });
    }
  });

let cached = null;
export function getEnv() {
  if (cached) return cached;
  // Fall back to MONGO_URI if MONGODB_URI is not explicitly provided
  const envToParse = {
    ...process.env,
    MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI,
  };
  const parsed = EnvSchema.safeParse(envToParse);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
