# StockPilot AI

StockPilot AI is an enterprise-grade inventory forecasting, policy optimization, and Monte Carlo simulation platform powered by Python statistical engines, Node.js API services, modern React frontend, and an intelligent LangGraph retrieval-augmented AI assistant.

---

## 1. Architecture Overview

StockPilot AI combines deterministic statistical algorithms with modern agentic AI to provide explainable, mathematically rigorous inventory planning:

```
┌────────────────────────────────────────────────────────┐
│                   React 19 Frontend                    │
│            (Tailwind CSS, Lucide, Recharts)            │
└───────────────────────────┬────────────────────────────┘
                            │ HTTP / JSON (REST)
                            ▼
┌────────────────────────────────────────────────────────┐
│                  Node.js / Express API                 │
│      (Auth, BullMQ Jobs, Mongo ODM, Rate Limits)       │
└────────────┬─────────────────────────────┬─────────────┘
             │ HTTP (X-Service-Key)        │ Vector Search / RAG
             ▼                             ▼
┌───────────────────────────┐ ┌──────────────────────────┐
│   Python Stats Service    │ │      Qdrant Cloud        │
│  (FastAPI, Statsforecast, │ │  (Vector Index, Semantic │
│  NumPy, SciPy Simulation) │ │   Payload Filtering)     │
└───────────────────────────┘ └──────────────────────────┘
```

- **Frontend (`client/`)**: Modern React 19 application built with Vite, Tailwind CSS, Lucide icons, and Recharts. Connects to backend with authenticated Axios and RTK Query hooks.
- **API Server (`server/`)**: Express.js server providing authentication verification (Firebase Admin), multi-tenant isolation, BullMQ job queuing, rate limiting, and LangGraph agent orchestration.
- **Stats Service (`stats-service/`)**: Dedicated Python 3.11+ FastAPI service implementing statistical demand forecasting (AutoARIMA, ETS, Croston/SBA, Seasonal Naive, Linear Regression) and Monte Carlo bootstrap discrete-event simulations.
- **Vector Search (`Qdrant`)**: Vector database hosting chunked session artifacts, forecasting summaries, and policy documents for grounded semantic retrieval by the Ask AI assistant.

---

## 2. Quickstart & Setup

### Prerequisites
- Node.js 20+
- Python 3.11+
- MongoDB 6+
- Redis 7+ (or Upstash Redis)
- Firebase Project (for Authentication)
- Qdrant Cluster (optional, for Ask AI vector search)

### 2.1 Backend Setup (`server/`)
```bash
cd server
npm install
cp ../.env.example .env # configure your environment variables
npm run dev
```

### 2.2 Stats Engine Setup (`stats-service/`)
```bash
cd stats-service
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

### 2.3 Frontend Setup (`client/`)
```bash
cd client
npm install
npm run dev
```

---

## 3. Environment Variables Reference

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `PORT` | Node.js API server port | `5000` |
| `NODE_ENV` | Application environment | `development` |
| `CLIENT_ORIGIN` | Allowed CORS origin | `http://localhost:5173` |
| `MONGO_URI` | MongoDB connection string | `mongodb://localhost:27017/stockpilot` |
| `REDIS_URL` | Redis connection URI | `redis://localhost:6379` |
| `STORAGE_DRIVER` | File storage driver (`local` or `s3`) | `local` |
| `LOCAL_STORAGE_DIR` | Directory for local file storage | `./storage` |
| `STATS_SERVICE_URL` | Python stats service URL | `http://127.0.0.1:8000` |
| `STATS_SERVICE_KEY` | Shared secret for Python service | `secret-key-1234` |
| `FIREBASE_PROJECT_ID` | Firebase Project ID | `stockpilot-ai-prod` |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email | `admin@stockpilot.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key | `-----BEGIN PRIVATE KEY...` |
| `QDRANT_URL` | Qdrant endpoint | `https://xxxx.cloud.qdrant.io:6333` |
| `QDRANT_API_KEY` | Qdrant authentication API key | `qdrant-secret-key` |
| `QDRANT_COLLECTION` | Qdrant collection name | `stockpilot_artifacts` |
| `EMBEDDING_PROVIDER` | Embeddings provider (`gemini` or `openai`) | `gemini` |
| `EMBEDDING_MODEL` | Embedding model identifier | `text-embedding-004` |
| `EMBEDDING_API_KEY` | Embedding provider API key | `ai-embedding-key` |
| `EMBEDDING_DIM` | Embedding vector dimension | `768` |
| `LLM_PROVIDER` | LLM provider (`gemini` or `openai`) | `gemini` |
| `LLM_MODEL` | LLM model identifier | `gemini-1.5-pro` |
| `LLM_API_KEY` | LLM provider API key | `ai-llm-key` |
| `RATE_LIMIT_GENERAL_PER_MINUTE` | General API rate limit | `120` |
| `RATE_LIMIT_UPLOADS_PER_HOUR` | Upload rate limit per user | `10` |
| `RATE_LIMIT_AI_PER_MINUTE` | AI assistant rate limit per user | `20` |

---

## 4. Dataset Preparation & Format

StockPilot AI processes standard transactional or sales records. Uploaded files can be formatted as CSV or Excel (`.xlsx`).

### Expected Columns
- `date`: Calendar date of sale or consumption (`YYYY-MM-DD` or standard datetime).
- `sku`: Product identifier / SKU code (e.g., `SKU-10023`, `85123A`).
- `quantity`: Number of units sold or demanded on that date (positive integers/floats).

### UCI Online Retail Mapping
If using the open UCI Online Retail dataset:
- Map `InvoiceDate` $\rightarrow$ `date`
- Map `StockCode` $\rightarrow$ `sku`
- Map `Quantity` $\rightarrow$ `quantity` (filter out cancellation rows where `Quantity < 0`).

---

## 5. Methodological Summary

- **Demand Intermittency**: Syntetos-Boylan classification ($ADI$ and $CV^2$) to categorize items into Smooth, Intermittent, Erratic, or Lumpy demand streams.
- **Forecasting**: Backtested model evaluation across AutoARIMA, ETS, Croston/SBA, Seasonal Naive, and Linear Regression with calendar regressors, selecting the optimal model per SKU based on WAPE/RMSE.
- **Policy Optimization**:
  - Economic Order Quantity ($Q^*$): Balancing ordering costs and holding costs.
  - Lead-Time Demand Parameters ($\mu_L$, $\sigma_L$): Incorporating stochastic demand and lead-time variability.
  - Reorder Point ($s$): Calculated analytically ($s = \mu_L + z \sigma_L$) or empirically from non-parametric demand quantiles.
- **Monte Carlo Simulation**: 1,000 replications over 90 days resampled from empirical forecast residuals to simulate lead-time stockouts, fill rates, cycle service levels, and cost distributions under continuous review $(s, Q)$ policies.
- **Grounded AI Assistant**: LangGraph-driven conversational assistant with vector retrieval over session artifacts and structured tool calls to inspect SKU policies and simulation risks.

---

## 6. System Limitations

- **Historical Horizon**: Requires at least 14 days of historical transactions per SKU to compute reliable demand statistics and train forecasting models.
- **Calendar Support**: Demand forecasting operates on daily calendar buckets. Sub-daily (hourly) intervals are aggregated to daily totals during ingestion.
- **Lead-Time Scope**: Assumes replenishment orders are fulfilled sequentially (no order crossover unless modeled by lead-time variance).
- **Graceful AI Degradation**: The Ask AI assistant requires valid LLM and vector store API credentials; however, all core statistical forecasting, optimization, and Monte Carlo simulations operate deterministically without requiring any external AI provider.

---

## 7. Documentation Directory

- [API Reference](file:///C:/peep-it/stockpilot-ai/docs/API.md): Comprehensive endpoint specifications, request/response envelopes, and state machine transition rules.
- [Statistical Methods](file:///C:/peep-it/stockpilot-ai/docs/METHODS.md): Detailed mathematical formulas, metrics, and simulation algorithms.
- [Data Handling & Deletion](file:///C:/peep-it/stockpilot-ai/docs/DATA_HANDLING.md): Session deletion cascading, storage cleanup, and privacy policies.
- [Deployment & Security](file:///C:/peep-it/stockpilot-ai/docs/DEPLOYMENT_NOTES.md): Private interface binding, network boundaries, and multi-tenant security architecture.
- [Verification Checklist](file:///C:/peep-it/stockpilot-ai/docs/VERIFY.md): Step-by-step manual acceptance testing checklist across all 10 PRD functional areas.
