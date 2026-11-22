# StockPilot AI --- Product Requirements Document (PRD)

**Document status:** Product baseline / implementation specification\
**Version:** 1.0\
**Date:** 18 November 2026\
**Product:** StockPilot AI\
**Document owner:** Product & Engineering\
**Target:** Student research prototype with industry-grade architecture
and demonstrable end-to-end workflow

---

## 1. Executive summary

StockPilot AI is an uncertainty-aware, cost-driven, multi-SKU inventory
decision intelligence system. It converts historical sales transactions
into demand forecasts, inventory replenishment recommendations, policy
comparisons, Monte Carlo simulation results, and explainable decision
support.

The product combines: - Statistical forecasting using AutoETS and
Seasonal Naive. - Residual block bootstrap prediction intervals. -
Deterministic and uncertainty-aware inventory policies. - Monte Carlo
policy simulation. - An agentic Explainable AI (XAI) analyst that
answers questions and coordinates controlled analytical tools. -
Session-scoped persistence and retrieval.

The system is designed so that numerical decisions remain deterministic,
reproducible, and testable. The LLM does not calculate authoritative
inventory metrics or override the statistical engine. It interprets
structured evidence, requests permitted analyses, and explains results.

## 2. Product vision

**Vision:** Make inventory decisions more transparent and
evidence-driven by connecting demand uncertainty to replenishment
policies and making the resulting trade-offs understandable to users.

**Product promise:** Upload sales history, understand future demand,
configure operating assumptions, compare inventory policies, simulate
their consequences, and ask an AI analyst why the system recommends a
particular action.

## 3. Problem statement

Many small inventory workflows separate demand forecasting from
replenishment decisions. A forecast may show expected demand, but it
does not by itself explain: - How much to order. - When to reorder. -
How uncertainty changes the reorder point. - What service-level and cost
trade-offs follow from a policy. - Why two policies produce different
outcomes.

StockPilot AI addresses this gap by connecting forecasting, uncertainty
estimation, inventory optimization, simulation, and explanation in one
workflow.

## 4. Goals and non-goals

### 4.1 Goals

1.  Accept a user-uploaded CSV containing SKU-level daily demand
    history.
2.  Validate, clean, and transform the data into a consistent daily time
    series.
3.  Forecast demand for each eligible SKU using AutoETS and Seasonal
    Naive.
4.  Estimate empirical prediction intervals using residual block
    bootstrap.
5.  Collect common inventory cost and lead-time assumptions from the
    user.
6.  Calculate EOQ and deterministic and uncertainty-aware reorder
    points.
7.  Compare inventory policies using common Monte Carlo demand
    scenarios.
8.  Persist all session artifacts and make them retrievable.
9.  Provide a session-aware AI analyst for natural-language analysis and
    explanations.
10. Provide reproducible outputs, clear assumptions, and useful error
    messages.

### 4.2 Non-goals for the initial release

- Automated purchase orders or supplier integrations.
- Real-time ERP/WMS integration.
- Multi-echelon, multi-warehouse optimization.
- Perishable inventory, expiry, lot, or batch optimization.
- Backorder and substitution modeling in the first version; use
  lost-sales assumptions.
- Neural forecasting, deep learning, reinforcement learning, or custom
  model training.
- Multi-agent architecture.
- RAG over arbitrary external documents.
- Vector database as the primary system of record.
- Autonomous changes to inventory, costs, or user data.

## 5. Target users and use cases

### Primary user

A student, analyst, small-business operator, or inventory planner who
has SKU-level historical sales data and wants explainable replenishment
recommendations.

### Core jobs to be done

- "I want to upload my sales history and see demand forecasts."
- "I want to set my operating costs and supplier lead time."
- "I want to know which SKUs need replenishment attention."
- "I want to compare deterministic and uncertainty-aware policies."
- "I want to understand why a recommendation was produced."
- "I want to test how decisions change when assumptions change."
- "I want to ask follow-up questions about a specific analysis
  session."

## 6. Product workflow and information architecture

### 6.1 Primary user journey

1.  **Login**
    - User authenticates through Firebase Authentication.
    - Node.js verifies the Firebase ID token and establishes the
      application user context.
2.  **Home / landing page**
    - Explain the product and its workflow.
    - Primary CTA: **Get Started**.
    - Secondary CTA: view prior sessions (for authenticated users).
3.  **Create analysis session**
    - Clicking Get Started creates a new session in `created` state.
    - User uploads a CSV.
    - User may provide a session name.
4.  **Dataset validation and preparation**
    - Validate file type, size, required columns, data types, dates,
      quantities, duplicate records, and SKU coverage.
    - Show a preview, validation summary, warnings, and rejected-row
      count.
    - User confirms processing.
    - Normalize data into `sku_id,date,quantity` daily records.
5.  **Forecasting**
    - Forecasting runs for eligible SKUs.
    - Show forecast status and progress.
    - Display AutoETS point forecasts, Seasonal Naive baseline,
      P10/P50/P90 prediction intervals, and evaluation metrics where
      valid.
    - User can inspect a SKU or compare selected SKUs.
    - On completion, persist forecast outputs and metadata.
6.  **Inventory assumptions**
    - After forecasting completes, user enters common assumptions for
      all SKUs:
      - Ordering cost.
      - Holding cost per unit per day (or another explicitly
        selected time unit).
      - Shortage penalty per unit.
      - Supplier lead time in days.
      - Target cycle service level.
    - Defaults may be prefilled as illustrative assumptions but must
      be editable and clearly labeled.
    - User confirms assumptions before optimization.
7.  **Inventory optimization**
    - Calculate EOQ, deterministic ROP, and uncertainty-aware
      empirical ROP.
    - Generate SKU-level replenishment recommendations and risk
      indicators.
    - Explain policy definitions and assumptions in the UI.
    - User can compare policies and inspect SKU-level evidence.
8.  **Monte Carlo simulation**
    - Simulate deterministic and uncertainty-aware policies using the
      same demand scenarios.
    - Show cost breakdown, service level, stockout units/rate, average
      inventory, order count, and total cost.
    - Explain that simulation results depend on the selected
      assumptions and scenario-generation method.
    - Persist simulation configuration and results.
9.  **Session completion**
    - Mark the session as `completed` when required stages finish.
    - Store canonical artifacts in MongoDB and durable file/object
      storage as appropriate.
    - Index selected textual summaries and metadata in Qdrant for
      semantic retrieval. Do not indiscriminately embed raw numerical
      arrays or use Qdrant as the source of truth.
10. **Ask AI**
    - User clicks **Ask AI**.
    - User selects one of their completed or partially completed
      sessions.
    - A conversation opens scoped to that session.
    - User asks questions.
    - Node validates ownership and session access.
    - Agent retrieves relevant structured results and, when
      appropriate, calls permitted analytical tools.
    - Agent returns a structured response.
    - Node validates the response with Zod before displaying it.
    - Conversation history and references to evidence are persisted.

### 6.2 Navigation

Recommended authenticated navigation: - Dashboard / Home - New
Analysis - Analysis Sessions - Ask AI - Account / Settings

Within a session: - Overview - Dataset - Forecasts - Inventory
Optimization - Simulation - AI Insights / Ask AI

### 6.3 Session state model

Recommended states:
`created → uploading → validating → dataset_ready → forecasting → forecast_ready → assumptions_pending → optimizing → optimization_ready → simulating → completed`

Failure states: `validation_failed`, `forecast_failed`,
`optimization_failed`, `simulation_failed`, `cancelled`.

Every stage should record status, timestamps, error code, user-safe
message, and retry eligibility. A failed later stage must not erase
successful earlier artifacts.

## 7. Functional requirements

Priority definitions: **P0** = required for core demo; **P1** =
important; **P2** = enhancement.

### FR-01 Authentication and authorization (P0)

- Use Firebase Authentication for login.
- Verify Firebase ID tokens on the Node API.
- Enforce ownership checks for sessions, datasets, conversations, and
  results.
- Never trust a user ID supplied in a request body when it can be
  derived from the verified token.

### FR-02 Session lifecycle (P0)

- Create, list, retrieve, and archive analysis sessions.
- Every dataset, forecast, optimization result, simulation, and
  conversation must reference a session and owner.
- Support stage status and timestamps.
- Prevent cross-user access by ID guessing.

### FR-03 CSV upload and validation (P0)

- Accept CSV only in the first release.
- Support configurable maximum upload size and row count.
- Require or map columns to `sku_id`, `date`, and `quantity`.
- Allow a column-mapping step if headers differ.
- Validate non-empty SKU identifiers, parseable dates, numeric
  quantities, and duplicate SKU/date records.
- Reject or explicitly resolve negative quantities; do not silently
  interpret returns as demand.
- Report missing dates and SKU coverage.
- Require the user to confirm any aggregation or cleaning rules.
- Preserve the original upload or a secure reference to it for
  auditability.

### FR-04 Dataset transformation (P0)

- Normalize records to `sku_id,date,quantity`.
- Aggregate multiple transactions for a SKU on a date.
- Sort records chronologically.
- Build daily series per SKU.
- Fill absent SKU-days with zero only when the dataset is known to
  represent complete transaction coverage for the selected period.
  Otherwise show the limitation and require an explicit assumption.
- Store transformation metadata and row counts.

### FR-05 Forecasting (P0)

- Daily frequency.
- Seasonal period: 7 days.
- Forecast horizon: 28 days.
- Models: AutoETS (primary) and Seasonal Naive (baseline).
- AutoETS estimates model parameters from historical observations;
  this is not a neural-network training workflow.
- Generate nonnegative point forecasts.
- Produce empirical P10/P50/P90 prediction intervals using residual
  block bootstrap.
- Bootstrap specification:
  - Minimum history: 56 days.
  - Rolling-origin expanding-window evaluation.
  - Origins every 7 days.
  - Forecast residual blocks of 7 days.
  - 500 bootstrap paths.
  - Add sampled residual blocks to the AutoETS point forecast and
    clip demand at zero.
- If there are insufficient valid residual blocks, return an explicit
  insufficiency/fallback status. Never fabricate intervals.
- Evaluation holdout: final 28 days, excluded from training and
  interval calibration for that evaluation.
- Metrics: MAE, RMSE, WAPE, empirical P10--P90 coverage, and interval
  width.
- Handle zero WAPE denominator explicitly.
- Record model version, library version, parameters, seed, data
  window, and run timestamp.

### FR-06 Inventory assumptions (P0)

- Use one common set of assumptions for all SKUs in a session.
- Editable fields:
  - Ordering cost `S`.
  - Holding cost `H` with explicit unit.
  - Shortage penalty.
  - Lead time `L` in days.
  - Target service level.
- Store assumptions as an immutable versioned snapshot for each
  optimization run.
- Clearly distinguish demonstration defaults from user-provided
  values.
- Validate positive costs and lead time; validate service level
  between 0 and 1.

### FR-07 Inventory optimization (P0)

- Calculate annualized demand consistently for EOQ.
- EOQ: `sqrt(2DS/H)` where `D` is annual demand, `S` is ordering cost,
  and `H` is annual holding cost per unit.
- If the UI collects holding cost per unit per day, convert to annual
  holding cost (`daily H × 365`) before applying annual EOQ.
- Deterministic ROP: expected lead-time demand plus a documented
  safety-stock term using a normal approximation where the assumptions
  permit it.
- Uncertainty-aware ROP: empirical target-service-level quantile of
  simulated lead-time demand.
- Explain limitations where a normal approximation is unsuitable or
  sample size is insufficient.
- Use lost-sales assumptions in v1.
- Return SKU-level recommendation, policy inputs, intermediate
  quantities, and warnings.
- Do not claim one policy is universally superior.

### FR-08 Monte Carlo simulation (P0)

- Default 500 scenarios and 90-day simulation horizon; both
  configurable within safe bounds.
- Use the same generated demand scenarios for both policies (common
  random numbers) to make comparison fairer.
- Daily review.
- Inventory position includes on-hand plus on-order.
- Place an order when inventory position is at or below the policy
  reorder point.
- Receive orders after the configured lead time.
- Model lost sales rather than backorders.
- Calculate ordering, holding, and shortage costs.
- Report total and component costs, average inventory, stockout units,
  stockout rate, service level, order count, and scenario variability.
- Persist scenario-generation settings, random seed, policy
  definitions, and results.
- Results must be reproducible for the same inputs and seed.

### FR-09 Policy comparison and recommendations (P0)

- Present side-by-side deterministic and uncertainty-aware policy
  outcomes.
- Identify SKUs requiring attention using explicit, documented risk
  criteria.
- Show why each SKU is flagged and which metrics support the flag.
- Distinguish model output from product-level recommendation language.

### FR-10 Session artifact persistence (P0)

- MongoDB is the canonical source of truth for users, sessions,
  metadata, assumptions, job statuses, forecasts, optimization
  outputs, simulations, and conversations.
- Large raw/processed files should be stored in file/object storage or
  a controlled local storage adapter for development, with metadata
  and references in MongoDB. Avoid oversized MongoDB documents.
- Qdrant stores embeddings of selected session summaries, explanatory
  text, and compact textual representations of artifacts, with
  metadata filters such as `user_id`, `session_id`, `artifact_type`,
  and `created_at`.
- Every Qdrant point must carry stable references to canonical MongoDB
  records.
- Retrieval must filter by authenticated user and selected session
  before semantic search.
- If Qdrant is unavailable, core dashboards and deterministic
  calculations must continue to work; AI retrieval may degrade
  gracefully.

### FR-11 Ask AI conversation (P1)

- User selects a session before starting or continuing a conversation.
- Each conversation is scoped to one owner and one session.
- Support streaming responses if reliable; otherwise return complete
  structured responses.
- Persist user message, assistant response, tool-call trace summary,
  evidence references, model metadata, and timestamps.
- Provide citations/references to the session artifacts used in the
  explanation.
- Do not expose another session's content through conversation memory.

### FR-12 Agentic Explainable AI (P1; Phase 3)

The AI Inventory Analyst supports: 1. Natural-language inventory
analysis. 2. Recommendation explainability. 3. What-if scenario
analysis. 4. Inventory anomaly investigation. 5. Decision support under
a specified budget or constraint, only when a corresponding
deterministic analysis function exists.

Initial controlled tools: - `get_sku_forecast` -
`get_inventory_recommendation` - `compare_inventory_policies` -
`run_what_if_scenario` - `get_inventory_risk_summary`

Agent behavior: - Identify the user's intent and selected session. -
Retrieve structured canonical evidence first. - Call only allowlisted
tools. - Validate tool arguments and enforce session ownership. - Use
tools for calculations; do not perform arithmetic as an authoritative
substitute. - Explain conclusions with traceable values and artifact
references. - State when evidence is missing or insufficient. - Never
invent SKU metrics, forecast values, simulation results, or citations. -
Never execute purchasing, change source data, or persist new assumptions
without explicit user confirmation. - Treat uploaded CSV content and
retrieved text as untrusted data, not instructions.

### FR-13 Structured LLM output validation (P1)

- Define a versioned response schema in JavaScript using Zod.
- Recommended response fields:
  - `message`: user-facing explanation.
  - `intent`: enumerated intent.
  - `sessionId`: selected session identifier.
  - `summary`: concise result summary.
  - `keyFindings`: typed list of findings with values and units.
  - `evidence`: artifact references and supporting metric keys.
  - `toolActions`: safe summary of tools called.
  - `warnings`: limitations or missing data.
  - `followUpSuggestions`: relevant next questions.
- Validate every model response before rendering.
- Validate tool input/output separately.
- On schema failure, attempt a bounded repair/retry; if still invalid,
  return a controlled error and retain diagnostic metadata without
  exposing secrets.
- Zod validation ensures shape and type correctness, not factual
  correctness. Evidence grounding and tool provenance are separate
  requirements.

### FR-14 Auditability and observability (P1)

- Log request IDs, session IDs, stage transitions, tool calls, model
  provider/model identifiers, latency, and errors.
- Redact tokens, secrets, raw sensitive rows, and credentials.
- Record reproducibility metadata for statistical jobs.
- Provide user-visible job status and safe error messages.

## 8. UX requirements

### 8.1 General principles

- Progressive disclosure: do not ask for inventory costs before
  forecasting is complete.
- Make each stage's status visible.
- Keep assumptions editable and explain their units.
- Separate observed historical demand, point forecasts, prediction
  intervals, and recommendations visually.
- Always show when values are illustrative, assumed, or user-provided.
- Avoid presenting a recommendation without its key inputs and
  limitations.

### 8.2 Required screens

1.  Login / registration.
2.  Landing / home page with Get Started.
3.  CSV upload and column mapping.
4.  Data validation preview and confirmation.
5.  Forecast dashboard.
6.  Inventory assumptions form.
7.  Inventory optimization results.
8.  Monte Carlo simulation comparison.
9.  Session history / session detail.
10. Ask AI session selector.
11. Session-scoped conversation screen.
12. Account/settings and error states.

### 8.3 Important interaction details

- Show upload progress and validation outcomes.
- Allow the user to cancel long-running jobs where technically safe.
- Prevent duplicate job submissions for the same stage and input
  version.
- Display "last updated" and run IDs.
- What-if analysis creates a separate scenario run; it must not
  overwrite baseline results.
- AI explanations should show which session and artifacts they refer
  to.

## 9. System architecture

### 9.1 Technology baseline

- Frontend: React + Vite + Tailwind CSS v4.
- Client state: Redux Toolkit (reuse existing project setup).
- Application API: Node.js + JavaScript + Express.
- Authentication: Firebase Authentication.
- Primary database: MongoDB.
- Background jobs: In-process MongoDB-backed job queue with concurrency control.
- Statistical service: Python 3.11 + FastAPI.
- Forecasting: StatsForecast (`AutoETS`, `SeasonalNaive`),
  NumPy/Pandas as needed.
- Agent orchestration: LangGraph (prefer JavaScript in Node
  boundary unless implementation constraints justify a separate agent
  service).
- LLM: provider-agnostic adapter; provider and model selected through
  environment configuration.
- Structured validation: Zod in Node.js.
- Vector retrieval: Qdrant, used only for session-scoped semantic
  retrieval.

### 9.2 Service responsibilities

**React client** - Upload and workflow UI. - Charts and tables. -
Session selector and conversation interface. - Never call Python or
Qdrant directly.

**Node API** - Firebase token verification and authorization. - Session
lifecycle and canonical persistence. - Upload orchestration and file
validation. - Calls Python service. - Runs or coordinates the LangGraph
agent. - Validates LLM outputs with Zod. - Controls Qdrant indexing and
retrieval. - Enforces quotas, rate limits, and audit logging.

**Python FastAPI** - Data preparation support where appropriate. -
Forecasting, evaluation, bootstrap uncertainty. - Inventory
optimization. - Monte Carlo simulation. - Typed request/response
contracts. - No Firebase, MongoDB, or Qdrant responsibility in the
initial design.

**MongoDB** - Canonical application and analysis records.

**Qdrant** - Embedding index for selected textual session artifacts. -
Never authoritative for exact numerical values or ownership.

**Job Queue** - In-process MongoDB-backed job runner (`server/src/services/jobRunner.js`) managing asynchronous tasks, concurrency control, deduplication, and cancellation without external queue dependencies.

### 9.3 Architecture principles

- Keep the existing client/server skeleton; extend rather than
  rewrite.
- Keep deterministic numerical logic outside the LLM.
- Use versioned API contracts.
- Make long-running stages idempotent where possible.
- Pass correlation IDs across Node and Python.
- Use timeouts, bounded retries, and safe failure states.
- Do not introduce microservices beyond the Node API, Python
  statistical service, and agent orchestration needs.

## 10. API requirements (illustrative contract)

All application endpoints are under `/api/v1` and require authenticated
access unless explicitly marked public.

### Session and dataset

- `POST /sessions` --- create session.
- `GET /sessions` --- list current user's sessions.
- `GET /sessions/:sessionId` --- retrieve session summary.
- `PATCH /sessions/:sessionId` --- rename/archive where permitted.
- `POST /sessions/:sessionId/dataset` --- upload CSV.
- `GET /sessions/:sessionId/dataset/validation` --- validation report.
- `POST /sessions/:sessionId/dataset/confirm` --- confirm
  transformation.

### Forecasting and inventory

- `POST /sessions/:sessionId/forecast` --- start forecasting.
- `GET /sessions/:sessionId/forecast` --- retrieve forecast results.
- `POST /sessions/:sessionId/assumptions` --- create an assumptions
  version.
- `POST /sessions/:sessionId/optimize` --- run inventory optimization.
- `GET /sessions/:sessionId/optimization` --- retrieve
  recommendations.
- `POST /sessions/:sessionId/simulations` --- run policy simulation.
- `GET /sessions/:sessionId/simulations/:simulationId` --- retrieve
  simulation results.

### AI conversations

- `GET /ai/sessions` --- list sessions eligible for AI analysis.
- `POST /ai/conversations` --- create conversation scoped to a
  session.
- `GET /ai/conversations/:conversationId` --- retrieve conversation.
- `POST /ai/conversations/:conversationId/messages` --- submit message
  and receive validated response.
- `GET /ai/conversations/:conversationId/messages` --- retrieve
  history.

The exact HTTP status codes, pagination, error envelope, and
request/response schemas must be documented in the implementation API
specification. Never accept a session ID without checking that the
authenticated user owns it.

### Python service endpoints

- `GET /health`
- `POST /forecast`
- `POST /evaluate`
- `POST /optimize`
- `POST /simulate`

Node is the only public application entry point. Python service
endpoints should be network-restricted or protected by
service-to-service authentication.

## 11. Data model (logical)

Recommended MongoDB collections:

### `users`

- `_id`
- `firebaseUid`
- `email` (if available and required)
- `createdAt`
- `updatedAt`

### `analysis_sessions`

- `_id`
- `userId`
- `name`
- `status`
- `activeDatasetId`
- `createdAt`
- `updatedAt`
- `completedAt`

### `datasets`

- `_id`
- `userId`
- `sessionId`
- `originalFileRef`
- `processedFileRef`
- `schema`
- `rowCounts`
- `validationSummary`
- `transformationConfig`
- `status`
- `createdAt`

### `forecast_runs`

- `_id`
- `userId`
- `sessionId`
- `datasetId`
- `modelConfig`
- `evaluationConfig`
- `metrics`
- `resultRef` or compact result payload
- `status`
- `createdAt`

### `assumption_sets`

- `_id`
- `userId`
- `sessionId`
- `version`
- `orderingCost`
- `holdingCost`
- `holdingCostUnit`
- `shortagePenalty`
- `leadTimeDays`
- `targetServiceLevel`
- `createdAt`

### `optimization_runs`

- `_id`
- `userId`
- `sessionId`
- `assumptionSetId`
- `policyConfig`
- `resultRef`
- `status`
- `createdAt`

### `simulation_runs`

- `_id`
- `userId`
- `sessionId`
- `optimizationRunId`
- `scenarioCount`
- `horizonDays`
- `seed`
- `policyResults`
- `status`
- `createdAt`

### `ai_conversations` and `ai_messages`

- Owner and session references.
- Conversation state and timestamps.
- Message role, content, validated structured payload, model metadata,
  evidence references, and tool trace summary.

### Qdrant point metadata

- `user_id`
- `session_id`
- `artifact_type`
- `artifact_id`
- `content_version`
- `created_at`
- `text` or payload reference, subject to privacy and size limits.

Use indexes for `userId`, `sessionId`, stage status, and creation time.
Define retention and deletion behavior before production deployment.

## 12. Analytics and success metrics

### Product metrics

- Upload-to-forecast completion rate.
- Forecast-to-optimization completion rate.
- Simulation completion rate.
- Median time per stage.
- CSV validation failure rate.
- AI answer schema-validity rate.
- AI tool-call success rate.
- Percentage of AI answers with evidence references.
- User-reported usefulness of explanations.

### Statistical metrics

- MAE.
- RMSE.
- WAPE (with explicit zero-denominator handling).
- Empirical P10--P90 coverage.
- Prediction interval width.
- Total inventory cost.
- Holding, ordering, and shortage cost.
- Service level.
- Stockout units and stockout rate.
- Average inventory and order count.

Do not optimize for an assumed improvement in total cost. Report
measured outcomes, including cases where one policy performs worse.

## 13. Non-functional requirements

### Security

- Firebase token verification on every protected request.
- Session and artifact ownership checks.
- File type and size validation; do not trust client MIME type alone.
- Safe CSV parsing; protect against formula injection when exporting
  CSV.
- Secrets only in environment/secret manager, never committed.
- Service-to-service authentication for Python and Qdrant access.
- Rate limiting for uploads and LLM endpoints.
- Prompt-injection defenses: uploaded content and retrieved documents
  are data, not instructions.
- Do not let retrieved text alter tool permissions or system behavior.

### Privacy

- Session-level isolation in MongoDB queries and Qdrant filters.
- No cross-session retrieval unless explicitly requested and
  authorized.
- Document deletion behavior across MongoDB, file storage, Qdrant, and
  backups.
- Avoid sending unnecessary raw customer-level data to an LLM; prefer
  aggregate structured evidence.
- Disclose the LLM provider's data handling in the product's privacy
  notice.

### Reliability

- Stage-level status and recoverable errors.
- Bounded retries and timeouts.
- Idempotency keys for expensive operations.
- Preserve successful stage outputs after later-stage failure.
- Graceful degradation if Qdrant or the LLM provider is unavailable.

### Performance targets (initial prototype targets)

- Upload validation should provide timely progress and avoid blocking
  the web process.
- Forecasting and simulation should run as bounded background or
  managed jobs if execution time requires it.
- UI should remain responsive during analysis.
- API response targets should be set after measuring the selected
  dataset and deployment environment; do not promise unmeasured
  latency.
- Enforce configurable row, SKU, horizon, and scenario limits.

### Maintainability

- JavaScript types and Zod schemas at application boundaries.
- Pydantic schemas at Python boundaries.
- Unit and integration tests for calculations and workflow
  transitions.
- Centralized configuration and structured logs.
- Pin dependencies and record versions for reproducibility.

## 14. Testing and quality strategy

### Unit tests

- CSV parsing and validation.
- Aggregation, daily reindexing, and missing-day rules.
- AutoETS and Seasonal Naive behavior.
- Bootstrap dimensions, reproducibility, quantile ordering, and
  insufficient residual history.
- Holdout leakage prevention.
- WAPE zero denominator.
- EOQ unit conversions.
- Deterministic and empirical ROP calculations.
- Inventory simulation accounting and lead-time receipts.
- Zod response validation and tool schemas.

### Integration tests

- Firebase-authenticated upload-to-forecast flow.
- Forecast-to-assumptions-to-optimization flow.
- Optimization-to-simulation flow.
- Session ownership enforcement.
- Qdrant indexing and session-filtered retrieval.
- Agent tool invocation and structured response validation.
- Qdrant/LLM outage graceful degradation.

### End-to-end acceptance tests

1.  User logs in and creates a session.
2.  User uploads a valid CSV and sees validation results.
3.  User confirms the dataset and receives forecasts.
4.  User submits common cost and lead-time assumptions.
5.  User receives SKU-level optimization results.
6.  User runs simulation and sees both policy outcomes.
7.  User opens Ask AI and selects the session.
8.  User asks why a SKU has a particular ROP.
9.  Agent retrieves evidence, calls tools if needed, and returns a
    Zod-valid explanation.
10. User changes one assumption in a what-if scenario and sees a
    separate comparison without overwriting the baseline.
11. A second user cannot access the first user's session or AI
    conversation.

## 15. Delivery phases and priorities

### Phase 1 --- Data and forecasting foundation

- Existing authentication and application skeleton retained.
- Session creation and CSV upload.
- Validation and normalized daily dataset.
- AutoETS and Seasonal Naive forecasts.
- Residual bootstrap intervals and evaluation.
- Forecast dashboard.

### Phase 2 --- Inventory optimization

- Common assumptions form.
- EOQ and deterministic ROP.
- Empirical uncertainty-aware ROP.
- SKU-level recommendations and policy comparison.

### Phase 3A --- Monte Carlo simulation

- Common scenario generation.
- Deterministic vs uncertainty-aware policy simulation.
- Cost and service-level comparison.
- Persist simulation results.

### Phase 3B --- Agentic Explainable AI

- Session-scoped Ask AI.
- Qdrant indexing of selected textual artifacts.
- LangGraph orchestration.
- Controlled analytical tools.
- Zod-validated structured responses.
- Recommendation explanations, risk investigations, what-if analysis,
  and decision support.

### Phase 4 --- Hardening and deployment

- Security and privacy review.
- Observability and error handling.
- Performance testing.
- Deployment and demo rehearsal.
- Documentation and research reporting.

**Delivery rule:** Phase 3B must not block completion of the
deterministic forecasting, optimization, or simulation workflow. If time
is constrained, deliver a read-only explanation agent before adding
scenario execution.

## 16. Risks and mitigations

---

Risk Mitigation

---

Poor or inconsistent CSV data Preview, mapping, explicit
validation and transformation
report

Insufficient history for Explicit eligibility rules and
ETS/bootstrap transparent fallback/error status

False confidence in prediction Report empirical coverage and
intervals interval width; document
assumptions

Incorrect unit handling in EOQ Explicit units and tested
conversions

Simulation policy unfairness Same demand scenarios and recorded
random seed

LLM hallucination Tool-grounded answers, evidence
references, Zod validation, no
free-form numerical claims

Prompt injection through Treat all retrieved content as
CSV/retrieval untrusted data; strict tool
allowlist

Qdrant outage MongoDB remains canonical; AI
retrieval degrades gracefully

Scope creep No multi-agent, RAG over external
sources, neural models, or
purchasing automation

Deadline pressure Complete deterministic workflow
before optional agent polish
-----------------------------------------------------------------------

## 17. Open decisions to resolve before implementation

1.  Maximum CSV file size and row count.
2.  Whether the upload flow requires exactly `sku_id,date,quantity` or
    supports user column mapping.
3.  How the user confirms whether missing SKU-days mean zero demand.
4.  Whether sessions support multiple datasets and reruns.
5.  LLM provider/model and deployment secret configuration.
6.  Embedding model and Qdrant hosting choice.
7.  File/object storage choice for production.
8.  Whether AI responses stream or return complete structured messages.
9.  Data retention and session deletion policy.
10. Final cost units and whether users can configure a separate
    holding-cost period.

## 18. Definition of done

The core product is complete when a user can authenticate, upload and
validate a CSV, generate forecasts and uncertainty intervals, configure
inventory assumptions, obtain deterministic and uncertainty-aware
recommendations, run a fair Monte Carlo comparison, and revisit the
complete session.

The agentic extension is complete when a user can select a session, ask
a question, receive a schema-valid answer grounded in that session's
stored evidence, and run a non-destructive what-if scenario through
controlled tools.

The product must clearly distinguish historical observations, forecasts,
assumptions, calculated recommendations, simulated outcomes, and
LLM-generated explanations.
