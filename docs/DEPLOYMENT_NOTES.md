# Deployment and Security Notes

This document describes the deployment architecture, network boundaries, configuration parameters, and operational design of the StockPilot AI decision-support prototype.

## 1. Network Boundaries and Service Interfaces

The architecture consists of three local services and optional external managed dependencies:

```
+-----------------------------+
|      React 19 Client        |
|  (Vite dev server: 5173)    |
+--------------+--------------+
               | HTTP / REST (Firebase JWT Bearer Token)
               v
+-----------------------------+
|    Node.js Express Server   |
|         (Port 8000)         |
+-------+--------------+------+
        |              |
        | HTTP POST    | Qdrant REST API
        | X-Service-Key| (Port 6333)
        v              v
+---------------+ +-----------+
| Python Stats  | |  Qdrant   |
|  (Port 8001)  | |  Vector   |
+---------------+ +-----------+
```

### 1.1 Python Stats Service (`stats-service/`)

- Default port: `8001` (set via Uvicorn command `--port 8001`).
- Interface binding: In deployment, the stats service should bind to `127.0.0.1` or an internal virtual private network. It should not be exposed directly to the public internet.
- Authentication: Enforces a shared secret passed in the `X-Service-Key` HTTP header. The secret is validated via constant-time string comparison (`hmac.compare_digest`) in `stats-service/app/security.py`. Requests with missing or non-matching keys receive HTTP 401 `UNAUTHENTICATED`.
- Validation: Input bodies are parsed with Pydantic schemas configured with `extra="forbid"`. Malformed inputs return HTTP 422 `VALIDATION_ERROR`.

### 1.2 Node.js API Gateway (`server/`)

- Default port: `8000` (configurable via `PORT` environment variable).
- Entry point: `server/server.js` mounting routers from `server/src/app.js` at `/api/v1`.
- Authentication: Firebase Admin SDK validates incoming `Authorization: Bearer <token>` headers (`server/src/middlewares/auth.middleware.js`). The verified `uid` is set to `res.locals.user.userId`.
- Database: MongoDB via Mongoose (configured in `server/src/config/db.js`).

### 1.3 Qdrant Vector Engine (Optional)

- Default port: `6333` (HTTP) / `6334` (gRPC).
- Access: Node.js communicates via `@qdrant/js-client-rest`. If `QDRANT_API_KEY` is provided, requests include the `api-key` header.
- Payload filtering: Point searches strictly include `{ key: "user_id", match: { value: userId } }` and `{ key: "session_id", match: { value: sessionId } }` to maintain tenant isolation.

## 2. In-Process MongoDB-Backed Job Runner

Background tasks (validation, transformation, forecasting, optimization, simulation, portfolio) run asynchronously within the Node.js process (`server/src/services/jobRunner.js`):

- **Concurrency**: Controlled by an in-memory counting semaphore capped by `JOB_CONCURRENCY` (default: 2, range: 1 to 8, defined in `server/src/config/env.js`). Excess jobs queue in an in-memory FIFO list.
- **Deduplication**: When submitting a job, a SHA-256 hash is computed over `(stage, sessionId, hashInput)`. A MongoDB unique index on `{ sessionId, stage, inputHash, status }` prevents duplicate active runs.
- **Cancellation**: Running jobs register an `AbortController`. The endpoint `POST /api/v1/jobs/:jobId/cancel` sets `cancelRequested: true` in MongoDB and calls `abort()`, invoking the stage-specific `onCancelled` handler.
- **Crash recovery**: On server startup, `recoverInterruptedJobs()` queries `JobModel` for jobs with status `queued` or `running`. These are updated to `status: "failed"` with error code `SERVER_RESTART`, and their corresponding stage records are updated with `retryable: true`.
- **Lean Mongoose queries**: Handlers constructing microservice request payloads (`simulationHandlers.js`, `replayHandlers.js`, `portfolioHandlers.js`, `optimizationHandlers.js`) use `.lean()` or plain object conversion so Mongoose internal fields (`_doc`, `$__parent`, `$isNew`) are not passed to Zod boundary parsers.

## 3. Security and Multi-Tenancy

- **User scoping**: All MongoDB queries on user data filter by `userId` (and `sessionId` where applicable). Missing records return HTTP 404 `NOT_FOUND` rather than HTTP 403 to avoid revealing the existence of other users' data.
- **Credential hygiene**: `server/src/config/env.js` parses environment variables at boot. Secrets (`STATS_SERVICE_KEY`, `MONGODB_URI`, `LLM_API_KEY`, `EMBEDDING_API_KEY`, `QDRANT_API_KEY`) are not printed in logs. Error logging formats redact tokens and sensitive authorization headers.
- **Cross-Origin-Opener-Policy (COOP)**: In `server/server.js`, Helmet is configured with `crossOriginOpenerPolicy: false`, and `client/vite.config.js` omits COOP headers. This allows Google OAuth popups (`signInWithPopup` via Firebase Auth) to communicate with the opener window and execute `window.close()` without browser COOP policy violation blocks.

## 4. Rate Limiting

Rate limiting is enforced in `server/src/middlewares/rateLimit.js` using in-memory token buckets:

- General API requests (`RATE_LIMIT_GENERAL_PER_MINUTE`): default 300 requests/minute per IP/user.
- Dataset uploads (`RATE_LIMIT_UPLOADS_PER_HOUR`): default 10 uploads/hour per user.
- AI assistant prompts (`RATE_LIMIT_AI_PER_MINUTE`): default 20 requests/minute per user.

Exceeded limits return HTTP 429 `RATE_LIMITED` with standard `RateLimit-*` and `Retry-After` headers.

## 5. Startup Procedure

To start the prototype locally without connection errors:

1. Start Python Stats Service:
   ```bash
   cd stats-service
   .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
   ```
2. Start Node.js API Server:
   ```bash
   cd server
   npm run dev
   ```
3. Start React Frontend Client:
   ```bash
   cd client
   npm run dev
   ```
