import pino from "pino";
import { getEnv } from "../config/env.js";

let logInstance = null;

export function getLogger() {
  if (logInstance) return logInstance;
  const env = getEnv();
  logInstance = pino({
    level: env.LOG_LEVEL,
    redact: {
      paths: [
        "req.headers.authorization",
        "headers.authorization",
        "*.token",
        "*.apiKey",
        "*.password",
        "*.idToken",
        "*.api_key",
      ],
      censor: "[REDACTED]",
    },
  });
  return logInstance;
}

export const logger = new Proxy({}, {
  get(target, prop) {
    return getLogger()[prop];
  },
});
