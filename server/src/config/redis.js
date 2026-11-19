import { Redis } from "@upstash/redis";
import { getEnv } from "./env.js";

const env = getEnv();
const url = env.UPSTASH_REDIS_REST_URL;
const token = env.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error("UPSTASH_REDIS is not configured");
}

async function checkRedisConnection() {
  try {
    const response = await redis.ping();

    if (response !== "PONG") {
      throw new Error("Unexpected Redis ping response");
    }

    console.log("Redis connected successfully");
    return true;
  } catch (error) {
    console.error("[Redis Connection Error]", error.message);
    throw error;
  }
}

const redis = new Redis({
  url,
  token,
});

await checkRedisConnection();

export default redis;
