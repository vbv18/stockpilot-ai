# StockPilot AI

StockPilot AI is a decision-support prototype for inventory demand forecasting, safety stock calculation, discrete-event Monte Carlo simulation, and working-capital portfolio allocation. It combines classical statistical time-series models, gradient-boosted quantile regressions, mathematical programming solvers, and a retrieval-augmented conversational AI assistant where numbers are checked against stored session results within a stated tolerance ($\pm 0.1\%$ or $0.005$ absolute).

---

## 1. Architecture Overview

StockPilot AI integrates four decoupled layers communicating across HTTP and schema boundaries:

```
+--------------------------------------------------------+
|                   React 19 Frontend                    |
|        JavaScript (ESM), Tailwind CSS, Recharts        |
+---------------------------+----------------------------+
                            | HTTP REST (Firebase JWT)
                            v
+--------------------------------------------------------+
|                  Node.js / Express API                 |
|     Express 5.3, MongoDB Job Queue, LangGraph RAG      |
+--------------------+-----------------------+------------+
                     | HTTP (X-Service-Key)  | Vector Search
                     v                       v
+---------------------------+ +--------------------------+
|   Python Stats Service    | |      Qdrant Database     |
| FastAPI, Statsforecast,   | | (Multi-Tenant Semantic   |
| LightGBM, SciPy MILP      | |   Payload Filtering)     |
+---------------------------+ +--------------------------+
```

- **Frontend (`client/`)**: React 19.3.1 application built with Vite 6.4.1, Tailwind CSS 4.3.5, and Recharts 3.8.0. Written in JavaScript (ESM). State and cache management via Redux Toolkit Query.
- **API Server (`server/`)**: Express 5.3.0 application running on Node.js 20+. Manages Firebase token verification, multi-tenant isolation, in-process MongoDB job queue (`JOB_CONCURRENCY=2`), Zod schema validation, and LangGraph conversational AI with an append-only `EvidenceLedger`.
- **Stats Service (`stats-service/`)**: Stateless FastAPI microservice running on Python 3.11+. Implements statistical and ML demand forecasting (AutoETS, Croston SBA, Seasonal Naive, Naive, Global LightGBM), policy optimization ($s_{\text{det}}, s_{\text{quant}}, s_{\text{emp}}, Q$), SciPy MILP portfolio allocation, and discrete-event Monte Carlo simulation.
- **Vector Database (`Qdrant`)**: Vector storage hosting chunked session artifacts, forecasting summaries, and policy documents for grounded semantic retrieval by Ask AI.

---

## 2. Prerequisites and Environment Setup

### System Prerequisites
- Node.js 20+
- Python 3.11+
- MongoDB 6+
- Firebase Project (for Authentication)
- Qdrant Cluster or local instance (optional, for Ask AI vector search)

### Recommended Startup Order
To avoid connection errors in the client, launch backend services before the frontend:
1. **Python Stats Service** (port `8001`)
2. **Node.js API Server** (port `8000`)
3. **React Client** (port `5173`)

### 2.1 Python Stats Service Setup (`stats-service/`)
```bash
cd stats-service
python -m venv .venv

# On Windows (PowerShell):
.\.venv\Scripts\Activate.ps1
# On Linux / macOS:
source .venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

### 2.2 Backend API Server Setup (`server/`)
```bash
cd server
npm install
# Ensure .env is populated with required configuration
npm run dev
```

### 2.3 Frontend Setup (`client/`)
```bash
cd client
npm install
npm run dev
```

---

## 3. Environment Variables Reference

### Backend Server (`server/.env`)

Verified against `server/src/config/env.js`:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Node.js API server port | `8000` |
| `NODE_ENV` | Application environment (`development`, `production`) | `development` |
| `LOG_LEVEL` | Logger verbosity (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) | `info` |
| `CORS_ORIGINS` | Allowed CORS origins (comma-separated) | `http://localhost:5173` |
| `MONGODB_URI` | MongoDB connection URI with database name | `mongodb://localhost:27017/stockpilot` |
| `STATS_SERVICE_URL` | Python stats microservice base URL | `http://localhost:8001` |
| `STATS_SERVICE_KEY` | Shared secret header (`X-Service-Key`, min 16 chars) | `change-me-to-a-long-random-string-min-16` |
| `STATS_TIMEOUT_MS` | Timeout for stats microservice HTTP calls (ms) | `900000` (15 minutes) |
| `STORAGE_DIR` | Local storage directory for dataset files | `./storage` |
| `UPLOAD_MAX_BYTES` | Maximum upload file size in bytes | `62914560` (60 MB) |
| `UPLOAD_MAX_ROWS` | Maximum rows parsed during file validation | `600000` |
| `JOB_CONCURRENCY` | Concurrent background jobs per server instance | `2` |
| `QDRANT_URL` | Qdrant vector database URL | `http://localhost:6333` |
| `QDRANT_API_KEY` | Qdrant authorization key | *(Optional)* |
| `LLM_PROVIDER` | LLM provider (`gemini`, `groq`, `openai`, `anthropic`) | *(Optional)* |
| `LLM_MODEL` | LLM model identifier | `llama-3.3-70b-versatile` |
| `LLM_API_KEY` | LLM provider API key | *(Optional)* |
| `LLM_TEMPERATURE` | Sampling temperature for AI generation | `0.1` |
| `LLM_MAX_OUTPUT_TOKENS`| Maximum output token limit for AI generation | `2048` |
| `EMBEDDING_PROVIDER` | Vector embedding provider (`gemini`, `groq`, `openai`) | *(Optional)* |
| `EMBEDDING_MODEL` | Vector embedding model identifier | `gemini-embedding-001` |
| `EMBEDDING_API_KEY` | Embedding provider API key | *(Optional)* |
| `EMBEDDING_DIM` | Embedding vector dimensions | `3072` |
| `RATE_LIMIT_GENERAL_PER_MINUTE` | General HTTP API rate limit per minute | `300` |
| `RATE_LIMIT_UPLOADS_PER_HOUR` | Dataset upload rate limit per hour | `10` |
| `RATE_LIMIT_AI_PER_MINUTE` | AI chat endpoint rate limit per minute | `20` |

### Python Stats Service (`stats-service/.env`)

Verified against `stats-service/app/config.py`:

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `STATS_SERVICE_KEY` | Shared secret header (`X-Service-Key`, min 16 chars) | `change-me-to-a-long-random-string-min-16` |
| `LOG_LEVEL` | Python logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) | `INFO` |

---

## 4. Run Commands

| Component | Development Command | Verification / Lint / Build Command |
| :--- | :--- | :--- |
| **Python Stats Service** | `uvicorn app.main:app --port 8001 --reload` | `python -m compileall stats-service/app` |
| **Node.js API Server** | `npm --prefix server run dev` | `npm --prefix server run lint` |
| **React Client** | `npm --prefix client run dev` | `npm --prefix client run build` |
| **Benchmark Experiments** | `python stats-service/experiments/run_experiments.py` | Generates CSVs and figures in `experiments/results/` |

---

## 5. Six-Step Demo Walkthrough

The following walkthrough outlines the end-to-end operation of StockPilot AI using real outputs produced by the numerical engine.

### Step 1: Ingestion and Daily Data Cleaning
- **Action**: Upload raw sales dataset (CSV/Excel) and map column headers (`skuColumn`, `dateColumn`, `quantityColumn`).
- **Processing**:
  - Aggregates multiple transactions within the same day into a single daily sum.
  - Pads missing intermediate calendar days with zero demand ($D_t = 0$).
  - Restricts analysis window to the latest 365 calendar days ($t_{\text{max}} - 364 \le t \le t_{\text{max}}$).
  - Categorizes demand patterns using Syntetos-Boylan criteria ($ADI$ cutoff 1.32, $CV^2$ cutoff 0.49).
- **Expected Output**:
  - `SKU_SMOOTH`: $ADI = 1.0000, CV^2 = 0.0185 \rightarrow \text{smooth}$.
  - `SKU_INT`: $ADI = 2.7273, CV^2 = 0.0478 \rightarrow \text{intermittent}$.

### Step 2: Multi-Model Demand Forecasting and Rolling Backtest
- **Action**: Trigger 8-origin rolling backtest across candidate models (AutoETS, Croston SBA, Seasonal Naive, Naive, Global LightGBM).
- **Processing**:
  - Evaluates models out-of-sample over 8 temporal folds spaced 7 days apart.
  - Scales MASE by in-sample 7-day seasonal differences.
  - Automatically selects model with lowest rolling MASE.
- **Expected Output**:
  - `SKU_SMOOTH`: Selected `AutoETS` (MASE `0.6478`, MAE `1.1735`, RMSE `1.3770`, WAPE `0.1173`, Coverage `0.6429`, +36.20% MASE improvement over Seasonal Naive `1.0153`).
  - `SKU_INT`: Selected `AutoETS` (MASE `1.1511`, MAE `2.6465`, +4.17% improvement over Seasonal Naive `1.2012`).

### Step 3: Operational Cost and Supply Assumptions
- **Action**: Set operational parameters per SKU.
- **Parameters**:
  - Unit purchase cost $c$, fixed order cost $K$, annual holding rate fraction $h$, shortage penalty $c_p$.
  - Supplier replenishment mean lead time $\bar{L}$ and standard deviation $\sigma_L$, minimum order quantity ($MOQ$), pack size ($P$), and target cycle service level $\alpha$.
- **Benchmark Input**:
  - `SKU_SMOOTH`: $c = 50.0, K = 100.0, h = 0.20, c_p = 30.0, \bar{L} = 7, \sigma_L = 1.5, MOQ = 10, P = 5, \alpha = 0.95$.
  - Dataset SKU `21755`: $c = 100.0, K = 200.0, h = 0.1825, c_p = 50.0, \bar{L} = 7, \sigma_L = 0.0, MOQ = 1, P = 1, \alpha = 0.95$.

### Step 4: Policy Optimization and Demand Dependency
- **Action**: Calculate continuous-review $(s, Q)$ parameters and evaluate SKU correlations.
- **Processing**:
  - Calculates $Q^*$ via EOQ, rounding to pack size multiples and enforcing MOQ.
  - Calculates $s_{\text{det}}$ assuming Gaussian lead-time demand: $\lceil \mu_L + z_\alpha \sigma_{\text{LTD}} \rceil$.
  - Calculates $s_{\text{quant}}$ from forecast interval spreads: $\lceil \mu_L + z_\alpha \sqrt{\bar{L} \sigma_{d, \text{quant}}^2 + \mu_d^2 \sigma_L^2} \rceil$.
  - Calculates $s_{\text{emp}}$ by sampling truncated normal lead times over bootstrap demand paths: $\lceil \text{Quantile}_\alpha(D_L) \rceil$.
  - Computes weekly Pearson correlation matrix and risk pooling ratio using weekly standard deviations $\sigma_d \sqrt{7}$.
- **Expected Output**:
  - SKU `21755`: $Q = 68$, $s_{\text{det}} = 19$, $s_{\text{quant}} = 6$, $s_{\text{emp}} = 16$.
  - Demand Dependency Pooling: Pooling ratio `0.4840` across 25 SKUs on UCI Online Retail with 29 significant pairs ($|\rho| \ge 0.50$).

### Step 5: Monte Carlo Policy Simulation and Holdout Replay
- **Action**: Simulate candidate policies over 500 stochastic scenarios (90 days with 30-day warm-up discarded) and replay on the 28-day historical holdout.
- **Processing**:
  - Runs $s_{\text{det}}, s_{\text{quant}}, s_{\text{emp}}$ across identical random demand paths and lead-time realizations with order arrival on day $t + L + 1$.
  - Measures fill rate, cycle service level (CSL: stockouts during $(order\_day, arrival\_day]$), lead-time demand calibration (`ltd_calibration`), and paired cost differences.
- **Expected Output**:
  - SKU `21755` Simulation: Deterministic cost `820.43` (fill rate 0.9518, CSL 0.6977, `ltd_calibration` 0.9940); Uncertainty-aware cost `1061.43` (fill rate 0.9326, CSL 0.6423, `ltd_calibration` 0.9700); Quantile cost `1895.75` (fill rate 0.8625, CSL 0.4767, `ltd_calibration` 0.5380).
  - SKU `21755` 28-Day Replay: Realized cost `2247.80`, realized fill rate `0.4375`, CSL `0.0000`, 4 stockout days, 27 lost units.

### Step 6: Multi-SKU Portfolio Optimization and Summary
- **Action**: Formulate working capital allocation as a Mixed-Integer Linear Program under budget and warehouse capacity limits, solved via exact MILP and greedy descent.
- **Processing**:
  - Generates discrete service-level curves across $\alpha \in [0.80, 0.98]$ (step 0.02).
  - Solves exact binary assignment problem via SciPy `milp` and greedy descent from unconstrained cost-minimizing levels.
  - Evaluates 6 evenly spaced budget sweep points from minimum feasible to unconstrained investment.
  - Estimates budget shadow price via central difference: $(C(1.01 B) - C(0.99 B)) / (0.02 B)$, verifying binding status iff cost delta $> 10^{-9}$.
- **Expected Output**:
  - Unconstrained Portfolio: Cost ₹4,792.64, investment ₹15,536.82, average service level 0.9800.
  - Constrained Portfolio (85% budget = ₹13,206.29): Optimal exact cost ₹7,211.69, investment ₹13,166.97, average service level 0.9160, cost delta +₹2,419.05.
  - Binding Constraints: `["budget"]`.
  - Budget Shadow Price: `-2.1281` (each ₹1 increase in working capital budget reduces operating costs by ₹2.13).
  - Greedy gap at 100% budget: `0.0000%` across 6/6 feasible sweep points.

---

## 6. Grounded AI Assistant (Ask AI)

StockPilot AI includes an AI assistant designed to discuss session findings:
- **LangGraph State Graph**: Manages conversational state, context synthesis, and deterministic tool execution.
- **Vector Retrieval**: Hybrid search over chunked session artifacts stored in Qdrant, filtered strictly by `sessionId` and `userId`.
- **Deterministic Tools**: Queries exact backtest metrics (`get_model_comparison`), inventory recommendations (`get_inventory_recommendation`), dependency pairs (`get_dependency_pairs`), and portfolio plans (`get_portfolio_plan`).
- **Numerical Grounding**: Every numeric claim in generated answers is audited against an append-only `EvidenceLedger` using tolerance rule $|v_{\text{claimed}} - v_{\text{actual}}| \le \max(0.005, |v_{\text{actual}}| \times 0.001)$. Unmatched numbers are stripped or flagged before display.

---

## 7. Troubleshooting

### 1. Google OAuth Popup Closes Immediately or Fails
- **Cause**: Browser Cross-Origin-Opener-Policy (COOP) blocks popup postMessage communication.
- **Fix**: Verify `crossOriginOpenerPolicy: false` in `server/server.js` Helmet configuration, and ensure COOP is omitted from `client/vite.config.js`.

### 2. Upstream Stats Service Timeout (`UPSTREAM_STATS_ERROR`)
- **Cause**: Fitting large panel LightGBM models or 8-origin rolling AutoETS backtests across numerous SKUs exceeds HTTP client timeout.
- **Fix**: Increase `STATS_TIMEOUT_MS` in `server/.env` (default is `900000`, 15 minutes). Note that Undici dispatcher in `statsClient.js` sets `headersTimeout: 0` and `bodyTimeout: 0` so only `STATS_TIMEOUT_MS` limits duration.

### 3. Zod Validation Error on Python Microservice Payloads
- **Cause**: Passing raw Mongoose document instances containing internal fields (`$__parent`, `_doc`) to strict Zod boundary schemas.
- **Fix**: Ensure background job handlers (`optimizationHandlers.js`, `simulationHandlers.js`, `replayHandlers.js`) use `.lean()` when fetching MongoDB documents before passing them to Python request builders.

### 4. Client Refetch Fails on Unrun Stages
- **Cause**: Calling `refetch()` on an uninitialized RTK Query endpoint.
- **Fix**: Endpoints for progression stages (`/forecast`, `/optimization`, `/simulations`) return HTTP 200 `{ "data": null }` when unrun, allowing frontend queries to initialize subscriptions on mount without `skip`.

---

## 8. Documentation Index

- [docs/REPO_MAP.md](docs/REPO_MAP.md): Repository structure, exact package versions, and module dependencies.
- [docs/METHODS.md](docs/METHODS.md): Mathematical formula catalog, symbol table, worked examples, assumptions, and known deviations.
- [docs/API.md](docs/API.md): Complete REST endpoint specifications, state machine rules, and Node-to-Python microservice schemas.
- [docs/DATA_HANDLING.md](docs/DATA_HANDLING.md): Ingestion parsing, zero imputation, and 7-step cascading session deletion.
- [docs/DEPLOYMENT_NOTES.md](docs/DEPLOYMENT_NOTES.md): Architecture topology, interface binding, job runner concurrency, and startup recovery.
- [docs/EXPERIMENTS.md](docs/EXPERIMENTS.md): Offline benchmark execution commands, output CSV column definitions, and figure descriptions.
- [docs/VERIFY.md](docs/VERIFY.md): Acceptance testing checklist and verified numerical values from real executions.
