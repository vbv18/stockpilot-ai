import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { getEnv } from "../config/env.js";

function keyGenerator(req, res) {
  if (res.locals?.user?.userId) {
    return res.locals.user.userId;
  }
  return ipKeyGenerator(req);
}

function rateLimitHandler(req, res) {
  const requestId =
    res.locals.requestId || req.headers["x-request-id"] || "unknown";
  return res.status(429).json({
    error: {
      code: "RATE_LIMITED",
      message: "Too many requests. Please wait a moment and try again.",
      requestId,
    },
  });
}

/**
 * General rate limiter for whole authenticated router
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: () => getEnv().RATE_LIMIT_GENERAL_PER_MINUTE,
  keyGenerator,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/**
 * Upload limiter for dataset uploads (per hour)
 */
export const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: () => getEnv().RATE_LIMIT_UPLOADS_PER_HOUR,
  keyGenerator,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: rateLimitHandler,
});

/**
 * AI limiter for conversation and message endpoints (per minute)
 */
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: () => getEnv().RATE_LIMIT_AI_PER_MINUTE,
  keyGenerator,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: rateLimitHandler,
});
