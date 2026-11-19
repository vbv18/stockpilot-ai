import crypto from "node:crypto";
import { logger } from "../lib/logger.js";

const REQUEST_ID_REGEX = /^[A-Za-z0-9._-]{8,64}$/;

export function requestContext(req, res, next) {
  const incomingId = req.headers["x-request-id"];
  const requestId =
    typeof incomingId === "string" && REQUEST_ID_REGEX.test(incomingId)
      ? incomingId
      : crypto.randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const childLogger = logger.child({ requestId });
  res.locals.log = childLogger;

  const startTime = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - startTime;
    const pathOnly = req.originalUrl ? req.originalUrl.split("?")[0] : req.path;
    const userId = res.locals.user?.userId || req.user?._id || req.user?.id || undefined;

    childLogger.info({
      method: req.method,
      path: pathOnly,
      status: res.statusCode,
      durationMs,
      ...(userId ? { userId: String(userId) } : {}),
    }, `${req.method} ${pathOnly} ${res.statusCode} ${durationMs}ms`);
  });

  next();
}
