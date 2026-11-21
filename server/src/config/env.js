import { z } from "zod";

const intFromString = (def, min, max) =>
  z.coerce.number().int().min(min).max(max).default(def);

export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().default(8000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),
  CORS_ORIGINS: z.string().default("http://localhost:5173"), // comma-separated

  MONGODB_URI: z
    .string()
    .default(
      "mongodb://admin:happytoyou123@ac-w4gwhry-shard-00-00.tcjvyt1.mongodb.net:27017,ac-w4gwhry-shard-00-01.tcjvyt1.mongodb.net:27017,ac-w4gwhry-shard-00-02.tcjvyt1.mongodb.net:27017/stockpilot-ai?ssl=true&replicaSet=atlas-18h5hr-shard-0&authSource=admin&appName=Cluster0",
    ),

  UPSTASH_REDIS_REST_URL: z
    .string()
    .default("https://grateful-boar-131528.upstash.io"),
  UPSTASH_REDIS_REST_TOKEN: z
    .string()
    .default("gQAAAAAAAgHIAAIgcDE1YWIyNmM3M2U0ZTY0OTJiYWU4ZDI3ZTc5YjZkNGVlMQ"),

  STATS_SERVICE_URL: z.string().default("http://localhost:8001"),
  STATS_SERVICE_KEY: z
    .string()
    .default("change-me-to-a-long-random-string-min-16"),
  STATS_TIMEOUT_MS: intFromString(900_000, 1_000, 3_600_000),

  STORAGE_DIR: z.string().default("./storage"),
  UPLOAD_MAX_BYTES: intFromString(62_914_560, 1_024, 524_288_000),
  UPLOAD_MAX_ROWS: intFromString(600_000, 1_000, 5_000_000),

  JOB_CONCURRENCY: intFromString(2, 1, 8),

  QDRANT_URL: z.string().default("http://localhost:6333"),
  QDRANT_API_KEY: z.string().optional(),

  // AI is optional: if LLM_PROVIDER is unset, AI endpoints return SERVICE_UNAVAILABLE.
  LLM_PROVIDER: z.enum(["gemini", "groq", "openai", "anthropic"]).optional(),
  LLM_MODEL: z.string().optional(),
  LLM_API_KEY: z.string().optional(),
  LLM_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.1),
  LLM_MAX_OUTPUT_TOKENS: intFromString(2048, 256, 8192),

  EMBEDDING_PROVIDER: z.enum(["gemini", "groq", "openai"]).optional(),
  EMBEDDING_MODEL: z.string().optional(),
  EMBEDDING_API_KEY: z.string().optional(),
  EMBEDDING_DIM: z.coerce.number().optional(),

  RATE_LIMIT_UPLOADS_PER_HOUR: intFromString(10, 1, 1000),
  RATE_LIMIT_AI_PER_MINUTE: intFromString(20, 1, 600),
  RATE_LIMIT_GENERAL_PER_MINUTE: intFromString(300, 10, 10_000),
});

let cached = null;
export function getEnv() {
  if (cached) return cached;
  // Fall back to MONGO_URI if MONGODB_URI is not explicitly provided
  const envToParse = {
    ...process.env,
    MONGODB_URI: process.env.MONGODB_URI || process.env.MONGO_URI,
    UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
    UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  const parsed = EnvSchema.safeParse(envToParse);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".")}: ${i.message}`,
    );
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  cached = parsed.data;
  return cached;
}
