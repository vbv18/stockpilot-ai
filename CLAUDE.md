# StockPilot AI: Architecture, Domain Engineering, and Technical Reference Guide

StockPilot AI is an uncertainty-aware, cost-driven, multi-SKU inventory decision intelligence platform. It ingests historical sales transactions, produces point and probabilistic demand forecasts using statistical time-series models, computes deterministic and empirical inventory replenishment policies, evaluates policies via discrete-event Monte Carlo simulation, and provides explainable decision support through a grounded LangGraph AI agent.

This document serves as an exhaustive technical and domain reference for Senior AI Engineers, Systems Architects, and Supply Chain Professionals evaluating or building upon this codebase.

---

## 1. Project Overview

### 1.1 Core Purpose and Solved Problems
Traditional small-to-medium business inventory management separates demand forecasting from inventory control:
1. **Uncertainty Disconnection**: Standard demand forecasting produces point estimates (expected values) without propagating residual error distributions into safety stock calculations.
2. **Normal Distribution Misalignment**: Classic textbook formulas for safety stock ($SS = z \cdot \sigma_L$) assume normally distributed lead-time demand. In real-world supply chains, demand exhibits non-zero skewness, intermittency, and calendar clustering, leading to systematic under-protection against stockouts.
3. **Black-Box AI Decisions**: Generic LLM assistants attempt to perform arithmetic or hallucinate inventory targets without deterministic mathematical grounding or verifiable provenance.

StockPilot AI resolves these challenges through a hybrid architecture:
- **Deterministic Statistical Core**: Numerical calculations (forecasting, bootstrap intervals, policy optimization, and Monte Carlo simulations) execute within a dedicated Python FastAPI engine.
- **Auditable Evidence Ledger**: Every numerical claim presented by the AI assistant is constrained by an evidence ledger tied to underlying session artifacts. The LLM is restricted from performing authoritative numerical calculations.
- **Dual Policy Comparison**: The platform juxtaposes standard deterministic safety stock against uncertainty-aware empirical quantile reorder points evaluated over identical Monte Carlo demand scenarios.

### 1.2 Target Users and Stakeholders
- **Inventory Planners & Supply Chain Analysts**: Professionals evaluating stockout exposure, reorder points ($ROP$), and order quantities ($EOQ$) across SKU portfolios.
- **Operations & Warehouse Managers**: Stakeholders balancing holding cost liabilities against customer service level agreements ($CSL$ and Unit Fill Rate).
- **Senior AI & Systems Engineers**: Architects auditing multi-service orchestration, asynchronous job queues, vector retrieval pipelines, and constrained agentic workflows.

### 1.3 Scope and Deliberate Non-Goals
The repository is scoped as an industry-grade analytical decision platform with intentional boundaries:
- **Supported**:
  - SKU-level daily historical transaction ingestion, cleaning, calendar alignment, and zero-imputation (up to 15 SKUs, 600,000 rows).
  - Multi-model statistical forecasting (`AutoETS`, `SeasonalNaive`) with holdout backtesting and residual block bootstrapping.
  - Classical Economic Order Quantity ($EOQ$) and dual Reorder Point ($ROP$) optimization.
  - Discrete-event Monte Carlo simulation under lost-sales assumptions.
  - Interactive What-If scenario simulations.
  - Grounded session-scoped chat assistant (LangGraph) backed by Qdrant vector retrieval.
- **Explicit Non-Goals (Not Implemented)**:
  - Multi-echelon network optimization or multi-warehouse inventory pooling.
  - Backorder queues or customer backlog tracking (all unmet demand is treated strictly as lost sales).
  - Perishable inventory modeling (shelf-life expiration, FIFO/FEFO batch tracking).
  - Purchase order dispatching, EDI, or ERP/WMS write-back integrations.
  - Automated capital budget optimization (unit purchase costs are not tracked; cost modeling is strictly operational: setup, holding, and penalty).

### 1.4 Development Maturity and Implementation Status
- **Backend API (`server/`)**: Production-ready Express 5 application with MongoDB persistence, Firebase JWT verification, structured error envelopes, and a custom in-process job queue with crash recovery.
- **Statistical Engine (`stats-service/`)**: Production-grade Python 3.11 FastAPI service utilizing `statsforecast`, `scipy`, and `numpy`.
- **Frontend (`client/`)**: Fully functional React 19 SPA with Tailwind CSS, Recharts data visualization, Redux Toolkit state management, and step-based session navigation.
- **AI Agent (`server/src/services/ai/`)**: Compiled LangGraph state graph with strict JSON schema drafting, numerical grounding verification, and Qdrant semantic search.

---

## 2. Business and Supply Chain Domain

### 2.1 Inventory Replenishment Mechanics
The platform implements continuous-review, order-point, order-quantity replenishment policies: $(s, Q)$, where:
- $s$ is the Reorder Point ($ROP$).
- $Q$ is the Order Quantity (modeled via the classical Economic Order Quantity, $EOQ$).

When the **Inventory Position** ($IP = \text{On-Hand} + \text{On-Order} - \text{Backorders}$, with backorders $= 0$ under lost sales) drops to or below $s$, a replenishment order of size $Q$ (or integer multiples of $Q$) is triggered.

```
                  Replenishment Cycle (s, Q)
     Inventory
       Level
         ^
         |      Order Arrives (+Q)
     s+Q +          /|
         |         / |
         |        /  |
         |       /   |
       s +------*    |  <--- Reorder Point Triggered (Order placed)
         |     /|    |
         |    / |    |
         |   /  |    |
         |  /   |    |  <--- Lead Time (L days) --->
      SS +-*----+----+------------------------------ (Safety Stock)
         |/     |    |
       0 +------+----+------------------------------> Time
```

### 2.2 Demand Forecasting and Uncertainty Estimation
Demand across supply chains exhibits non-stationarity, seasonality, and intermittency. Point forecasts alone cannot determine required safety buffers.

StockPilot AI implements a 28-day forecast horizon evaluated over an 8-block rolling-origin holdout structure:
1. **Point Forecast ($\hat{y}_t$)**:
   - `AutoETS`: Automatic Error-Trend-Seasonality state-space selection.
   - `SeasonalNaive`: Baseline repeating the observed demand from the prior seasonal cycle ($m=7$ days).
2. **Residual Block Bootstrap**:
   - Historical errors are collected as contiguous 7-day blocks: $e_{c:c+7} = y_{c:c+7} - \hat{y}_{c:c+7}$.
   - Future demand trajectories are simulated by perturbing baseline point forecasts with randomly resampled residual blocks:
     $$\tilde{D}_t = \max\left(0, \hat{y}_t + e^*_t\right)$$
   - Prediction intervals ($P_{10}, P_{50}, P_{90}$) are extracted directly from empirical percentiles of the generated paths.

### 2.3 Policy Comparison: Deterministic vs. Uncertainty-Aware
The platform contrasts two philosophies for setting the Reorder Point ($s$):

| Parameter | Deterministic Policy ($ROP_{\text{det}}$) | Uncertainty-Aware Policy ($ROP_{\text{unc}}$) |
| :--- | :--- | :--- |
| **Foundation** | Parametric Gaussian assumption | Non-parametric empirical bootstrap |
| **Expected Lead-Time Demand** | $\mu_L = \sum_{t=1}^L \hat{y}_t$ | $\bar{D}_L = \frac{1}{B} \sum_{b=1}^B D_{L, b}$ |
| **Lead-Time Dispersion** | $\sigma_L = \sigma_{\text{resid}} \sqrt{L}$ | Empirical distribution of simulated $D_{L, b}$ |
| **Safety Stock ($SS$)** | $SS_{\text{det}} = \Phi^{-1}(\alpha) \cdot \sigma_L$ | $SS_{\text{unc}} = ROP_{\text{unc}} - \bar{D}_L$ |
| **Reorder Point Formula** | $s_{\text{det}} = \lceil \mu_L + SS_{\text{det}} \rceil$ | $s_{\text{unc}} = \lceil \text{Quantile}_{\alpha}(\{D_{L, b}\}_{b=1}^B) \rceil$ |
| **Operational Vulnerability** | Under-buffers when lead-time demand is right-skewed or lumpy. | Captures fat tails and lumpiness without assuming normality. |

### 2.4 Cost Modeling & Service Levels
StockPilot AI tracks three distinct operational cost categories:
1. **Ordering Cost ($K$ or $S$)**: Fixed administrative and logistics cost incurred each time a purchase order is transmitted ($\text{Cost}_{\text{order}} = K \cdot N_{\text{orders}}$).
2. **Holding Cost ($c_h$)**: Capital and physical storage cost per unit per day. User input in annual terms is converted via $c_h = \frac{h_{\text{annual}}}{365}$. Accrued daily based on end-of-day on-hand inventory:
   $$\text{Cost}_{\text{holding}} = c_h \sum_{t=1}^T I_t$$
3. **Shortage Penalty ($c_p$)**: Explicit lost-sales penalty per unfulfilled unit:
   $$\text{Cost}_{\text{shortage}} = c_p \sum_{t=1}^T \max(0, D_t - I_t)$$

**Service Metrics**:
- **Cycle Service Level ($CSL$)**: Proportion of replenishment cycles completed without a stockout event.
- **Unit Fill Rate ($FR$)**: Volumetric proportion of total customer demand fulfilled from available stock:
  $$FR = 1 - \frac{\sum \text{Lost Sales}}{\sum \text{Demand}}$$
- **Stockout-Day Rate**: Percentage of operating days in which unfulfilled demand occurred.

### 2.5 Risk Screening Framework
Seven rule-based screening flags categorize SKU risk without relying on probabilistic predictions:
1. `high_demand_uncertainty`: Lead-time demand coefficient of variation ($CV \ge 0.5$).
2. `policy_divergence`: Deterministic and uncertainty-aware ROP diverge by $\ge 20\%$.
3. `poor_forecast_accuracy`: 28-day holdout Weighted Absolute Percentage Error ($WAPE \ge 50\%$).
4. `interval_undercoverage`: P10-P90 bootstrap interval coverage on holdout drops below $60\%$ (nominal $80\%$).
5. `normal_approximation_unsuitable`: Expected lead-time demand $\mu_L < 10$ units or distribution skewness $|\gamma| > 1.0$.
6. `deterministic_stockout_rate_above_tolerance`: Simulated stockout rate exceeds $(1 - \text{target\_service\_level})$.
7. `uncertainty_aware_stockout_rate_above_tolerance`: Simulated empirical stockout rate exceeds $(1 - \text{target\_service\_level})$.

---

## 3. Technical Architecture

### 3.1 Architectural Style & High-Level Topology
StockPilot AI follows a multi-service architecture comprising:
- **Presentation Layer**: Client-side React 19 Single Page Application.
- **API Orchestration Layer**: Node.js Express 5 server managing authentication, session state machines, background job coordination, vector indexing, and LangGraph agent execution.
- **Computation Engine**: Python 3.11 FastAPI service executing statistical forecasting, bootstrapping, optimization, and Monte Carlo simulations.
- **Persistence Layer**: MongoDB database (system of record) and Qdrant Cloud (vector search index).

```mermaid
flowchart TB
    subgraph Client ["Client Layer (Browser)"]
        UI["React 19 SPA (Vite + Tailwind)"]
        ReduxStore["Redux Toolkit (RTK Query)"]
    end

    subgraph Server ["Node.js API Server (:5000)"]
        Auth["Firebase Admin Auth Middleware"]
        Router["Express 5 REST API (/api/v1)"]
        StateMachine["Session State Machine"]
        JobRunner["In-Process Job Runner (Semaphore Queue)"]
        LangGraph["LangGraph AI Agent Engine"]
        Ledger["Evidence Ledger & Grounding Validator"]
    end

    subgraph StatsService ["Stats Engine (:8000)"]
        FastAPI["FastAPI App (Private Interface)"]
        ForecastEngine["Forecasting (AutoETS, SeasonalNaive)"]
        BootstrapEngine["Block Bootstrap Generator"]
        InventoryEngine["EOQ & Dual ROP Optimizer"]
        SimEngine["Monte Carlo Simulation (Lost Sales)"]
    end

    subgraph DataStores ["Data & Storage Layer"]
        Mongo[("MongoDB 6+ (System of Record)")]
        DiskStorage[("Local Disk / Storage Driver")]
        Qdrant[("Qdrant Vector DB (Cosine Embeddings)")]
        LLMProvider["External LLM (Gemini / OpenAI / Anthropic / Groq)"]
    end

    UI <-->|HTTP / REST + Bearer Token| Router
    Router --> Auth
    Router --> StateMachine
    Router --> JobRunner
    JobRunner -->|POST JSON + X-Service-Key| FastAPI
    FastAPI --> ForecastEngine
    FastAPI --> BootstrapEngine
    FastAPI --> InventoryEngine
    FastAPI --> SimEngine
    JobRunner --> Mongo
    JobRunner --> DiskStorage
    Router --> LangGraph
    LangGraph --> Qdrant
    LangGraph --> LLMProvider
    LangGraph --> Ledger
```

### 3.2 Inter-Service Communication & Data Contracts
1. **Client to Server**: Authenticated via HTTP Bearer tokens (Firebase JWT) or HTTP-only session cookies. Envelopes strictly follow:
   - Success: `{ "data": <payload>, "meta"?: <object> }`
   - Error: `{ "error": { "code": <string>, "message": <string>, "details"?: <any>, "requestId": <string> } }`
2. **Server to Stats Service**: Internal HTTP requests to `http://127.0.0.1:8000`. Authenticated via the `X-Service-Key` header against `STATS_SERVICE_KEY`. Payloads are strictly typed using Pydantic on Python and Zod on Node.js.
3. **Server to Qdrant**: REST client (`@qdrant/js-client-rest`) interacting with collection `stockpilot_session_artifacts` using 1536-dimensional or 768-dimensional cosine vector embeddings.

### 3.3 Session Lifecycle State Machine
Sessions strictly advance through states enforced by `server/src/services/stateMachine.js`:

```mermaid
stateDiagram-v2
    [*] --> created: POST /sessions
    created --> uploading: POST /sessions/:id/dataset
    uploading --> validating: Upload completes
    validating --> dataset_ready: Validation job succeeds
    validating --> validation_failed: Validation job fails
    validation_failed --> uploading: Re-upload file
    dataset_ready --> forecasting: POST /sessions/:id/forecast
    forecasting --> forecast_ready: Forecast job succeeds
    forecasting --> forecast_failed: Forecast job fails
    forecast_failed --> forecasting: Retry forecast
    forecast_ready --> assumptions_pending: POST /sessions/:id/assumptions
    assumptions_pending --> optimizing: POST /sessions/:id/optimize
    optimizing --> optimization_ready: Optimization job succeeds
    optimizing --> optimization_failed: Optimization job fails
    optimization_failed --> assumptions_pending: Update assumptions
    optimization_ready --> simulating: POST /sessions/:id/simulations
    simulating --> completed: Simulation job succeeds
    simulating --> simulation_failed: Simulation job fails
    completed --> assumptions_pending: Re-configure assumptions
    completed --> simulating: Re-simulate scenarios
```

### 3.4 Asynchronous Job Runner Lifecycle
Background tasks (dataset validation, transformation, forecasting, optimization, and simulation) run via `server/src/services/jobRunner.js`:

```mermaid
sequenceDiagram
    autonumber
    actor User as Client / User
    participant Route as Express Route
    participant Runner as Job Runner
    participant DB as MongoDB (jobs)
    participant Python as Stats Engine (:8000)

    User->>Route: POST /sessions/:id/forecast
    Route->>Runner: enqueueJob(stage, input, hashInput)
    Runner->>DB: Check duplicate running job (hashInput)
    alt Job Already Queued/Running
        Runner-->>Route: Return existing job (HTTP 200, deduplicated=true)
    else New Job
        Runner->>DB: Insert job (status: "queued")
        Runner-->>Route: Return new job (HTTP 202, jobId)
    end
    Route-->>User: JSON Response with jobId

    Note over Runner: setImmediate() triggers executeJob()
    Runner->>Runner: acquireLock() (concurrency limit)
    Runner->>DB: Update status to "running", startedAt
    Runner->>Python: POST /forecast (with AbortSignal)
    Python-->>Runner: 200 OK (ForecastResponse JSON)
    Runner->>DB: Update progress (pct: 100, message: "Done")
    Runner->>DB: Update status to "succeeded", finishedAt
    Runner->>Runner: releaseLock()
    
    loop Polling Status
        User->>Route: GET /sessions/:id/jobs/:jobId
        Route-->>User: Return progress & status
    end
```

---

## 4. Repository Structure

```
stockpilot-ai/
├── client/                              # React 19 Frontend Application
│   ├── src/
│   │   ├── components/                  # Shared UI primitives (ErrorBoundary, StatusBadge)
│   │   ├── features/
│   │   │   ├── ai/                      # Ask AI page container
│   │   │   ├── askAi/                   # Conversation views, message cards, evidence popovers
│   │   │   ├── assumptions/             # Operational assumption configuration panel
│   │   │   ├── dataset/                 # File upload, column mapping, validation summary
│   │   │   ├── forecast/                # Forecast charts, backtest metrics, P10-P90 bands
│   │   │   ├── jobs/                    # Real-time job progress tracking hooks & widgets
│   │   │   ├── optimization/            # Policy comparison tables, SKU detail drawer
│   │   │   ├── sessions/                # Session listing, overview, stepper layout
│   │   │   └── simulation/              # Monte Carlo results, cost charts, paired metrics
│   │   ├── lib/                         # RTK Query API client, copy dictionary, formatters
│   │   ├── pages/                       # Top-level route pages (Home, Login, NotFound)
│   │   ├── redux/                       # Redux store & user authentication slice
│   │   ├── utils/                       # Firebase client initialization, Axios base instance
│   │   ├── App.jsx                      # Route definitions and session step redirection
│   │   └── main.jsx                     # Application bootstrap & Redux Provider mount
│   ├── package.json                     # Client dependencies (React 19, Vite, Tailwind v4, Recharts)
│   └── vite.config.js                   # Vite configuration with Tailwind CSS plugin
│
├── server/                              # Node.js Express 5 API Server
│   ├── src/
│   │   ├── auth/                        # User context attachment & session resolution
│   │   ├── config/                      # Database, Redis, Firebase, and constants configs
│   │   ├── contracts/                   # Zod schemas (AI, common, dataset, pipeline, python)
│   │   ├── controllers/                 # Legacy auth & user controller handlers
│   │   ├── lib/                         # AppError classes, CSV date parsers, local storage
│   │   ├── middlewares/                 # Auth, error handling, rate limiting, Zod validation
│   │   ├── models/                      # Mongoose models (11 MongoDB schemas)
│   │   ├── repositories/                # Direct database access queries
│   │   ├── routes/                      # Route handlers (v1 REST endpoints & legacy mounts)
│   │   │   └── v1/                      # Sessions, datasets, forecast, assumptions, optimization, simulations, AI
│   │   ├── services/
│   │   │   ├── ai/                      # LangGraph agent, evidence ledger, grounding, prompts
│   │   │   │   └── tools/               # 5 analytical tools (forecast, recommend, compare, what-if, risk)
│   │   │   ├── vector/                  # Qdrant client, chunk indexing, embedding providers
│   │   │   ├── datasetHandlers.js       # Ingestion & validation stream parsing
│   │   │   ├── forecastHandlers.js      # Forecast orchestration with Python stats engine
│   │   │   ├── optimizationHandlers.js  # Inventory policy execution & risk tagging
│   │   │   ├── simulationHandlers.js    # Monte Carlo simulation coordination
│   │   │   ├── jobRunner.js             # Semaphore job queue with AbortController cancellation
│   │   │   ├── stateMachine.js          # Canonical session state transition rules
│   │   │   └── statsClient.js           # Undici HTTP client wrapper for Python stats engine
│   │   └── server.js                    # Server bootstrap, middleware pipeline, startup recovery
│   └── package.json                     # Server dependencies (Express 5, LangChain, LangGraph, Mongoose)
│
├── stats-service/                       # Python 3.11+ Statistical & Simulation Engine
│   ├── app/
│   │   ├── engine/                      # Core mathematical & statistical algorithms
│   │   │   ├── bootstrap.py             # Residual block generation & path simulation
│   │   │   ├── evaluation.py            # Holdout backtesting (MAE, RMSE, WAPE, Coverage)
│   │   │   ├── forecasting.py           # AutoETS and SeasonalNaive fitting via statsforecast
│   │   │   ├── inventory.py             # EOQ, Deterministic ROP, and Empirical Quantile ROP
│   │   │   ├── meta.py                  # Runtime execution clock & performance telemetry
│   │   │   ├── seeds.py                 # Deterministic pseudo-random seed derivation
│   │   │   └── simulation.py            # Discrete-event daily simulation engine (lost sales)
│   │   ├── config.py                    # Service settings via Pydantic Settings
│   │   ├── main.py                      # FastAPI application, exception handlers, telemetry
│   │   ├── routes.py                    # POST endpoints (/forecast, /evaluate, /optimize, /simulate)
│   │   ├── schemas.py                   # Strict Pydantic input/output validation models
│   │   └── security.py                  # X-Service-Key shared secret authentication
│   └── requirements.txt                 # Pinned dependencies (fastapi, statsforecast, scipy, numpy)
│
├── docs/                                # Project Specifications & Architecture Records
│   ├── API.md                           # REST API endpoint reference
│   ├── DATA_HANDLING.md                 # Data privacy & cascading deletion policy
│   ├── DEPLOYMENT_NOTES.md              # Production networking, VPC, and interface binding notes
│   ├── METHODS.md                       # Mathematical formulas & statistical methodology
│   ├── PRD.md                           # Product Requirements Document
│   ├── REPO_MAP.md                      # Repository path resolution & technical baseline
│   └── VERIFY.md                        # Manual testing & operational acceptance checklist
│
├── AGENTS.md                            # Operational rules and technical constraints for AI agents
├── package.json                         # Monorepo root script configuration
└── README.md                            # High-level architecture summary & quickstart guide
```

---

## 5. Backend Deep Dive (`server/`)

### 5.1 Runtime & Middleware Stack
The API is built on Node.js using ESM modules and Express 5.3.0. Incoming HTTP requests pass through the following sequential pipeline:
1. `requestContext` (`server/src/middlewares/requestContext.js`): Generates or extracts `X-Request-Id` (UUID v4) and attaches high-resolution request timing.
2. `morgan("dev")`: Request logging.
3. `helmet()`: Security header injection.
4. `cors()`: Cross-Origin Resource Sharing verification against `CORS_ORIGINS`.
5. `express.json({ limit: "1mb" })`: JSON body parser.
6. `cookieParser()`: Cookie header parsing for session authentication.
7. `authMiddleware` (`server/src/middlewares/auth.middleware.js`): Extracts Bearer token from `Authorization` header, verifies Firebase JWT via Firebase Admin SDK, or validates HTTP-only session cookie.
8. `attachUser()` (`server/src/auth/currentUser.js`): Maps Firebase UID to local MongoDB User document (`res.locals.user`).
9. `rateLimiters` (`server/src/middlewares/rateLimit.js`):
   - General API: 120 requests / min.
   - Dataset Uploads: 10 uploads / hr.
   - AI Endpoints: 20 prompts / min.
10. `validate({ params, query, body })` (`server/src/middlewares/validate.js`): Validates request inputs against strict Zod schemas, stripping unpermitted fields (`strip()`).
11. `notFoundHandler` & `errorHandler` (`server/src/middlewares/errorHandler.js`): Catches domain exceptions (`AppError`), logging sanitized metadata and emitting structured JSON error envelopes.

### 5.2 Background Processing Engine (`server/src/services/jobRunner.js`)
Instead of relying on external worker processes, the backend implements an in-process, asynchronous job queue:
- **Semaphore Concurrency**: Controlled by `JOB_CONCURRENCY` (default: 2 active jobs).
- **Idempotent Deduplication**: Each job hashes its canonical JSON payload:
  $$\text{Hash} = \text{SHA256}(\text{stage} + \text{sessionId} + \text{canonicalJson}(\text{hashInput}))$$
  A unique partial MongoDB index on `{ sessionId: 1, stage: 1, inputHash: 1 }` for active jobs prevents duplicate job submission.
- **Cancellation via AbortController**: Active jobs register an `AbortController`. When cancellation is requested (`POST /jobs/:id/cancel`), the signal aborts outbound HTTP connections and restores the prior session state.
- **Startup Crash Recovery**: On boot (`server.js`), `recoverInterruptedJobs()` queries MongoDB for jobs in `queued` or `running` state, marking them `failed` with code `SERVER_RESTART` and invoking stage-specific rollback handlers.

### 5.3 Complete API Endpoint Matrix

| Method | Path | Auth | Description | Validation Contract |
| :--- | :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/health` | Public | Service health & timestamp | None |
| `POST` | `/api/v1/auth/login` | Public | Firebase token exchange | `z.object({ token: z.string() })` |
| `POST` | `/api/v1/auth/logout` | Session | Clear session cookie | None |
| `GET` | `/api/v1/sessions` | Bearer | List paginated user sessions | `PaginationQuery` (page, limit, archived) |
| `POST` | `/api/v1/sessions` | Bearer | Create a new analysis session | `SessionCreateBody` (name max 120) |
| `GET` | `/api/v1/sessions/:sessionId` | Bearer | Fetch session details & status | `IdParam` |
| `PATCH` | `/api/v1/sessions/:sessionId` | Bearer | Rename or archive session | `IdParam`, `SessionPatchBody` |
| `DELETE` | `/api/v1/sessions/:sessionId` | Bearer | Cascade delete session & artifacts | `IdParam` |
| `POST` | `/api/v1/sessions/:sessionId/dataset` | Bearer | Upload CSV/Excel dataset | `multipart/form-data` (file <= 60MB) |
| `PUT` | `/api/v1/sessions/:sessionId/dataset/mapping` | Bearer | Submit column mappings | `ColumnMappingBody` |
| `GET` | `/api/v1/sessions/:sessionId/dataset/validation` | Bearer | Ingestion validation summary | `IdParam` |
| `POST` | `/api/v1/sessions/:sessionId/dataset/confirm` | Bearer | Confirm transformation | `DatasetConfirmBody` |
| `POST` | `/api/v1/sessions/:sessionId/forecast` | Bearer | Trigger 28-day forecasting job | `ForecastBody` (optional seed) |
| `GET` | `/api/v1/sessions/:sessionId/forecast` | Bearer | Get active forecast & metrics | `IdParam` |
| `GET` | `/api/v1/sessions/:sessionId/forecast/series/:sku` | Bearer | Detailed SKU forecast & intervals | `IdParam`, `sku` string |
| `GET` | `/api/v1/sessions/:sessionId/assumptions/defaults` | Bearer | Get default demo assumptions | `IdParam` |
| `POST` | `/api/v1/sessions/:sessionId/assumptions` | Bearer | Save operational assumptions | `AssumptionsBody` |
| `POST` | `/api/v1/sessions/:sessionId/optimize` | Bearer | Run inventory optimization | `IdParam` |
| `GET` | `/api/v1/sessions/:sessionId/optimization` | Bearer | Get active policy results | `IdParam` |
| `POST` | `/api/v1/sessions/:sessionId/simulations` | Bearer | Run Monte Carlo simulation | `SimulationBody` (nScenarios, horizonDays) |
| `GET` | `/api/v1/sessions/:sessionId/simulations` | Bearer | List simulation runs | `IdParam` |
| `GET` | `/api/v1/sessions/:sessionId/simulations/:simId` | Bearer | Get specific simulation result | `SimulationIdParam` |
| `GET` | `/api/v1/sessions/:sessionId/jobs` | Bearer | List background jobs | `IdParam`, optional `stage` filter |
| `GET` | `/api/v1/sessions/:sessionId/jobs/:jobId` | Bearer | Poll specific job progress | `JobIdParam` |
| `POST` | `/api/v1/sessions/:sessionId/jobs/:jobId/cancel` | Bearer | Cancel queued/running job | `JobIdParam` |
| `GET` | `/api/v1/ai/sessions` | Bearer | List AI-eligible sessions | None |
| `POST` | `/api/v1/ai/sessions/:sessionId/reindex` | Bearer | Force Qdrant reindexing | `IdParam` |
| `GET` | `/api/v1/ai/sessions/:sessionId/conversations` | Bearer | List chat conversations | `IdParam` |
| `POST` | `/api/v1/ai/sessions/:sessionId/conversations` | Bearer | Create chat conversation | `ConversationCreateBody` |
| `GET` | `/api/v1/ai/conversations/:conversationId/messages` | Bearer | Fetch chat message history | `ConversationIdParam`, pagination |
| `POST` | `/api/v1/ai/conversations/:conversationId/messages` | Bearer | Send question to AI Agent | `MessageCreateBody` (question max 1000) |

---

## 6. Frontend Deep Dive (`client/`)

### 6.1 Tooling & State Architecture
- **Framework & Build**: React 19.3.1 bundled with Vite 8.3.6 and `@tailwindcss/vite` (Tailwind CSS v4).
- **Navigation**: `react-router-dom` v7.18.5 utilizing a nested `SessionLayout` with automatic step redirection based on session maturity.
- **State Layer**:
  - `userSlice` (`client/src/redux/userSlice.js`): Stores Firebase authenticated user profile and login status.
  - `stockpilotApi` (`client/src/lib/api.js`): Redux Toolkit Query API definition configuring 28 queries/mutations with automated tag invalidation (`Sessions`, `Forecast`, `Assumptions`, `Optimization`, `Simulations`, `Messages`).
  - `sessionStorage`: Manages ephemeral background `jobId` pointers to sustain real-time polling across page reloads.

### 6.2 User Journey & Page Progression

```
[Login (/login)] 
       │
       ▼
[Sessions Dashboard (/sessions)] ──> Create New Session
       │
       ▼
[Session Step Container (/sessions/:id)]
   ├── 1. Overview (/overview)       ──> High-level KPIs & stage cards
   ├── 2. Upload (/upload)           ──> CSV drag-and-drop & delimiter detection
   ├── 3. Validation (/validation)   ──> Column mapping & row rejection audit
   ├── 4. Forecast (/forecast)       ──> AutoETS vs Seasonal Naive & P10-P90 charts
   ├── 5. Assumptions (/assumptions) ──> Cost, lead time, and service level setup
   ├── 6. Optimization (/optimization) ──> Deterministic vs Empirical ROP & SKU Drawer
   └── 7. Simulation (/simulation)   ──> Monte Carlo cost & stockout distributions
       │
       ▼
[Ask AI (/ask-ai & /ask-ai/:convId)] ──> Grounded conversation & What-If exploration
```

### 6.3 Visualization Components
- **`ForecastChart.jsx`**: Multi-line Recharts view plotting observed demand history, point forecast mean, and shaded prediction interval bands ($P_{10}$ to $P_{90}$).
- **`SkuDrawer.jsx`**: Slide-over panel detailing SKU-level lead-time demand parameters ($\mu_L, \sigma_L$, skewness), normal vs empirical quantile cutoffs, and active risk flags.
- **`AssistantMessageCard.jsx`**: Rich assistant response card displaying summary, structured key findings with color-coded provenance tags (`observed`, `forecast`, `calculated`, `simulated`, `what_if`), and interactive evidence popovers linking directly to underlying data pages.

---

## 7. Database and Data Model

### 7.1 Database Engine
MongoDB 6+ accessed via Mongoose 9.12.2. All collections use strict schemas with automatic timestamps. Multi-tenant isolation is enforced at the database level: every query against user data mandates `{ userId }`.

### 7.2 Entity-Relationship Diagram

```mermaid
erDiagram
    users ||--o{ analysis_sessions : owns
    users ||--o{ datasets : uploads
    users ||--o{ forecast_runs : executes
    users ||--o{ assumption_sets : configures
    users ||--o{ optimization_runs : computes
    users ||--o{ simulation_runs : simulates
    users ||--o{ what_if_runs : evaluates
    users ||--o{ ai_conversations : creates
    users ||--o{ ai_messages : posts
    users ||--o{ jobs : triggers

    analysis_sessions ||--o{ datasets : contains
    analysis_sessions ||--o{ forecast_runs : contains
    analysis_sessions ||--o{ assumption_sets : contains
    analysis_sessions ||--o{ optimization_runs : contains
    analysis_sessions ||--o{ simulation_runs : contains
    analysis_sessions ||--o{ what_if_runs : contains
    analysis_sessions ||--o{ ai_conversations : scopes
    analysis_sessions ||--o{ jobs : schedules

    ai_conversations ||--o{ ai_messages : contains
    ai_conversations ||--o{ what_if_runs : references

    forecast_runs ||--o{ optimization_runs : feeds
    assumption_sets ||--o{ optimization_runs : configures
    optimization_runs ||--o{ simulation_runs : inputs
    optimization_runs ||--o{ what_if_runs : baselines
    simulation_runs ||--o{ what_if_runs : baselines
```

### 7.3 Schema Specifications

#### `analysis_sessions`
- `_id`: ObjectId (Primary Key).
- `userId`: ObjectId (Indexed, ref: `users`).
- `name`: String (max 120 chars).
- `status`: String (Enum: `created`, `uploading`, `validating`, `dataset_ready`, `forecasting`, `forecast_ready`, `assumptions_pending`, `optimizing`, `optimization_ready`, `simulating`, `completed`, `archived`, etc.).
- `stages`: Embedded sub-document tracking `dataset`, `forecast`, `optimization`, and `simulation` status, started/finished timestamps, error codes, and `lastJobId`.
- `activeDatasetId`, `activeForecastRunId`, `activeAssumptionSetId`, `activeOptimizationRunId`, `activeSimulationRunId`: ObjectIds referencing active stage artifacts.
- `aiIndex`: Embedded document `{ status, updatedAt, contentVersion, errorMessage }`.

#### `datasets`
- `_id`: ObjectId (Primary Key).
- `userId`, `sessionId`: ObjectIds.
- `originalFileRef`: `{ key, bytes, sha256, originalName, encoding, delimiter }`.
- `processedFileRef`, `aggregatedFileRef`: S3/Local storage pointers for cleaned series.
- `preview`: Array of rows (first 10 records).
- `mapping`: `{ skuColumn, dateColumn, quantityColumn }`.
- `rowCounts`: `{ totalDataRows, acceptedRows, rejectedRows, processedRows }`.
- `validationSummary`: Detailed metrics (date range, SKU counts, missing date counts, rejected row counters).
- `status`: Enum (`uploaded`, `validating`, `validated`, `validation_failed`, `transforming`, `ready`, `replaced`).

#### `forecast_runs`
- `_id`: ObjectId.
- `userId`, `sessionId`, `datasetId`: ObjectIds.
- `modelConfig`: `{ primary: "AutoETS", baseline: "SeasonalNaive", params }`.
- `result`: Raw Python response containing per-SKU forecasts, bootstrap residual blocks, and model specs.
- `metrics`: Holdout evaluation metrics (`mae`, `rmse`, `wape`, `coverage`, `mean_width`).
- `status`: Enum (`running`, `succeeded`, `failed`, `cancelled`).

#### `assumption_sets`
- `_id`: ObjectId.
- `userId`, `sessionId`: ObjectIds.
- `version`: Integer (Unique compound index on `{ sessionId, version }`).
- `orderingCost`: Number ($> 0$).
- `holdingCost`: Number ($> 0$).
- `holdingCostUnit`: String (`per_unit_per_day` or `per_unit_per_year`).
- `shortagePenalty`: Number ($> 0$).
- `leadTimeDays`: Integer ($1 \le L \le 28$).
- `targetServiceLevel`: Number ($0 < \alpha < 1$).
- `provenance`: Detailed attribution for each assumption (`user` vs `demonstration_default`).

#### `optimization_runs`
- `_id`: ObjectId.
- `userId`, `sessionId`, `assumptionSetId`, `forecastRunId`: ObjectIds.
- `policyConfig`: `{ nBootstrap, blockSize, bootstrapSeed, orderQuantityRule }`.
- `result`: Per-SKU policy parameters ($Q^*, s_{\text{det}}, s_{\text{unc}}, SS_{\text{det}}, SS_{\text{unc}}$, lead-time distribution stats).

#### `simulation_runs`
- `_id`: ObjectId.
- `userId`, `sessionId`, `optimizationRunId`: ObjectIds.
- `scenarioCount`: Integer (100 to 2000).
- `horizonDays`: Integer (30 to 180).
- `seed`: Integer.
- `policyResults`: Detailed Monte Carlo simulation statistics for deterministic and uncertainty-aware policies.

#### `what_if_runs`
- `_id`: ObjectId.
- `userId`, `sessionId`, `conversationId`: ObjectIds.
- `baselineOptimizationRunId`, `baselineSimulationRunId`: ObjectIds.
- `overrides`: Partial assumption modifications.
- `effectiveAssumptions`: Merged assumption object.
- `optimizationResult`, `simulationResult`: Re-calculated metrics.
- `comparison`: Delta metrics against baseline runs.

#### `jobs`
- `_id`: ObjectId.
- `userId`, `sessionId`: ObjectIds.
- `stage`: Enum (`validation`, `transformation`, `forecast`, `optimization`, `simulation`).
- `status`: Enum (`queued`, `running`, `succeeded`, `failed`, `cancelled`).
- `inputHash`: SHA-256 idempotency string (Indexed with compound unique constraint on active jobs).
- `progress`: `{ pct: Number, message: String }`.
- `cancelRequested`: Boolean.

---

## 8. AI, Machine Learning, and Intelligent Features

### 8.1 LangGraph Architecture
The Ask AI assistant (`server/src/services/ai/agent.js`) is constructed using `@langchain/langgraph` as a compiled state graph:

```mermaid
flowchart TD
    START([START]) --> PrepareNode["1. Prepare Node\n(Load Bundle, Digest, Vector Retrieval)"]
    PrepareNode --> AgentNode["2. Agent Node\n(Invoke LLM with Bound Tools)"]
    AgentNode --> ShouldContinue{"Tool Calls\nPresent?"}
    ShouldContinue -- Yes (< 6 steps) --> ToolsNode["3. Tools Node\n(Execute Tool, Record in Ledger)"]
    ToolsNode --> AgentNode
    ShouldContinue -- No / Limit Reached --> ComposeNode["4. Compose Node\n(Draft JSON Schema Response)"]
    ComposeNode --> VerifyNode["5. Verify Node\n(Grounding & Evidence Check)"]
    VerifyNode --> END([END])
```

### 8.2 Execution Nodes & Workflow
1. **`prepareNode`**:
   - Loads complete session bundle (`loadSessionBundle`): session doc, dataset, forecast, assumptions, optimization, simulation.
   - Computes live SKU risk flags (`buildSessionRisk`).
   - Builds canonical Session Digest ($E_0$).
   - Executes semantic similarity search against Qdrant (`searchSession`) using the user's question, fetching up to 8 top hits plus SKU-specific chunks.
   - Encapsulates retrieved text within strict `<untrusted_data>` XML fences to mitigate prompt injection.
2. **`agentNode`**:
   - Invokes configured ChatModel (`gemini-1.5-pro`, `gpt-4o`, `claude-3-5-sonnet`, or `llama-3.3-70b-versatile`) with 5 bound analytical tools.
3. **`toolsNode`**:
   - Validates tool arguments against Zod schemas.
   - Enforces execution quotas: max 6 tool steps, max 8 total tool calls per conversation turn.
   - Dispatches tool handlers and appends raw results into the `EvidenceLedger` with unique evidence IDs ($E_1, E_2, \dots$).
4. **`composeNode`**:
   - Instructs the model to synthesize the final explanation formatted strictly as a single JSON object conforming to `AssistantDraft`.
   - Up to 3 retry attempts with error feedback if JSON validation fails.
5. **`verifyNode`**:
   - Executes `groundDraft` (`server/src/services/ai/grounding.js`): Verifies every key finding against the Evidence Ledger. If an ungrounded or fabricated number is detected, it is stripped and a warning is attached. Emits validated `AssistantResponse`.

### 8.3 Analytical Tools Reference

| Tool Name | Description | Key Inputs | Source Artifact |
| :--- | :--- | :--- | :--- |
| `get_sku_forecast` | Demand forecast, holdout accuracy, and prediction intervals for a SKU. | `skuId` (string) | `forecast_run` |
| `get_inventory_recommendation` | EOQ, deterministic ROP, and empirical ROP recommendations. | `skuId` (string) | `optimization_run` |
| `compare_inventory_policies` | Monte Carlo simulation comparison (costs, fill rate, stockout units). | `skuId` (optional string) | `simulation_run` |
| `run_what_if_scenario` | On-the-fly scenario execution under modified assumptions without altering session baseline. | `overrides` (holding cost, order cost, penalty, lead time, service level) | On-demand Python `/optimize` & `/simulate` calls |
| `get_inventory_risk_summary` | Portfolio-level SKU ranking by risk score or stockout frequency. | `rankBy`, `topN` (default 5) | Session risk evaluation |

### 8.4 Vector Search Infrastructure (`server/src/services/vector/`)
- **Store**: Qdrant Cloud collection `stockpilot_session_artifacts`.
- **Payload Indexing**: Four mandatory keyword payload indexes: `user_id`, `session_id`, `artifact_type`, and `sku_id`.
- **Isolation Guarantee**: All vector similarity queries apply strict must-match filtering on `user_id` and `session_id`. Cross-tenant retrieval is structurally impossible.
- **Artifact Chunks**: Summary documents generated for dataset characteristics, forecast backtest results, policy recommendations, and simulation outcomes (`server/src/services/vector/artifacts.js`). Raw numerical arrays are never embedded.

---

## 9. Supply Chain Algorithms and Business Logic

### 9.1 Data Cleansing & Missing Date Imputation
- Implemented in `server/src/services/datasetHandlers.js`.
- Daily sales aggregation: For each SKU $i$ and calendar date $t$:
  $$D_{i, t} = \sum_{k} \text{quantity}_{i, t, k}$$
- Zero-Imputation: For all calendar dates between the earliest recorded date $t_{\min}$ and dataset cutoff $t_{\max}$, unobserved days are explicitly assigned $D_{i, t} = 0$.
- Validation rules: Drops negative transactions (returns), rejects non-numeric quantities, validates ISO-8601 / common date formats, enforces a maximum of 15 SKUs per session.

### 9.2 Statistical Forecasting Engine (`stats-service/app/engine/forecasting.py`)
- **AutoETS**: Automatic error, trend, and seasonal state-space selection via `statsforecast.models.AutoETS(season_length=7)`. Point predictions are strictly clipped at zero: $\hat{y}_t = \max(0, \hat{y}_t)$.
- **SeasonalNaive**: Baseline repeating observed demand from 7 days prior: $\hat{y}_{t+h} = y_{t+h-7}$.
- **Rolling-Origin Residual Block Extraction**:
  - Requires minimum history $N \ge 112$ days.
  - Generates 8 origins spaced 7 days apart (`origin_step=7`, `block_size=7`).
  - Collects residual blocks: $e_{c:c+7} = y_{c:c+7} - \hat{y}_{c:c+7}$.
  - Computes residual standard deviation $\sigma_{\text{resid}} = \sqrt{\frac{1}{B \cdot b - 1} \sum e^2}$.

### 9.3 Forecast Evaluation (`stats-service/app/engine/evaluation.py`)
Evaluated over a 28-day holdout split ($H=28$ days). Training occurs strictly on $y_{0:N-H}$ (no data leakage):
- **Mean Absolute Error (MAE)**:
  $$\text{MAE} = \frac{1}{H} \sum_{t=1}^H |y_t - \hat{y}_t|$$
- **Root Mean Squared Error (RMSE)**:
  $$\text{RMSE} = \sqrt{\frac{1}{H} \sum_{t=1}^H (y_t - \hat{y}_t)^2}$$
- **Weighted Absolute Percentage Error (WAPE)**:
  $$\text{WAPE} = \frac{\sum_{t=1}^H |y_t - \hat{y}_t|}{\sum_{t=1}^H y_t}$$
- **Empirical Interval Coverage**:
  $$\text{Coverage} = \frac{1}{H} \sum_{t=1}^H \mathbf{1}\left(P_{10, t} \le y_t \le P_{90, t}\right) \quad (\text{Nominal: } 80\%)$$

### 9.4 Inventory Policy Optimization (`stats-service/app/engine/inventory.py`)
- **Annual Demand Projection**: Given average daily forecast $\bar{d} = \frac{1}{H} \sum_{t=1}^H \hat{y}_t$, annual demand is $D_{\text{annual}} = 365 \cdot \bar{d}$.
- **Annual Holding Cost**: $H_{\text{annual}} = 365 \cdot c_{h, \text{daily}}$.
- **Economic Order Quantity ($EOQ$)**:
  $$Q^* = \sqrt{\frac{2 \cdot K \cdot D_{\text{annual}}}{H_{\text{annual}}}}, \quad EOQ = \max\left(1, \lceil Q^* \rceil\right)$$
- **Deterministic Reorder Point ($ROP_{\text{det}}$)**:
  - Expected lead-time demand: $\mu_L = \sum_{t=1}^L \hat{y}_t$.
  - Lead-time error variance: $\sigma_L = \sigma_{\text{resid}} \sqrt{L}$.
  - Normal quantile: $z = \Phi^{-1}(\alpha)$.
  - Safety Stock: $SS_{\text{det}} = z \cdot \sigma_L$.
  - Reorder point: $ROP_{\text{det}} = \max\left(0, \lceil \mu_L + SS_{\text{det}} \rceil\right)$.
- **Uncertainty-Aware Empirical Reorder Point ($ROP_{\text{unc}}$)**:
  - Bootstraps 500 lead-time demand scenarios: $\{D_{L, b}\}_{b=1}^{500}$ where $D_{L, b} = \sum_{t=1}^L \tilde{D}_{t, b}$.
  - Empirical quantile selection using the `"higher"` method:
    $$ROP_{\text{unc}} = \max\left(0, \lceil \text{Quantile}_{\alpha}(\{D_{L, b}\}) \rceil\right)$$
  - Empirical Safety Stock: $SS_{\text{unc}} = ROP_{\text{unc, raw}} - \text{mean}(D_L)$.
  - Policy Gap: $\Delta_{ROP} = ROP_{\text{unc}} - ROP_{\text{det}}$.

### 9.5 Monte Carlo Simulation (`stats-service/app/engine/simulation.py`)
Executes daily discrete-event simulations across $N$ replications (default 500) over horizon $T$ (default 90 days).

**Daily Sequence for Day $t$**:
1. **Receive Shipments**: On-hand inventory increases by scheduled orders arriving on day $t$:
   $$I_t \leftarrow I_t + \text{Arrivals}_t, \quad \text{On-Order} \leftarrow \text{On-Order} - \text{Arrivals}_t$$
2. **Realize Stochastic Demand**: Sample daily demand $D_t$ from bootstrap trajectory.
3. **Fulfill Orders (Lost Sales Model)**:
   $$\text{Sold}_t = \min(I_t, D_t), \quad \text{Lost}_t = D_t - \text{Sold}_t, \quad I_{t+1} = I_t - \text{Sold}_t$$
4. **Replenishment Review**:
   $$\text{Inventory Position: } IP_t = I_{t+1} + \text{On-Order}$$
   If $IP_t \le s$:
   - Calculate batches needed: $n_{\text{batches}} = \lfloor \frac{s - IP_t}{Q} \rfloor + 1$.
   - Order quantity: $Q_{\text{order}} = n_{\text{batches}} \cdot Q$.
   - Schedule arrival for day $t + L + 1$.
   - Update: $\text{On-Order} \leftarrow \text{On-Order} + Q_{\text{order}}$.

**Paired Evaluation**: Both deterministic and uncertainty-aware policies are executed against the exact same seed-generated demand matrix, allowing paired t-test metrics and direct scenario-by-scenario cost difference analysis ($\Delta \text{Cost} = \text{Cost}_{\text{unc}} - \text{Cost}_{\text{det}}$).

---

## 10. API and Integration Documentation

### 10.1 Internal Stats Service API
The Python stats service exposes four core computation endpoints listening on `127.0.0.1:8000`:

#### `POST /forecast`
- **Request**: `ForecastRequest` containing list of SKU historical arrays and hyperparameters (`horizon`, `season_length`, `n_bootstrap`, `block_size`, `min_history`, `seed`).
- **Response**: `ForecastResponse` returning point forecasts, P10/P50/P90 intervals, residual blocks, and execution clock metadata.

#### `POST /evaluate`
- **Request**: Same input structure as `/forecast`.
- **Response**: `EvaluateResponse` returning holdout split backtest metrics (MAE, RMSE, WAPE, interval coverage) per SKU and pooled across portfolio.

#### `POST /optimize`
- **Request**: `OptimizeRequest` containing forecast mean arrays, residual blocks, residual standard deviations, and economic parameters (`ordering_cost`, `holding_cost_daily`, `shortage_penalty`, `lead_time_days`, `target_service_level`).
- **Response**: `OptimizeResponse` returning $EOQ$, deterministic $SS / ROP$, empirical quantile $SS / ROP$, lead-time demand skewness, and suitability warnings.

#### `POST /simulate`
- **Request**: `SimulateRequest` containing policy targets ($EOQ, ROP_{\text{det}}, ROP_{\text{unc}}$) and simulation bounds (`n_scenarios`, `horizon_days`).
- **Response**: `SimulateResponse` returning Monte Carlo cost distributions, stockout frequencies, fill rates, and paired scenario comparison metrics.

### 10.2 External Service Integrations
1. **Firebase Authentication**: Client communicates with Firebase SDK; server verifies tokens via Firebase Admin SDK (`firebase-admin/auth`).
2. **Qdrant Vector Database**: Server indexes session text summaries and executes semantic vector search using cosine distance over HTTP REST.
3. **LLM Providers**: Configurable via `LLM_PROVIDER`:
   - Google Gemini: `@langchain/google-genai` (`gemini-1.5-pro`).
   - OpenAI: `@langchain/openai` (`gpt-4o`).
   - Anthropic: `@langchain/anthropic` (`claude-3-5-sonnet-20241022`).
   - Groq: `@langchain/openai` routed to Groq baseURL (`llama-3.3-70b-versatile`).

---

## 11. Security and Reliability

### 11.1 Multi-Tenant Data Isolation
- **No Client Trust**: Client-supplied user IDs are completely ignored. User context is derived exclusively from the verified Firebase JWT.
- **Strict Query Scoping**: Every MongoDB operation filters by `{ userId }`.
- **Ownership Miss Handling**: Attempting to access an existing resource owned by another user returns HTTP 404 (`NOT_FOUND`), never 403 (`FORBIDDEN`), preventing resource existence probing.
- **Vector Isolation**: Qdrant queries apply hard payload filters on `user_id` and `session_id`.

### 11.2 Input Validation & Boundary Defense
- **Node.js**: Every HTTP request body, query parameter, and route parameter is validated using Zod with `strip()` behavior.
- **Python**: Every incoming request payload is validated using Pydantic `Strict` models with `extra="forbid"`.
- **File Upload Protection**: Max upload size capped at 60MB. CSV parsing checks for BOM markers, stream-limits processing to 600,000 rows, and rejects path traversal strings in filenames.

### 11.3 AI Safety & Prompt Injection Mitigation
- **Untrusted Data Isolation**: All database-retrieved text summaries, user-uploaded column headers, and SKU labels injected into model prompts are wrapped within `<untrusted_data>` XML delimiters.
- **Rule Enforcement**: System prompts explicitly command the model that text inside `<untrusted_data>` blocks represents data, not instructions.
- **Grounding Verification**: The `groundDraft` engine audits every numeric value in the model's output draft against the session's Evidence Ledger, stripping unverified figures.
- **Tool Concurrency Guards**: In-memory concurrency locks prevent users from executing overlapping What-If scenarios or concurrent AI message completions.

### 11.4 Logging Hygiene & Secret Redaction
- Authentication tokens, Firebase credentials, `STATS_SERVICE_KEY`, and AI provider API keys are strictly excluded from logging.
- Raw CSV transactional rows are never logged or stored in application log files.

---

## 12. Development Setup and Execution

### 12.1 Prerequisites
- **Node.js**: v20+ (tested on v26.10.0).
- **Python**: v3.11+ (tested on Python 3.11.7).
- **MongoDB**: v6.0+ local daemon or MongoDB Atlas cluster.
- **Firebase Project**: Project with Email/Password and Google Authentication enabled.
- **Qdrant**: (Optional) Qdrant Cloud or local Docker instance on port 6333.

### 12.2 Environment Configuration
Create `.env` inside `server/` (refer to `server/.env.example`):
```ini
PORT=5000
NODE_ENV=development
CORS_ORIGINS=http://localhost:5173
MONGO_URI=mongodb://localhost:27017/stockpilot
STATS_SERVICE_URL=http://127.0.0.1:8000
STATS_SERVICE_KEY=development-stats-secret-key-12345
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"

# Optional AI / Vector configurations
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-pro
LLM_API_KEY=your-gemini-api-key
EMBEDDING_PROVIDER=gemini
EMBEDDING_API_KEY=your-gemini-api-key
QDRANT_URL=http://localhost:6333
```

Create `.env` inside `stats-service/` (refer to `stats-service/.env.example`):
```ini
STATS_SERVICE_KEY=development-stats-secret-key-12345
LOG_LEVEL=INFO
```

Create `.env` inside `client/`:
```ini
VITE_API_BASE_URL=http://localhost:5000/api/v1
VITE_FIREBASE_API_KEY=your-firebase-web-api-key
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
```

### 12.3 Running the Services Locally

#### 1. Start Python Stats Service
```bash
cd stats-service
python -m venv .venv

# Windows Powershell
.\.venv\Scripts\Activate.ps1
# Linux / macOS
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
Verify health:
```bash
curl http://127.0.0.1:8000/health
```

#### 2. Start Node.js API Server
```bash
cd server
npm install
npm run dev
```
Verify health:
```bash
curl http://localhost:5000/api/v1/health
```

#### 3. Start React Client
```bash
cd client
npm install
npm run dev
```
Open browser at `http://localhost:5173`.

---

## 13. Testing and Quality

### 13.1 Testing Policy
In adherence to repository rules (`AGENTS.md` Rule 3), automated test files (`*.test.js`, `*.spec.ts`, vitest, jest, pytest) are deliberately omitted from the codebase.

### 13.2 Quality Verification Tooling
Code quality and type safety are verified via strict static analysis and compilation pipelines:
1. **Client Build Verification**:
   ```bash
   npm run --prefix client build
   ```
   Runs Vite production build, transforming modules, verifying JSX syntax, and producing optimized production bundles.
2. **Server Linting & Syntax Audit**:
   ```bash
   npm run --prefix server lint
   ```
   Executes ESLint across all server modules.
3. **Python Syntax & Bytecode Compilation**:
   ```bash
   python -m compileall stats-service/app
   ```
   Validates AST parsing, type hints, and bytecode compilation across the Python statistical package.
4. **Manual Acceptance Verification**:
   Follows the 10-point end-to-end verification checklist defined in `docs/VERIFY.md`.

---

## 14. Deployment and Infrastructure

### 14.1 Network Topology & Interface Binding
As documented in `docs/DEPLOYMENT_NOTES.md`:
- **Python Stats Service**: Must bind strictly to `127.0.0.1` or execute within a private VPC subnet. It must never be exposed to public ingress (`0.0.0.0`).
- **Qdrant Vector DB**: Bound to internal networks or secured via Qdrant Cloud API keys and IP allowlisting.
- **Node.js API Server**: The sole public ingress point handling TLS termination, CORS validation, rate limiting, and authentication.

### 14.2 Permanent Session Deletion Policy (`docs/DATA_HANDLING.md`)
Executing `DELETE /api/v1/sessions/:sessionId` permanently cascades across:
1. Qdrant vector database: Purges points filtered by `{ user_id, session_id }`.
2. Storage driver: Recursively deletes raw and processed CSV files under `storage/datasets/<userId>/<sessionId>`.
3. MongoDB: Deletes all records across 10 collections (`analysis_sessions`, `datasets`, `forecast_runs`, `assumption_sets`, `optimization_runs`, `simulation_runs`, `what_if_runs`, `jobs`, `ai_conversations`, `ai_messages`).

---

## 15. Technical Debt, Limitations, and Discrepancies

### 15.1 Architectural Discrepancies (Documentation vs. Implementation)
1. **Job Queue Engine**:
   - *Documentation Claim (`README.md`)*: States "BullMQ job queuing and Redis task coordination".
   - *Actual Codebase*: `bullmq` is not installed in `server/package.json`. Background processing is implemented via a custom in-process semaphore queue with MongoDB persistence in `server/src/services/jobRunner.js`.
2. **Forecasting Model Breadth**:
   - *Documentation Claim (`README.md`, `docs/METHODS.md`)*: Describes AutoARIMA, Croston/SBA, and Linear Regression with Calendar Features.
   - *Actual Codebase*: `stats-service/app/engine/forecasting.py` imports and evaluates exclusively `statsforecast.models.AutoETS` and `SeasonalNaive`. Croston and AutoARIMA are not invoked in the pipeline.
3. **Intermittent Demand Classification**:
   - *Documentation Claim (`docs/METHODS.md`)*: Details Syntetos-Boylan criteria ($ADI$ and $CV^2$) for smooth/erratic/intermittent/lumpy classification.
   - *Actual Codebase*: Classification thresholds are not actively wired into the pipeline; the engine issues a general warning if zero-demand days exceed 50%.

### 15.2 Supply Chain Domain Limitations
1. **No Unit Purchase Cost Tracking**: The platform tracks operational costs (ordering setup cost, daily holding cost, shortage penalty) but does not record unit procurement price ($c$). Consequently, capital inventory valuation ($I \cdot c$) and portfolio budget allocation are unavailable.
2. **Strict Lost-Sales Modeling**: Unfulfilled customer demand is discarded immediately. The system does not model backorders, partial backlog fulfillment, or customer brand switching.
3. **Deterministic Lead Time**: Lead time ($L$) is modeled as a fixed integer number of days. Supplier arrival variance (stochastic lead time) is not simulated.
4. **Scale Constraints**: Portfolio size is restricted to 15 SKUs per analysis session to bound in-memory simulation latency and API payload sizes.

### 15.3 Software Engineering Considerations
- **Client Bundle Size**: Production Vite build produces an un-split client bundle (`index-BzgpDQwI.js` ~1.17 MB) due to bundling Recharts and Lucide icons without route-based code splitting.
- **In-Memory Job Concurrency**: The in-process job queue cannot distribute tasks across multiple Node.js instances without upgrading to a shared Redis queue (BullMQ).

---

## 16. Roadmap and Strategic Improvement Opportunities

### 16.1 Supply Chain Domain Opportunities
- **Priority: High | Impact: High | Effort: Medium**
  - **Unit Purchasing Cost & Portfolio Budgeting**: Add `unit_cost` to SKU assumptions to unlock total working capital analytics, inventory turnover ratios, and capital-constrained knapsack order allocations.
  - **Stochastic Lead Times**: Extend Monte Carlo simulations to sample lead time from empirical or Gamma distributions: $L \sim \text{Dist}(\mu_L, \sigma_L)$.
- **Priority: Medium | Impact: High | Effort: Medium**
  - **Intermittent Demand Models**: Incorporate Croston Method and Syntetos-Boylan Approximation (SBA) from `statsforecast` into `forecasting.py` for sporadic, slow-moving spare parts.
  - **Backorder / Backlog Dynamics**: Implement configurable unfulfilled demand policies (lost sales vs. full backorder vs. partial backlog).

### 16.2 AI & Systems Engineering Opportunities
- **Priority: High | Impact: High | Effort: Low**
  - **Frontend Code Splitting**: Implement `React.lazy()` for session feature routes (`ForecastPage`, `OptimizationPage`, `SimulationPage`, `AskAiPage`) to reduce initial JS payload below 250 kB.
- **Priority: Medium | Impact: High | Effort: Medium**
  - **Streaming AI Responses (SSE)**: Enable Server-Sent Events for the LangGraph agent to stream tokens and tool execution traces incrementally to `ConversationPage`.
  - **Horizontal Worker Decoupling**: If horizontal autoscaling of Node.js is required, replace the in-process semaphore queue with BullMQ backed by Upstash Redis.
