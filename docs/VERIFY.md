# StockPilot AI Verification and Manual Acceptance Checklist

This document specifies manual acceptance verification procedures with exact expected numerical values taken from verified offline execution runs across the core functional stages.

## 1. Authentication and Tenant Isolation

- [ ] **Sign-in Flow**: Authenticate via Firebase Google Sign-In or email/password.
- [ ] **Bearer Token Propagation**: Confirm `Authorization: Bearer <token>` is present on outbound requests (`server/src/middlewares/auth.middleware.js`).
- [ ] **Ownership Miss (404)**: Query an unowned session (`GET /api/v1/sessions/:unownedId`). Confirm the server returns HTTP 404 `NOT_FOUND`, not 403, and never reveals resource existence.
- [ ] **Unauthenticated Request**: Query an endpoint without a Bearer token. Confirm HTTP 401 `UNAUTHORIZED`.

## 2. Ingestion and Demand Classification

- [ ] **Aggregation and Zero-Filling**:
  - Input: Contiguous transactional series grouped by SKU and day (`server/src/services/datasetHandlers.js`).
  - Expected Behavior: Daily demand is aggregated per UTC calendar day. Missing days between the first observed day and the dataset cutoff date are imputed as zero.
- [ ] **Quality Screening**:
  - Series with fewer than 28 distinct transaction days are flagged with `status: "insufficient_history"`.
- [ ] **Demand Classification (`stats-service/app/engine/classification.py:classify_demand`)**:
  - Cutoffs: $ADI_{\text{cutoff}} = 1.32$, $CV^2_{\text{cutoff}} = 0.49$.
  - **Verified Smooth Test Series**:
    - Input: 120 days, integer demand uniformly in $[8, 12]$.
    - Measured metrics: $ADI = 1.0000$, $CV^2 = 0.0185$.
    - Expected output: `demand_class: "smooth"`.
  - **Verified Intermittent Test Series**:
    - Input: 120 days, Bernoulli arrivals ($p \approx 0.3$) with demand in $[5, 10]$.
    - Measured metrics: $ADI = 2.7273$, $CV^2 = 0.0478$.
    - Expected output: `demand_class: "intermittent"`.
  - **Dataset Benchmark SKU `21755`**:
    - Historical observations: 365 days.
    - Measured metrics: $ADI = 3.5096$, $CV^2 = 0.8032$.
    - Expected output: `demand_class: "lumpy"`.

## 3. Multi-Model Rolling Backtest

- [ ] **Rolling-Origin Cross-Validation (`stats-service/app/engine/evaluation.py:evaluate_sku_rolling`)**:
  - Parameters: horizon $H = 28$, season length $m = 7$, folds = 8, origin_step = 28 (non-overlapping), min history = 56, seed = 42.
  - Model selection protocol: Select best model on folds 1–5 ranked by mean pinball loss (P10/P50/P90); report out-of-sample metrics on folds 6–8. Baseline models (`Naive` and `SeasonalNaive`) are baselines only and excluded from selection. For intermittent/lumpy series, if chosen forecast mean is 0 while last 90 days have non-zero demand, fall back to `CrostonSBA`.
  - Scale factor per origin: In-sample seasonal differences $\frac{1}{T-7} \sum_{t=8}^T |y_t - y_{t-7}|$.
- [ ] **Verified Expected Backtest Results (Dataset Benchmark SKU `21755`)**:
  - `AutoETS`: MAE = `0.8371`, RMSE = `1.0519`, WAPE = `5.8599`, MASE = `0.3124`, coverage = `1.0000`.
  - `SeasonalNaive`: MAE = `1.2857`, RMSE = `3.0000`, WAPE = `9.0000`, MASE = `0.4799`, coverage = `0.9524`.
  - `CrostonSBA`: MAE = `1.1503`, RMSE = `1.1769`, WAPE = `8.0519`, MASE = `0.4293`, coverage = `1.0000`.
  - `Naive`: MAE = `5.1429`, RMSE = `7.1714`, WAPE = `36.0000`, MASE = `1.9195`, coverage = `0.2857`.
  - Selection: `CrostonSBA` selected (ranked by pinball loss across folds 1–5; MASE improvement = `10.53%` vs SeasonalNaive).

## 4. Inventory Policy Optimization

- [ ] **Policy Parameter Computation (`stats-service/app/engine/inventory.py:optimize_sku`)**:
  - Cost inputs: unit cost $c = 40.50$, order cost $K = 50.0$, holding rate $h = 0.20$ ($h_{\text{annual}} = 8.10$), shortage cost $c_p = 81.0$, mean lead time $\bar{L} = 7$, lead time std $\sigma_L = 1.0$, target service level $\alpha = 0.95$, MOQ = 1, pack size = 1.
  - Formula for $s_{\text{quant}}$: $\sigma_{\text{LTD}, q} = \sqrt{\bar{L} \cdot \sigma_{d, \text{quant}}^2 + \mu_d^2 \cdot \sigma_L^2}$ where $\sigma_{d, \text{quant}} = (P90 - P10)/(2 \cdot 1.2816)$.
  - **Verified Benchmark SKU `21755` Parameter Outputs**:
    - Recommended order quantity $Q = 68$.
    - Policies: $s_{\text{det}} = 19$, $s_{\text{unc}} = 16$, $s_{\text{quant}} = 6$.

## 5. Discrete-Event Monte Carlo Simulation

- [ ] **Replication Event Flow (`stats-service/app/engine/simulation.py:simulate_policy`)**:
  - Parameters: 500 scenarios, horizon $H = 90$ days, warm-up = 30 days (discarded from all reported metrics), seed = 42.
  - Daily order of operations: delivery arrivals ($t + L + 1$) $\rightarrow$ demand fulfillment $\rightarrow$ ending holding cost $\rightarrow$ order review ($IP \le s$, order batches $b \cdot Q$).
  - Starting inventory: initialized at $s + Q$ when missing (never defaults to 0).
  - Cycle Service Level (CSL): an order is counted as stocked-out only if lost sales occur within its replenishment exposure window $(order\_day, arrival\_day]$.
  - `ltd_calibration`: proportion of fresh-path lead-time demand scenarios (independent seed stream) with $\text{LTD} \le s$.
  - Paired comparison: mean cost difference vs $s_{\text{det}}$ with 95% confidence interval ($1.96 \cdot \text{std} / \sqrt{n}$).
- [ ] **Verified Benchmark SKU `21755` Simulation Metrics**:
  - `deterministic` ($s_{\text{det}} = 19, Q = 68$): total cost = `820.43`, fill rate = `0.9518`, CSL = `0.6977`, `ltd_calibration` = `0.9940`.
  - `uncertainty_aware` ($s_{\text{emp}} = 16, Q = 68$): total cost = `1061.43`, fill rate = `0.9326`, CSL = `0.6423`, `ltd_calibration` = `0.9700`.
  - `quantile` ($s_{\text{quant}} = 6, Q = 68$): total cost = `1895.75`, fill rate = `0.8625`, CSL = `0.4767`, `ltd_calibration` = `0.5380`.

## 6. Historical Holdout Replay

- [ ] **Holdout Execution (`stats-service/app/engine/replay.py:replay_sku`)**:
  - Cutoff: Last 28 days held out. Fit strictly pre-cutoff ($T - 28$ days). Single pass against observed holdout demand with 30-day warm-up and $t+L+1$ arrival.
- [ ] **Verified Benchmark SKU `21755` Replay Results**:
  - `deterministic`: realized total cost = `2247.80`, realized fill rate = `0.4375`, CSL = `0.0000`, stockout days = `4`, lost units = `27.0`.
  - `uncertainty_aware`: realized total cost = `2247.80`, realized fill rate = `0.4375`, CSL = `0.0000`, stockout days = `4`, lost units = `27.0`.
  - `quantile`: realized total cost = `2247.80`, realized fill rate = `0.4375`, CSL = `0.0000`, stockout days = `4`, lost units = `27.0`.

## 7. Portfolio Optimization and Budget Allocation

- [ ] **Mixed-Integer Linear Program and Greedy Descent (`stats-service/app/portfolio.py`)**:
  - Greedy solver: descent from each SKU's unconstrained cost-minimizing level, repeatedly reducing the SKU with lowest marginal penalty per budget saved ($\Delta C / \Delta B$).
  - Binding constraint check: constraint is binding iff exact cost at $1.01 \cdot B$ is lower than at $B$ by more than $10^{-9}$.
  - Budget sweep: 6 evenly spaced budgets from minimum feasible to unconstrained investment.
- [ ] **Verified Benchmark Portfolio Allocation (`experiments/results/btp_report/portfolio_cost.csv`)**:
  - Unconstrained total investment = `15536.82`, unconstrained cost = `4792.64`, average service level = `0.9800`.
  - Constrained budget applied = `13206.29` (85% constraint).
  - Constrained total investment = `13166.97`, constrained cost = `7211.69`, average service level = `0.9160`.
  - Net cost delta = `2419.05`.
  - Binding constraints = `["budget"]`.
  - Budget shadow price = `-2.1281`.
- [ ] **Verified Budget Sweep Frontier (`experiments/results/btp_report/portfolio_budget_sweep.csv`)**:
  - 6/6 points feasible from minimum feasible budget (72%) to unconstrained (100%):
    - 72% (`11238.24`): exact cost = `14358.08`, greedy cost = `14076.41`, gap = `0.0000%`, shadow price = `-6.6960`, binding = `["budget"]`.
    - 78% (`12097.96`): exact cost = `10063.47`, greedy cost = `10436.31`, gap = `3.7049%`, shadow price = `-3.9441`, binding = `["budget"]`.
    - 83% (`12957.67`): exact cost = `7691.89`, greedy cost = `7691.89`, gap = `0.0000%`, shadow price = `-2.0101`, binding = `["budget"]`.
    - 89% (`13817.39`): exact cost = `6101.25`, greedy cost = `6103.51`, gap = `0.0371%`, shadow price = `-1.3926`, binding = `["budget"]`.
    - 94% (`14677.10`): exact cost = `5254.90`, greedy cost = `5254.90`, gap = `0.0000%`, shadow price = `-0.5588`, binding = `["budget"]`.
    - 100% (`15536.82`): exact cost = `4792.64`, greedy cost = `4792.64`, gap = `0.0000%`, shadow price = `-0.2722`, binding = `[]`.
- [ ] **Verified UCI Online Retail Benchmark (`experiments/results/uci_retail/`)**:
  - Eligible SKU count: 25.
  - Selected-model counts: `GlobalLGBM`: 14, `AutoETS`: 11 (GlobalLGBM participation = 56.0%).
  - `ltd_calibration`: `deterministic` = 0.8350, `uncertainty_aware` = 0.9468, `quantile` = 0.7186.
  - Greedy gap at 100% budget: 0.0000%.
  - Budget sweep points: 6/6 feasible (73% to 100% of ₹72,612.20 investment).

## 8. Synthetic Policy Validation (`experiments/results/validation.csv`)

- [ ] **Policy Validation Across Demand Regimes (Seed 42, $H=365$, $\bar{L}=7, \sigma_L=2, \alpha=0.95$)**:
  - **Poisson**: $s_{\text{det}}$ achieved CSL = `0.9145`, $s_{\text{quant}}$ = `0.9209`, $s_{\text{emp}}$ = `0.9209`.
  - **Lognormal-skewed**: $s_{\text{det}}$ = `0.9318`, $s_{\text{quant}}$ = `0.7847` (tail shortfall), $s_{\text{emp}}$ = `0.9457` (closest to nominal 0.95).
  - **Lumpy**: $s_{\text{det}}$ = `0.8753`, $s_{\text{quant}}$ = `0.3663` (severe tail under-coverage of $(P90-P10)/(2 \cdot 1.2816)$), $s_{\text{emp}}$ = `0.9149`.

## 9. Demand Dependency

- [ ] **Weekly Demand Correlation (`stats-service/app/engine/dependency.py:compute_dependency`)**:
  - Filter: Include only SKUs with $\ge 20$ non-zero demand weeks.
  - Aggregation: Sunday weekly resampling (`W-SUN`).
  - Correlation: Pearson correlation matrix $\mathbf{R}$ with diagonal 1.0.
  - Threshold: $|\rho| \ge 0.50$ classified as `complementary` ($\rho > 0$) or `substitute-like` ($\rho < 0$).
  - Risk pooling ratio: $\sqrt{\boldsymbol{\sigma}_{\text{weekly}}^T \mathbf{R} \boldsymbol{\sigma}_{\text{weekly}}} / \sum_i \sigma_{\text{weekly}, i}$ using weekly standard deviations $\sigma_{\text{weekly}} = \sigma_d \sqrt{7}$.
  - UCI Online Retail result: 29 pairs identified with $|\rho| \ge 0.50$; e.g. pair `(20728, 22383)` with $\rho = 0.7973$ (`complementary`), pooling ratio = 0.4840 across 25 SKUs.

## 10. AI Grounding Audit

- [ ] **Grounding Verification Rules (`server/src/services/ai/grounding.js`)**:
  - Claimed numbers in AI responses must match numbers registered in the `EvidenceLedger` within tolerance:
    $$\text{tol} = \max(0.005, |\text{actual}| \times 0.001)$$
  - Percentage values accept $100\times$ and $0.01\times$ factors.
  - Integer constants in $\{0, 1, 2, 3, 4, 5, 7, 10, 28, 50, 56, 90, 365, 500\}$ are accepted as `SAFE_INTS`.
  - Unmatched findings are dropped, and unverified numbers are listed in response warnings.
