import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("development"),
  PORT: z.coerce.number().default(8000),
  ALLOWED_ORIGIN: z.string().default("http://localhost:5173"),
  MONGO_URI: z.string(),
  UPSTASH_REDIS_REST_URL: z.string(),
  UPSTASH_REDIS_REST_TOKEN: z.string(),
});

const parsedENV = envSchema.safeParse(process.env);

if (!parsedENV.success) {
  console.error("Invalid environment variables:", parsedENV.error.format());
  process.exit(1);
}

export const ENV = parsedENV.data;
