# Production Deployment & Security Notes

This document outlines deployment architectures, interface binding, network boundaries, and operational considerations for StockPilot AI.

---

## 1. Interface Binding & Network Boundaries

### 1.1 Python Stats Service (`stats-service/`)
- **Default Port**: `8000`
- **Security Requirement**: The Python statistical engine processes numerical simulations and statistical forecasts. It relies on the shared secret `STATS_SERVICE_KEY` passed in the `X-Service-Key` header.
- **Private Interface Binding**: The stats service MUST NEVER be bound to public interfaces (`0.0.0.0`) in production.
  - In local or containerized setups: bind to `127.0.0.1` (`--host 127.0.0.1`).
  - In cloud/cluster deployments (e.g., Kubernetes, AWS ECS, GCP Cloud Run): run within an isolated VPC, private subnet, or internal service mesh accessible only by the Node.js API server.

### 1.2 Qdrant Vector Store
- **Security Requirement**: Qdrant stores vectorized semantic summaries of sessions, datasets, forecasts, policies, and simulations.
- **Access Boundary**:
  - Restrict access strictly to the Node.js backend using Qdrant API keys (`QDRANT_API_KEY`) and firewall rules.
  - Bind Qdrant internal ports (`6333` HTTP, `6334` gRPC) to a private internal network or localhost.
  - Never expose Qdrant to public internet traffic directly.

### 1.3 MongoDB Database
- **Security Requirement**: MongoDB holds multi-tenant operational data, metadata, and user assets.
- **Access Boundary**:
  - Configure MongoDB authentication (`SCRAM-SHA-256` or x.509 certificates).
  - Whitelist only the IP addresses or VPC CIDR blocks of Node.js backend nodes.
  - Enable TLS encryption in transit (`tls=true` in MongoDB connection URI).

### 1.4 Redis Cache & Job Queues
- **Security Requirement**: Redis coordinates job locks, distributed idempotency keys, and BullMQ task queues.
- **Access Boundary**:
  - Require strong authentication (`requirepass` or Upstash Redis token).
  - Use TLS connections (`rediss://`) when connecting over external networks.

---

## 2. Authentication & Multi-Tenancy Boundary

- **Identity Verification**: Authentication is mediated by Firebase Authentication JWTs. The Node.js server extracts and validates the Bearer token via Firebase Admin SDK.
- **Tenant Isolation**:
  - The client-provided `userId` is never trusted. The validated token's `uid` is attached to `res.locals.user.userId`.
  - Every MongoDB collection query filtering user data MUST filter by `{ userId }` (and `{ sessionId }` where appropriate).
  - When a requested resource does not match `{ userId }`, the API responds strictly with HTTP 404 (`NOT_FOUND`), preventing existence probing or cross-tenant leaks.
  - Vector similarity searches in Qdrant apply mandatory payload filters on `user_id` and `session_id` before computing semantic distance.

---

## 3. Data Sanitization & Logging Hygiene

- **Sensitive Field Redaction**: `server/src/lib/logger.js` automatically strips authentication tokens, Authorization headers, and sensitive environment keys (`STATS_SERVICE_KEY`, `LLM_API_KEY`, `EMBEDDING_API_KEY`, `QDRANT_API_KEY`).
- **No Data Leakage**: Raw CSV/Excel data rows are never logged. Error responses return sanitized error codes and human-readable messages without leaking stack traces or internal database errors in production.

---

## 4. Rate Limiting & Denial of Service Protection

- **Layered Rate Limits**:
  - Authenticated General API: 120 requests/minute.
  - Dataset Uploads: 10 uploads/hour per user.
  - AI Assistant & Vector Operations: 20 requests/minute per user.
- **Standard Headers**: Emits standard IETF Draft-7 `RateLimit-*` headers and returns HTTP 429 with standard error envelope.

---

## 5. Session Deletion & Cascade Policy

- As detailed in `docs/DATA_HANDLING.md`, session deletions are permanent and cascade across Qdrant vectors, disk storage, and 10 MongoDB collections in a deterministic order.
