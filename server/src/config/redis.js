import { Redis } from "@upstash/redis";
import { ENV } from "./config.js";

const url = ENV.UPSTASH_REDIS_REST_URL;
const token = ENV.UPSTASH_REDIS_REST_TOKEN;

if (!url || !token) {
  throw new Error("REDIS_URL is not configured");
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
