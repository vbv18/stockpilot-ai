import { Agent, fetch } from "undici";
import { getEnv } from "../config/env.js";
import { AppError } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// headersTimeout/bodyTimeout = 0: the Python call can legitimately run for minutes.
// Our own AbortController timeout (STATS_TIMEOUT_MS) is the only limit.
const dispatcher = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 10_000 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function statsPost(path, body, requestSchema, responseSchema, opts) {
  const env = getEnv();
  const payload = requestSchema.parse(body); // never send an unvalidated payload
  const maxAttempts = 2; // only connection-level failures and HTTP 503 are retried
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), opts.timeoutMs ?? env.STATS_TIMEOUT_MS);
    const onCallerAbort = () => controller.abort(new Error("cancelled"));
    if (opts.signal?.aborted) {
      clearTimeout(timer);
      throw new AppError("JOB_CANCELLED", "The job was cancelled.");
    }
    opts.signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      const res = await fetch(`${env.STATS_SERVICE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Service-Key": env.STATS_SERVICE_KEY, "X-Request-Id": opts.requestId },
        body: JSON.stringify(payload),
        signal: controller.signal,
        dispatcher,
      });
      const text = await res.text();
      if (res.status === 503 && attempt < maxAttempts) {
        await sleep(1000);
        continue;
      }
      if (!res.ok) {
        logger.error({ requestId: opts.requestId, path, status: res.status, body: text.slice(0, 500) }, "stats service error");
        throw new AppError("UPSTREAM_STATS_ERROR", "The statistical service could not complete this request.", { retryable: res.status >= 500 });
      }
      let json;
      try {
        json = JSON.parse(text);
      } catch {
        throw new AppError("UPSTREAM_STATS_ERROR", "The statistical service returned an unreadable response.");
      }
      const parsed = responseSchema.safeParse(json);
      if (!parsed.success) {
        logger.error({ requestId: opts.requestId, path, issues: parsed.error.issues.slice(0, 5) }, "stats response failed validation");
        throw new AppError("UPSTREAM_STATS_ERROR", "The statistical service returned an unexpected response.");
      }
      return parsed.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (opts.signal?.aborted) throw new AppError("JOB_CANCELLED", "The job was cancelled.");
      if (controller.signal.aborted) throw new AppError("UPSTREAM_STATS_ERROR", "The statistical service timed out.", { retryable: true });
      lastErr = err;
      logger.warn({ requestId: opts.requestId, path, attempt }, "stats service connection failure");
      if (attempt < maxAttempts) {
        await sleep(1000);
        continue;
      }
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onCallerAbort);
    }
  }
  throw new AppError("UPSTREAM_STATS_ERROR", "The statistical service is unreachable.", { retryable: true, cause: lastErr });
}
