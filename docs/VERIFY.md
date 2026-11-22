# StockPilot AI Verification & Manual Acceptance Checklist

This checklist defines the manual acceptance and operational verification procedures for StockPilot AI across all 10 core capability areas defined in the PRD.

---

## 1. Authentication & Tenant Isolation

- [ ] **Sign-in Flow**: Authenticate via Firebase Google Sign-In or email/password.
- [ ] **Token Propagation**: Verify that `Authorization: Bearer <token>` is attached to all outbound client API requests.
- [ ] **Ownership Miss (404)**: Attempt to fetch another user's session ID (`GET /api/v1/sessions/:id`). Server returns HTTP 404 (`NOT_FOUND`), not 403, and never reveals resource existence.
- [ ] **Token Expiration / Invalid Token**: Verify that requests with corrupted or expired bearer tokens return HTTP 401 (`UNAUTHORIZED`).

---

## 2. Session Management & Permanent Deletion

- [ ] **Create Session**: Create a new session with name and description; verify state begins in `created`.
- [ ] **Update Session**: Rename session or toggle `archived: true`; verify state and list filtering.
- [ ] **Permanent Deletion (P21)**:
  - Run `DELETE /api/v1/sessions/:sessionId` on a session with datasets, forecasts, policies, and AI chats.
  - Verify confirmation modal in UI requires typing the exact session name.
  - Verify Qdrant points for `{ userId, sessionId }` are deleted.
  - Verify local storage files in `storage/datasets/<userId>/<sessionId>` are deleted.
  - Verify MongoDB records across all 10 collections are removed.
  - Verify running job check: Attempt deletion while a job is running returns HTTP 409 (`CONFLICT`).

---

## 3. Data Ingestion & Time Series Processing

- [ ] **File Ingestion**: Upload a CSV or Excel dataset containing `date`, `sku`, and `quantity` fields.
- [ ] **Validation & Cleaning**:
  - Verify automatic column mapping or schema prompt.
  - Verify daily demand aggregation and zero-filling for unobserved dates.
  - Confirm duplicate transaction handling.
- [ ] **Summary Metrics**: Verify total records, date range, SKU count, and intermittent demand classifications (smooth, erratic, intermittent, lumpy) are accurately reported.

---

## 4. Multi-Model Statistical Forecasting

- [ ] **Model Generation**: Trigger forecast job with 30-day horizon.
- [ ] **Evaluation & Selection**: Confirm Python stats service runs backtesting across candidate models (ETS, Croston/SBA, Seasonal Naive).
- [ ] **Metrics Inspection**: Verify WAPE, RMSE, and MAE are computed per model, and the winning model is selected per SKU.
- [ ] **Confidence Intervals & Residuals**: Confirm 80% and 95% prediction intervals and residual blocks are returned and visualized.

---

## 5. Inventory Policy Optimization

- [ ] **Operational Assumptions**: Configure unit cost, holding cost rate (annual %), order placement cost, lead time, and target cycle service level.
- [ ] **Policy Calculation**: Run optimization; verify calculated EOQ ($Q^*$), Safety Stock ($SS$), and Reorder Point ($s$) match theoretical values.
- [ ] **Constraints & Packaging**: Check adjustments for minimum order quantities (MOQ) and batch pack sizes.

---

## 6. Monte Carlo Lead-Time Simulation

- [ ] **Stochastic Simulation**: Run 1,000 replications over 90-day horizon using model residual bootstrapping.
- [ ] **Performance Distribution**: Verify empirical fill rate, cycle service level, stockout frequency, and inventory holding/shortage cost distributions.
- [ ] **Visual Validation**: Confirm inventory level trajectories and distribution histograms render cleanly in UI.

---

## 7. What-If Scenario Analysis

- [ ] **Interactive Adjustments**: Adjust lead time ($\pm 5$ days), order cost, or target service level in What-If panel.
- [ ] **Instant Delta Calculation**: Verify instant re-evaluation of required safety stock, reorder point, and total expected annual inventory cost.

---

## 8. AI Inventory Assistant (Ask AI) & Semantic Retrieval

- [ ] **Vector Indexing**: Verify session artifacts (dataset summary, forecast accuracy, inventory policy, simulation risks) are indexed in Qdrant with `user_id` and `session_id` payload metadata.
- [ ] **Grounded Retrieval**:
  - Ask: _"Which SKUs have the highest stockout risk and why?"_
  - Verify the LangGraph agent retrieves relevant policy documents and cites specific SKU metrics.
- [ ] **Tool Calling**:
  - Ask: _"What is the recommended reorder point and EOQ for SKU X?"_
  - Confirm the agent calls `get_inventory_policy` or `get_forecast_metrics` to retrieve exact figures.
- [ ] **Degradation Handling**:
  - Verify UI shows graceful banner when LLM or Qdrant is unconfigured.
  - Confirm core statistical and optimization calculations function completely independently of AI availability.

---

## 9. Rate Limiting & Denial of Service Protection

- [ ] **General API Limiter**: Exceed 120 requests/minute on authenticated endpoints; verify HTTP 429 response with `RATE_LIMITED` code and standard `RateLimit-*` headers.
- [ ] **Upload Limiter**: Exceed 10 uploads/hour; verify upload-specific rate limit triggers.
- [ ] **AI Assistant Limiter**: Exceed 20 AI prompts/minute; verify AI endpoint rate limits cleanly.

---

## 10. Security Sweep & Observability

- [ ] **Credential Redaction**: Check server logs to ensure `Authorization`, `STATS_SERVICE_KEY`, `LLM_API_KEY`, `EMBEDDING_API_KEY`, and `QDRANT_API_KEY` are redacted (`[REDACTED]`).
- [ ] **No Raw Data Leaks**: Confirm customer CSV data rows are not dumped into application logs.
- [ ] **Path Traversal Protection**: Attempt uploading files with path navigation characters (`../`); confirm sanitized storage paths.
