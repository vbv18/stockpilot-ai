import { logger } from "../../lib/logger.js";

/** Replaced in P17. Must never throw and never block the caller. */
export function scheduleReindex(userId, sessionId, reason) {
  logger.debug({ sessionId, reason }, "reindex requested (vector layer not installed yet)");
}
