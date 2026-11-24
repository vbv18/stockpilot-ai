# Data Handling and Privacy Policy

## 1. Scope and Multi-Tenant Isolation

StockPilot AI operates as a multi-tenant decision-support prototype. User identification is established through Firebase Authentication JSON Web Tokens (JWTs).

- The authenticated user identifier (`userId`) is extracted from the verified Firebase token on the server (`res.locals.user.userId`). Client-supplied user identifiers are never accepted.
- Every database query across MongoDB collections scopes document access by `{ userId }` (and `{ sessionId }` when querying session sub-resources).
- If a resource request does not match the authenticated `userId`, the API returns HTTP 404 `NOT_FOUND` to avoid revealing the existence of other users' records.
- Vector embeddings in Qdrant store payload metadata `{ user_id, session_id }`, and retrieval queries apply mandatory payload filtering on both fields.
- Raw CSV demand rows are never passed into LLM prompt contexts. Only aggregated session summaries and deterministic tool outputs are included in assistant contexts.

## 2. Permanent Session Deletion Cascade

Session deletion is user-initiated via `DELETE /api/v1/sessions/:sessionId`. Deletion is permanent and immediate; there is no soft-deletion recycle bin or delayed expiration purge.

The deletion sequence executes in the following order (`server/src/routes/v1/sessions.js`):

1. **Ownership verification**: The session is retrieved with `getSessionOwned(userId, sessionId)`. If the session does not exist or does not belong to the user, the server responds with HTTP 404 `NOT_FOUND`.
2. **Active job check**: The system queries `JobModel.findOne({ sessionId, status: { $in: ["queued", "running"] } })`. If any job is currently queued or running, deletion aborts with HTTP 409 `CONFLICT` and message `"Cancel running jobs before deleting this session."`.
3. **Vector store deletion**: If an embedding provider is configured, `deleteQdrantSession(userId, sessionId)` removes all vector points matching `{ user_id, session_id }` from the Qdrant collection. If this operation throws an error, deletion halts with HTTP 502 `UPSTREAM_VECTOR_ERROR` before modifying local files or database records.
4. **Local storage cleanup**: The file storage driver deletes all disk artifacts under the directory prefix `datasets/${userId}/${sessionId}` via `storage.deletePrefix(...)` (removing `original.csv`, `aggregated.json`, and `processed.csv`).
5. **Database collection cascade**: MongoDB records are deleted across 10 collections:
   - `AiMessageModel.deleteMany({ userId, sessionId })`
   - `AiConversationModel.deleteMany({ userId, sessionId })`
   - `WhatIfRunModel.deleteMany({ userId, sessionId })`
   - `JobModel.deleteMany({ userId, sessionId })`
   - `SimulationRunModel.deleteMany({ userId, sessionId })`
   - `OptimizationRunModel.deleteMany({ userId, sessionId })`
   - `AssumptionSetModel.deleteMany({ userId, sessionId })`
   - `ForecastRunModel.deleteMany({ userId, sessionId })`
   - `DatasetModel.deleteMany({ userId, sessionId })`
   - `AnalysisSessionModel.deleteOne({ _id: sessionId, userId })`
6. **Audit log**: A single structured JSON log event is emitted containing `{ event: "session_deleted", userId, sessionId, requestId }`.
7. **Response**: Returns HTTP 200 `{ "data": { "deleted": true } }`.

## 3. External Dependencies and Provider Logs

Server host backups, database disaster-recovery snapshots, and external AI provider request logs (such as Google Gemini, OpenAI, Anthropic, or Groq) are governed by the respective provider retention terms and fall outside the application's direct deletion cascade.
