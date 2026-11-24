# Mathematical and Methodological Specification

This document provides the mathematical formulas, algorithms, parameters, edge-case behaviors, and execution details for StockPilot AI. All specifications reflect the implementation in `stats-service/app/engine/*.py`, `stats-service/app/portfolio.py`, and `server/src/services/*.js`.

---

## 1. Notation and Symbol Table

| Symbol | Meaning | Unit | Code Variable Name |
| :--- | :--- | :--- | :--- |
| $\bar{L}$ | Mean replenishment lead time | Days | `lead_time_mean` / `lead` |
| $\sigma_L$ | Standard deviation of lead time | Days | `lead_time_std` |
| $\mu_{\text{LTD}}$ | Mean lead-time demand | Units | `mu_l` / `ltd.mean` |
| $\sigma_{\text{LTD}}$ | Standard deviation of lead-time demand | Units | `sigma_l` / `ltd.std` |
| $\sigma_d$ | Daily forecast-error standard deviation | Units/day | `residual_std` / `sigma_d` |
| $\alpha$ | Target cycle service level (non-stockout probability per cycle) | Dimensionless $[0, 1]$ | `service_level` / `target_service_level` |
| $K$ | Fixed order placement cost per order | Currency (₹) | `order_cost` / `ordering_cost` |
| $c$ | Unit purchase or procurement cost | Currency (₹)/unit | `unit_cost` |
| $h$ | Annual holding cost fraction of unit cost (or absolute rate) | 1/year | `holding_rate` |
| $c_p$ | Shortage penalty cost per unfulfilled unit | Currency (₹)/unit | `shortage_cost` / `shortage_penalty` |
| $Q$ | Replenishment order batch quantity | Units | `eoq` / `q` |
| $s$ | Reorder point | Units | `rop` / `rop_det` / `rop_emp` / `rop_q` |
| $IP$ | Inventory position ($I + \text{on\_order}$) | Units | `position` |
| $H$ | Planning or forecast horizon | Days | `horizon` / `horizon_days` |
| $D_{\text{annual}}$ | Annualized expected demand | Units/year | `annual` / `annual_demand` |
| $\bar{d}$ | Average daily forecast demand over horizon | Units/day | `avg_daily` / `avg_daily_forecast` |
| $z_\alpha$ | Standard normal quantile $\Phi^{-1}(\alpha)$ | Dimensionless | `z` |
| $SS$ | Safety stock buffer | Units | `ss_det` / `ss_emp` / `ss_quant` |
| $I_t$ | On-hand physical inventory at end of day $t$ | Units | `on_hand` |
| $B$ | Total working capital / inventory investment budget | Currency (₹) | `budget` |
| $C$ | Total warehouse unit capacity limit | Units | `capacity` |

---

## 2. Core Methodology and Formula Catalog

### Method 1: Daily Aggregation and Zero Imputation
- **Purpose**: Transform irregular transaction events into an unbroken daily time series per SKU.
- **Symbols**: $D_{i, t}$ (aggregated demand), $q_{i, t, k}$ (transaction line item quantity), $t \in [t_{\text{first}}, t_{\text{max}}]$.
- **Formula as Implemented**:
  $$D_{i, t} = \sum_{k} q_{i, t, k} \quad \text{for dates with transactions}$$
  $$D_{i, t} = 0 \quad \text{for calendar dates } t \in [t_{\text{first}, i}, t_{\text{max}}] \text{ without transactions}$$
- **Code Reference**: `server/src/services/datasetHandlers.js:registerJobHandler("validation")`, `registerJobHandler("transformation")`.
- **Parameters and Defaults**:
  - `seriesStart`: `"first_observed_date_per_sku"`.
  - `seriesEnd`: `"dataset_max_date"`.
  - `negativeQuantityPolicy`: `"drop"` (default, treats returns as invalid demand) or `"reject"`.
- **Inputs and Outputs**:
  - Input: Raw CSV rows `(sku, date, quantity)`.
  - Output: Dense daily time series `processed.csv` formatted with up to 4 decimal places.
- **Edge Cases**: Days prior to the first transaction for SKU $i$ are not padded. Missing intermediate dates within $[t_{\text{first}, i}, t_{\text{max}}]$ are imputed with `0.0`.
- **Worked Example**:
  Raw transactions: `(2024-01-01, 10)`, `(2024-01-03, 5)`.
  Padded output: `2024-01-01: 10.0`, `2024-01-02: 0.0`, `2024-01-03: 5.0`.
- **Why This Method**: Discrete-event inventory simulation and rolling forecasting require a continuous calendar grid without unrecorded days.

---

### Method 2: 365-Day Windowing
- **Purpose**: Restrict historical training and analysis to the most recent 365 calendar days of data.
- **Symbols**: $t_{\text{max}}$ (dataset max day index), $t_{\text{window\_start}} = t_{\text{max}} - 364$.
- **Formula as Implemented**:
  $$\mathcal{T}_{\text{window}} = \{t \in \mathbb{Z} \mid t_{\text{max}} - 364 \le t \le t_{\text{max}}\}$$
- **Code Reference**: `server/src/services/datasetHandlers.js:registerJobHandler("transformation")`.
- **Parameters and Defaults**: `WINDOW_DAYS = 365`.
- **Inputs and Outputs**: Filtered day indices $[t_{\text{max}} - 364, t_{\text{max}}]$.
- **Edge Cases**: If total observed dataset span is less than 365 days, all available history from $t_{\text{first}}$ is retained.
- **Worked Example**: For $t_{\text{max}} = 19723$ (2024-01-01), window start day is $19723 - 364 = 19359$ (2023-01-03).
- **Why This Method**: Focuses policy parameters on recent demand patterns while bounding processing memory.

---

### Method 3: Dataset Screening and History Validation
- **Purpose**: Verify that series have adequate length and non-zero volume for statistical evaluation.
- **Symbols**: $N_i$ (calendar days of history), $Y_i = \sum_{t=1}^{N_i} D_{i, t}$.
- **Formula as Implemented**:
  $$\text{status}_i = \begin{cases} \text{"ok"} & \text{if } N_i \ge 28 \text{ and } Y_i > 0 \\ \text{"insufficient\_history"} & \text{if } N_i < 28 \\ \text{"no\_demand"} & \text{if } Y_i \le 0 \end{cases}$$
  For 8-fold rolling backtest execution in `stats-service`: requires $N_i \ge \text{min\_history} + 8 \times \text{origin\_step} = 56 + 56 = 112$ days.
- **Code Reference**: `server/src/services/datasetHandlers.js:registerJobHandler("transformation")`, `stats-service/app/engine/forecasting.py:fit_sku`.
- **Parameters and Defaults**: `min_history = 56`, `origin_step = 7`, `dataset_min_history = 28`.
- **Inputs and Outputs**: SKU status string (`"ok"`, `"insufficient_history"`, `"no_demand"`).
- **Edge Cases**: All-zero demand produces status `"no_demand"`; short series bypass rolling evaluation.
- **Worked Example**: SKU with 100 days of history returns `"insufficient_history"` for 8-fold evaluation in stats-service (requires 112 days).
- **Why This Method**: Prevents backtest failures caused by evaluating models without enough initialization history.

---

### Method 4: ADI / CV² Demand Classification
- **Purpose**: Classify demand series into Syntetos-Boylan (2005) quadrants to guide modeling.
- **Symbols**: $ADI$ (Average Demand Interval), $CV^2$ (squared coefficient of variation of non-zero sizes).
- **Formula as Implemented**:
  $$ADI = \frac{N}{k}, \quad k = \sum_{t=1}^N \mathbf{1}(D_t > 0)$$
  $$CV^2 = \left( \frac{s_{\text{nonzero}}}{\bar{D}_{\text{nonzero}}} \right)^2, \quad s_{\text{nonzero}} = \sqrt{\frac{1}{k - 1} \sum_{D_t > 0} (D_t - \bar{D}_{\text{nonzero}})^2}$$
  - **Smooth**: $ADI < 1.32$ and $CV^2 < 0.49$
  - **Erratic**: $ADI < 1.32$ and $CV^2 \ge 0.49$
  - **Intermittent**: $ADI \ge 1.32$ and $CV^2 < 0.49$
  - **Lumpy**: $ADI \ge 1.32$ and $CV^2 \ge 0.49$
- **Code Reference**: `stats-service/app/engine/classification.py:classify_demand`.
- **Parameters and Defaults**: `ADI_CUTOFF = 1.32`, `CV2_CUTOFF = 0.49`.
- **Inputs and Outputs**: Input array $y \in \mathbb{R}^N$. Output tuple: `(demand_class, adi, cv2)`.
- **Edge Cases**: If $k = 0$ (all zeros): $ADI = N, CV^2 = 0.0 \rightarrow$ intermittent/lumpy. If $k = 1$: $s_{\text{nonzero}} = 0 \rightarrow CV^2 = 0.0$.
- **Worked Example**:
  - `SKU_SMOOTH` ($N=200$, non-zeros 200): $ADI = 1.0000, CV^2 = 0.0185 \rightarrow \text{smooth}$.
  - `SKU_INT` ($N=200$, non-zeros 55): $ADI = 2.7273, CV^2 = 0.0478 \rightarrow \text{intermittent}$.
- **Why This Method**: Distinguishes regular demand from intermittent patterns requiring specialized estimation.

---

### Method 5: Naive Model
- **Purpose**: Serve as a non-seasonal baseline replicating the last observed value.
- **Symbols**: $\hat{y}_{t+h}$ (forecast), $y_t$ (most recent observation).
- **Formula as Implemented**:
  $$\hat{y}_{t+h} = \max(0.0, y_t) \quad \forall h \in \{1, \dots, H\}$$
- **Code Reference**: `stats-service/app/engine/forecasting.py:naive_last`.
- **Parameters and Defaults**: Horizon $h = 28$.
- **Inputs and Outputs**: Input 1-D array $y$. Output 1-D array of shape $(h,)$.
- **Edge Cases**: If length of $y$ is 0, returns array of zeros.
- **Worked Example**: For $y = [10, 12, 11]$, $h = 3 \rightarrow \hat{y} = [11.0, 11.0, 11.0]$.
- **Why This Method**: Standard naive baseline for calculating improvement metrics.

---

### Method 6: Seasonal Naive Model
- **Purpose**: Baseline capturing weekly seasonality by repeating values from the same day of the prior week.
- **Symbols**: $m$ (seasonal period, default 7), $h$ (forecast step).
- **Formula as Implemented**:
  $$\hat{y}_{t+h} = \max(0.0, y_{t + h - m \cdot \lceil h / m \rceil})$$
- **Code Reference**: `stats-service/app/engine/forecasting.py:fit_predict(SeasonalNaive, ...)` via `statsforecast.models.SeasonalNaive`.
- **Parameters and Defaults**: `season_length = 7`.
- **Inputs and Outputs**: Input $y \in \mathbb{R}^N$. Output $\hat{y} \in \mathbb{R}^H$, clipped at $0.0$.
- **Edge Cases**: If fit fails, falls back to naive last observation.
- **Worked Example**: On `SKU_SMOOTH`, 8-origin rolling MASE = `1.0153`, MAE = `1.8393`.
- **Why This Method**: Primary competitive benchmark for day-of-week retail patterns.

---

### Method 7: AutoETS (Exponential Smoothing)
- **Purpose**: Fit automated state-space error-trend-seasonal models.
- **Symbols**: State space components $(l_t, b_t, s_t)$.
- **Formula as Implemented**:
  Selects optimal model formulation (additive/multiplicative) via information criterion using `statsforecast.models.AutoETS`.
  $$\hat{y}_{t+h} = \max(0.0, \mu_{t+h})$$
- **Code Reference**: `stats-service/app/engine/forecasting.py:fit_predict(AutoETS, ...)`.
- **Parameters and Defaults**: `season_length = 7`.
- **Inputs and Outputs**: Input $y \in \mathbb{R}^N$. Output point forecast array $\hat{y} \in \mathbb{R}^H$ clipped at 0.
- **Edge Cases**: Non-finite predictions raise a `ValueError` caught by caller.
- **Worked Example**: On `SKU_SMOOTH`, selected spec `MAM`, 8-origin rolling MASE = `0.6478`, MAE = `1.1735`, RMSE = `1.3770`, WAPE = `0.1173`.
- **Why This Method**: Captures smooth trends and evolving weekly seasonal patterns.

---

### Method 8: Croston SBA (Syntetos-Boylan Approximation)
- **Purpose**: Forecast intermittent demand by separating demand size from inter-arrival interval.
- **Symbols**: $\hat{z}_t$ (smoothed size), $\hat{p}_t$ (smoothed interval), $\alpha_0$ (smoothing parameter).
- **Formula as Implemented**:
  $$\hat{y}_{\text{SBA}} = \left( 1 - \frac{\alpha_0}{2} \right) \frac{\hat{z}_t}{\hat{p}_t}, \quad \alpha_0 = 0.1$$
- **Code Reference**: `stats-service/app/engine/intermittent.py:fit_predict_croston` via `statsforecast.models.CrostonSBA`.
- **Parameters and Defaults**: Default internal smoothing parameter $\alpha_0 = 0.1$.
- **Inputs and Outputs**: Input array $y \in \mathbb{R}^N$. Output flat point forecast $\hat{y} \in \mathbb{R}^H$.
- **Edge Cases**: All non-zero demand series can still be fit; zero demand series filtered upstream.
- **Worked Example**: On `SKU_INT`, flat mean forecast = `2.7422` units/day across 28-day horizon; 8-origin MASE = `1.1605`.
- **Why This Method**: Removes the positive bias present in standard Croston method for intermittent items.

---

### Method 9: Global Quantile LightGBM
- **Purpose**: Cross-sectional gradient boosting model generating direct multi-quantile forecasts.
- **Symbols**: Features $X_t$, target quantiles $\tau \in \{0.1, 0.5, 0.9\}$.
- **Formula as Implemented**:
  Objective: Pinball loss $L_\tau(y, \hat{y}) = \max(\tau(y - \hat{y}), (1 - \tau)(\hat{y} - y))$.
  Recursive multi-step forecasting: for $h=1 \dots H$, step predictions use P50 feedback for lag features.
  Post-processing monotonic sort and zero clipping:
  $$p10 = \max(0.0, \hat{y}_{0.1}), \quad p50 = \max(p10, \hat{y}_{0.5}), \quad p90 = \max(p50, \hat{y}_{0.9})$$
- **Code Reference**: `stats-service/app/engine/global_lgbm.py:fit_predict_global_quantile`.
- **Parameters and Defaults**:
  `n_estimators = 150`, `learning_rate = 0.05`, `num_leaves = 15`,
  `min_child_samples = max(1, min(20, n_samples // 2))`, `n_jobs = 2`, `seed = int(derive_seed(...) % 2147483647)`.
  Features: `sku_code`, `dow`, `sin_dow`, `cos_dow`, `sin_doy`, `cos_doy`, `lag_1`, `lag_7`, `lag_14`, `roll_mean_7`, `roll_mean_28`, `sku_mean`, `sku_std`, `sku_zero_ratio`.
- **Inputs and Outputs**: Input panel DataFrame `[sku_id, date, y]`. Output `{sku_id: {"p10": array, "p50": array, "p90": array}}`.
- **Edge Cases**: If panel contains insufficient samples or OpenMP exceptions arise, falls back to SeasonalNaive.
- **Worked Example**: Produces direct non-crossing quantile bounds $p10 \le p50 \le p90$ over 28-day horizon.
- **Why This Method**: Learns shared demand structure across multiple series while producing asymmetric interval bands.

---

### Method 10: Rolling-Origin Backtesting Folds
- **Purpose**: Evaluate out-of-sample forecasting performance across multiple temporal origins.
- **Symbols**: $n$ (series length), $c$ (training cutoff index), $K$ (number of folds, default 8).
- **Formula as Implemented**:
  Cutoffs generated backwards from end of series using non-overlapping steps of 28 days:
  $$c_k = (n - \text{block\_size}) - k \cdot \text{origin\_step} \quad \text{for } c_k \ge \text{min\_history}$$
  The sequence is reversed so cutoffs are evaluated in chronological order.
  Folds 1–5 are tagged with `used_for_selection: true` and utilized for model selection.
  Folds 6–8 are tagged with `used_for_selection: false` and utilized for out-of-sample reporting.
- **Code Reference**: `stats-service/app/engine/bootstrap.py:block_cutoffs`, `stats-service/app/engine/evaluation.py:evaluate_sku_rolling`.
- **Parameters and Defaults**:
  `min_history = 56`, `block_size = 7`, `origin_step = 28` (non-overlapping), minimum folds = 8.
- **Inputs and Outputs**: Input series $y$. Output list of training cutoff indices $c \in \mathbb{Z}^+$ and fold evaluation rows with `used_for_selection` flags.
- **Edge Cases**: If $n < \text{min\_history} + 8 \times \text{origin\_step} = 56 + 224 = 280$, series with fewer folds are handled or returned as `None` if history is under minimum.
- **Why This Method**: Avoids temporal leakage and strictly isolates model selection folds from out-of-sample reporting folds.

---

### Method 11: Forecast Evaluation Metrics
- **Purpose**: Quantify out-of-sample forecast accuracy and interval calibration.
- **Symbols**: $y_t$ (actual demand), $\hat{y}_t$ (predicted point forecast), $H_b$ (block length, 7 days).
- **Formulas as Implemented**:
  $$\text{MAE} = \frac{1}{H_b} \sum_{t=1}^{H_b} |y_t - \hat{y}_t|$$
  $$\text{RMSE} = \sqrt{\frac{1}{H_b} \sum_{t=1}^{H_b} (y_t - \hat{y}_t)^2}$$
  $$\text{WAPE} = \frac{\sum_{t=1}^{H_b} |y_t - \hat{y}_t|}{\sum_{t=1}^{H_b} y_t} \quad (\text{returns null if } \sum y_t = 0)$$
  $$\text{MASE} = \frac{\text{MAE}}{\text{scale}_c}$$
  where the in-sample scaling denominator $\text{scale}_c$ uses weekly seasonal differences ($m = 7$):
  $$\text{scale}_c = \max\left(10^{-9}, \frac{1}{c - m} \sum_{t=m+1}^c |y_t - y_{t-m}|\right)$$
  For fold aggregate MASE, the overall scaling factor is $\overline{\text{scale}} = \frac{1}{K} \sum_{k=1}^K \text{scale}_{c_k}$ and $\text{MASE} = \text{MAE} / \overline{\text{scale}}$.
  $$\text{Pinball Loss } L_\tau(y, \hat{y}_\tau) = \frac{1}{H_b} \sum_{t=1}^{H_b} \max(\tau(y_t - \hat{y}_{\tau, t}), (1 - \tau)(\hat{y}_{\tau, t} - y_t))$$
  $$\text{Mean Pinball Loss} = \frac{1}{3} \left( L_{0.10} + L_{0.50} + L_{0.90} \right)$$
  $$\text{Coverage}_{80\%} = \frac{1}{H_b} \sum_{t=1}^{H_b} \mathbf{1}(\text{lo80}_t \le y_t \le \text{hi80}_t)$$
- **Code Reference**: `stats-service/app/engine/evaluation.py:evaluate_sku_rolling`, `_pinball`.
- **Parameters and Defaults**: Block size = 7, seasonal period $m = 7$, nominal coverage = 0.80.
- **Inputs and Outputs**: Arrays $y_{\text{val}}, \hat{y} \in \mathbb{R}^7$. Outputs: scalar floats.
- **Edge Cases**: If $\sum y_t = 0$, WAPE is `None`. If in-sample series has zero variance, scale floor $10^{-9}$ prevents division by zero.
- **Worked Example**: On benchmark SKU `21755`: AutoETS yields MASE = `0.3124`, MAE = `0.8371`, RMSE = `1.0519`, WAPE = `5.8599`, Coverage = `1.0000`.
- **Why This Method**: Standardized, scale-free metrics enabling comparisons across high- and low-volume items.

---

### Method 12: Baseline Improvement Formula
- **Purpose**: Measure the percentage error reduction achieved by a model relative to Seasonal Naive.
- **Symbols**: $\text{MASE}_{\text{SN}}$ (Seasonal Naive MASE), $\text{MASE}_{\text{model}}$ (candidate model MASE).
- **Formula as Implemented**:
  $$\Delta_{\text{MASE}} = \frac{\text{MASE}_{\text{SN}} - \text{MASE}_{\text{model}}}{\text{MASE}_{\text{SN}}} \times 100.0$$
- **Code Reference**: `stats-service/app/engine/evaluation.py:evaluate_sku_rolling`.
- **Parameters and Defaults**: Expressed as signed percentage float.
- **Inputs and Outputs**: Scalar MASE floats. Output scalar float `mase_improvement`.
- **Edge Cases**: If $\text{MASE}_{\text{SN}} \le 0$ or undefined, improvement defaults to `0.0`.
- **Worked Example**: On benchmark SKU `21755`: $\text{MASE}_{\text{SN}} = 0.4799$, $\text{MASE}_{\text{CrostonSBA}} = 0.4293 \rightarrow \Delta_{\text{MASE}} = +10.53\%$.
- **Why This Method**: Verifies that statistical models outperform simple calendar benchmarks before deployment.

---

### Method 13: Model Selection Rule
- **Purpose**: Select the best-performing forecasting model per SKU for downstream inventory optimization.
- **Symbols**: Model set $\mathcal{M}_{\text{candidate}} = \{\text{AutoETS}, \text{CrostonSBA}, \text{GlobalLGBM}\}$.
- **Formula as Implemented**:
  `Naive` and `SeasonalNaive` are baselines only and are excluded from selection.
  Candidate models are ranked on folds 1–5 by mean pinball loss across quantiles $\{0.10, 0.50, 0.90\}$:
  $$\text{chosen\_model} = \arg\min_{m \in \mathcal{M}_{\text{candidate}}} \overline{\text{Pinball}}_{m, \text{folds 1..5}}$$
  For intermittent and lumpy SKUs, an active demand fallback rule is enforced:
  If the chosen model produces a 28-day forecast mean of strictly zero while historical demand in the last 90 days is strictly positive ($\sum_{t=T-89}^T y_t > 0$), the model falls back to `CrostonSBA`.
- **Code Reference**: `stats-service/app/engine/evaluation.py:evaluate_sku_rolling` (lines 280-330).
- **Parameters and Defaults**: Ranked by pinball loss on folds 1–5; out-of-sample metrics reported on folds 6–8.
- **Inputs and Outputs**: Candidate fold metrics. Output: string `chosen_model`.
- **Edge Cases**: If all candidate models fail, defaults to SeasonalNaive if valid.
- **Worked Example**: For benchmark SKU `21755`, `CrostonSBA` has lowest selection pinball loss $\rightarrow$ chosen model is `CrostonSBA`.
- **Why This Method**: Pinball loss directly penalizes asymmetric interval quantile errors, matching downstream inventory buffer requirements.

---

### Method 14: Horizon-Indexed Residual Extraction and Pooling
- **Purpose**: Extract rolling out-of-sample forecast errors to construct non-parametric uncertainty distributions.
- **Symbols**: $e_{c, h} = y_{c+h} - \hat{y}_{c, h}$ for $h \in \{0, \dots, \text{block\_size}-1\}$.
- **Formula as Implemented**:
  For each origin $c_k$:
  $$\mathbf{e}_k = [y_{c_k + h} - \hat{y}_{c_k, h}]_{h=0}^{\text{block\_size}-1} \in \mathbb{R}^{\text{block\_size}}$$
  Blocks are stacked into matrix $\mathbf{E} \in \mathbb{R}^{B \times \text{block\_size}}$ where $B \ge 8$.
  For horizon step $h$, pool $\mathcal{P}_h = \{e_{k, \min(h, \text{block\_size}-1)}\}_{k=1}^B$.
  If $|\mathcal{P}_h| < 10$, pool widens to adjacent steps $[h-1, h+1]$, and if still $< 10$, flattens all entries in $\mathbf{E}$.
- **Code Reference**: `stats-service/app/engine/forecasting.py:collect_residual_blocks`, `stats-service/app/engine/bootstrap.py:generate_paths`.
- **Parameters and Defaults**: `min_pool = 10`, `block_size = 7`, `min_residual_blocks = 8`.
- **Inputs and Outputs**: Input time series and origin cutoffs. Output array of shape $(B, 7)$ and residual standard deviation $\sigma_d$.
- **Edge Cases**: If $< 8$ residual blocks are collected, optimization warns that uncertainty estimates may be undersampled.
- **Worked Example**: 8 folds of 7-day blocks produce an $8 \times 7$ residual matrix ($56$ residuals).
- **Why This Method**: Retains horizon-dependent error structure without assuming Gaussian residual distributions.

---

### Method 15: Block Bootstrap Demand Path Generation
- **Purpose**: Simulate future demand trajectories by perturbing baseline forecasts with resampled empirical residuals.
- **Symbols**: $\hat{y}_t$ (baseline mean), $\epsilon_{s, t}$ (resampled residual), $\tilde{D}_{s, t}$ (simulated path).
- **Formula as Implemented**:
  $$\tilde{D}_{s, t} = \max\left(0.0, \hat{y}_t + \epsilon_{s, t}\right), \quad \epsilon_{s, t} \sim \text{Uniform}(\mathcal{P}_t)$$
  Demand values are continuous (not rounded to integers).
- **Code Reference**: `stats-service/app/engine/bootstrap.py:generate_paths`.
- **Parameters and Defaults**: `n_paths = 500`, `block_size = 7`, `rng = np.random.default_rng(seed)`.
- **Inputs and Outputs**: Mean forecast array $(H,)$ and residual blocks $(B, 7)$. Output demand path matrix $(500, H)$.
- **Edge Cases**: Clipped at zero to prevent negative demand realizations.
- **Worked Example**: Mean path $\hat{y} = 10.09$, residual pool $\{-1.2, +0.8, -0.5\} \rightarrow \tilde{D} \in \{8.89, 10.89, 9.59\}$.
- **Why This Method**: Preserves empirical kurtosis and skewness observed in historical forecast errors.

---

### Method 16: Economic Order Quantity (EOQ) with MOQ and Pack Rounding
- **Purpose**: Calculate cost-minimizing replenishment order batch size subject to commercial packing constraints.
- **Symbols**: $D_{\text{annual}}$ (annual demand), $K$ (order cost), $h_{\text{annual}}$ (effective annual holding cost), $MOQ$ (minimum order quantity), $P$ (pack size).
- **Formula as Implemented**:
  $$D_{\text{annual}} = 365 \cdot \bar{d}, \quad \bar{d} = \frac{1}{H} \sum_{t=1}^H \hat{y}_t$$
  Holding cost is resolved via the unified `annual_holding_cost(a)` helper (enforcing `holding_rate` $\in [0, 1]$):
  $$h_{\text{annual}} = \begin{cases} a.\text{holding\_cost\_annual} & \text{if } a.\text{holding\_cost\_annual is not None} \\ a.\text{holding\_rate} \cdot c & \text{otherwise} \end{cases}$$
  $$Q^* = \sqrt{\frac{2 K D_{\text{annual}}}{h_{\text{annual}}}}$$
  $$Q_{\text{ceil}} = \max\left(1, \lceil Q^* - 10^{-9} \rceil\right)$$
  $$Q_{\text{moq}} = \max(Q_{\text{ceil}}, MOQ)$$
  $$Q = \begin{cases} \lceil Q_{\text{moq}} / P \rceil \cdot P & \text{if } P > 1 \\ Q_{\text{moq}} & \text{if } P \le 1 \end{cases}$$
- **Code Reference**: `stats-service/app/engine/inventory.py:optimize_sku`, `stats-service/app/schemas.py:annual_holding_cost`.
- **Parameters and Defaults**: `DAYS_PER_YEAR = 365`, `moq = 1`, `pack_size = 1`.
- **Inputs and Outputs**: Inputs: $\bar{d}, K, c, h, MOQ, P$. Output: integer $Q$.
- **Edge Cases**: If $D_{\text{annual}} \le 0$, SKU is marked `ineligible` (`"no_forecast_demand"`).
- **Worked Example**:
  `SKU_SMOOTH`: $\bar{d} = 10.0913$, $D_{\text{annual}} = 3683.3358$, $K = 100.0, c = 50.0, h = 0.20 \rightarrow h_{\text{annual}} = 10.0$.
  $Q^* = \sqrt{2 \cdot 100 \cdot 3683.3358 / 10} = 271.4162 \rightarrow Q_{\text{ceil}} = 272$.
  With $MOQ = 10, P = 5 \rightarrow Q = \lceil 272 / 5 \rceil \cdot 5 = 275$.
- **Why This Method**: Balances fixed administrative ordering costs against holding costs while adhering to supplier batch multiples.

---

### Method 17: Deterministic Reorder Point ($s_{\text{det}}$)
- **Purpose**: Calculate reorder point assuming normally distributed lead-time demand.
- **Symbols**: $\mu_L$ (lead-time forecast sum), $\bar{L}$ (mean lead time), $\sigma_L$ (lead-time std), $\sigma_d$ (residual std), $\alpha$ (target cycle service level).
- **Formula as Implemented**:
  $$L_{\text{round}} = \max(1, \lfloor \bar{L} + 0.5 \rfloor)$$
  $$\mu_L = \sum_{t=1}^{L_{\text{round}}} \hat{y}_t$$
  $$\sigma_{\text{LTD}} = \sqrt{L_{\text{round}} \cdot \sigma_d^2 + \bar{d}^2 \cdot \sigma_L^2}$$
  $$SS_{\text{det}} = \Phi^{-1}(\alpha) \cdot \sigma_{\text{LTD}}$$
  $$s_{\text{det}} = \max\left(0, \lceil \mu_L + SS_{\text{det}} - 10^{-9} \rceil\right)$$
- **Code Reference**: `stats-service/app/engine/inventory.py:optimize_sku`.
- **Parameters and Defaults**: Target cycle service level $\alpha = 0.95$, $z_{0.95} = 1.6448536$.
- **Inputs and Outputs**: Inputs: $\hat{y}, \bar{L}, \sigma_L, \sigma_d, \alpha$. Output: integer $s_{\text{det}}$.
- **Edge Cases**: If forecast length $< L_{\text{round}}$, returns `ineligible` (`"forecast_shorter_than_lead_time"`). Warns if $\mu_L < 10.0$ or skewness $> 1.0$.
- **Worked Example**:
  `SKU_SMOOTH`: $\bar{L} = 7, \sigma_L = 1.5, \sigma_d = 1.3770, \bar{d} = 10.0913, \alpha = 0.95$.
  $\mu_L = 70.6393$, $\sigma_{\text{LTD}} = \sqrt{7(1.3770)^2 + (10.0913)^2(1.5)^2} = \sqrt{13.273 + 229.135} = 15.5695$.
  $SS = 1.6449 \times 15.5695 = 25.61$, $s_{\text{det}} = \lceil 70.64 + 25.61 \rceil = 97$.
- **Why This Method**: Provides the classical parametric benchmark assuming Gaussian error propagation.

---

### Method 18: Quantile Reorder Point ($s_{\text{quant}}$)
- **Purpose**: Derive safety stock from direct forecast quantile spreads (P10 and P90) incorporating lead-time uncertainty.
- **Symbols**: $p10_t, p50_t, p90_t$ (forecast interval bands), $\sigma_{d, \text{quant}}$ (daily spread), $\sigma_L$ (lead-time std).
- **Formula as Implemented**:
  $$\sigma_{d, \text{quant}} = \frac{1}{H} \sum_{t=1}^H \frac{p90_t - p10_t}{2 \times 1.2816}$$
  $$\sigma_{\text{LTD}, q} = \sqrt{\bar{L} \cdot \sigma_{d, \text{quant}}^2 + \mu_d^2 \cdot \sigma_L^2}$$
  $$SS_{\text{quant}} = \Phi^{-1}(\alpha) \cdot \sigma_{\text{LTD}, q}$$
  $$s_{\text{quant}} = \max\left(0, \lceil \mu_L + SS_{\text{quant}} - 10^{-9} \rceil\right)$$
- **Code Reference**: `stats-service/app/engine/inventory.py:optimize_sku`.
- **Parameters and Defaults**: Normal equivalent divisor $2 \times \Phi^{-1}(0.90) \approx 2 \times 1.2815516 \approx 2.5631$.
- **Inputs and Outputs**: Quantile forecast arrays. Output: integer $s_{\text{quant}}$.
- **Edge Cases**:
  > [!WARNING]
  > **Zero-Inflated Tail Understatement**: The $(P90 - P10)/(2 \cdot 1.2816)$ formula assumes Gaussian symmetry. For intermittent, lumpy, or zero-inflated demand where $P10 = 0$, this formula severely understates tail dispersion, leading to under-buffered safety stocks (e.g. achieving only 36.6% CSL on synthetic lumpy demand vs 95% target).
- **Why This Method**: Combines quantile regression interval width with lead-time variance.

---

### Method 19: Empirical Reorder Point ($s_{\text{emp}}$)
- **Purpose**: Determine reorder point non-parametrically by sampling lead times over bootstrap demand paths.
- **Symbols**: $B$ (bootstrap paths, 500), $L_i$ (sampled lead time), $D_{L, i}$ (lead-time demand).
- **Formula as Implemented**:
  Lead times sampled from truncated normal distribution:
  $$L_i \sim \text{TruncNormal}\left(\mu = \bar{L}, \sigma = \sigma_L, a = \frac{1 - \bar{L}}{\sigma_L}, b = \infty\right), \quad L_i = \max(1, \text{round}(L_i))$$
  If $L_i > H$, clipped to horizon length $H$.
  $$D_{L, i} = \sum_{t=1}^{L_i} \tilde{D}_{i, t} \quad \text{for path } i \in \{1, \dots, B\}$$
  $$s_{\text{emp}} = \max\left(0, \lceil \text{Quantile}(D_L, \alpha, \text{method}="higher") - 10^{-9} \rceil\right)$$
  $$SS_{\text{emp}} = \text{Quantile}(D_L, \alpha) - \bar{D}_L$$
- **Code Reference**: `stats-service/app/engine/inventory.py:optimize_sku`, `sample_lead_times`.
- **Parameters and Defaults**: `n_bootstrap = 500`, quantile method = `"higher"`.
- **Inputs and Outputs**: Bootstrap paths matrix $(500, H)$. Output: integer $s_{\text{emp}}$ and distribution summary ($p10, p50, p90$, skewness).
- **Edge Cases**: Clipped lead times log a warning if sampled $L$ exceeds forecast horizon $H$.
- **Worked Example**:
  `SKU_SMOOTH`: Mean lead-time demand = $70.76$, 95th percentile = $99.41 \rightarrow s_{\text{emp}} = 100, SS_{\text{emp}} = 28.65$.
- **Why This Method**: Captures joint lead-time and demand variability without parametric distribution assumptions.

---

### Method 20: Daily Discrete-Event Inventory Simulation
- **Purpose**: Simulate inventory positions, ordering, stockouts, and costs under stochastic daily operations.
- **Symbols**: $H$ (simulation horizon, 90 days), $W$ (warm-up duration, 30 days), $L$ (lead time), $s$ (reorder point), $Q$ (order quantity).
- **Sequence of Daily Events (Strict Code Order)**:
  1. **Delivery Arrivals**: Process orders scheduled to arrive on day $t$. Arrival day is scheduled strictly as:
     $$\text{arrival\_day} = \text{order\_day} + L + 1$$
     (representing order placement at the end of `order_day`, with exactly $L$ days of transit demand exposure).
     $$I_t \leftarrow I_t + \text{arrived\_qty}, \quad \text{on\_order} \leftarrow \text{on\_order} - \text{arrived\_qty}$$
  2. **Demand Satisfaction**:
     $$\text{sold}_t = \min(I_t, d_t), \quad \text{lost}_t = d_t - \text{sold}_t$$
     $$I_t \leftarrow I_t - \text{sold}_t$$
     $$\text{inv\_sum} \leftarrow \text{inv\_sum} + I_t \quad (\text{holding cost evaluated on ending inventory})$$
  3. **Cycle Stockout Flagging**: An in-flight replenishment order is counted as stocked-out only if lost sales occur during its replenishment exposure window:
     $$t \in (\text{order\_day}, \text{arrival\_day}]$$
  4. **Review and Order Placement**:
     $$IP_t = I_t + \text{on\_order}_t$$
     $$\text{If } IP_t \le s: \quad b = \left\lfloor \frac{s - IP_t}{Q} \right\rfloor + 1, \quad \text{order\_qty} = b \cdot Q$$
     Schedule arrival on day $t + L + 1$. $\text{on\_order} \leftarrow \text{on\_order} + \text{order\_qty}$, $\text{orders} \leftarrow \text{orders} + 1$.
- **Warm-Up Discard**: The simulation runs for $H + 30$ days; the first 30 days are discarded from all reported metrics (costs, fill rate, CSL, stockouts). Initial stock is initialized at $s + Q$ if missing (never 0). Day-0 on-hand and first stockout day are logged per run.
- **Metrics Evaluated**:
  $$\text{Fill Rate} = 1 - \frac{\sum_{t=30}^{H+29} \text{lost}_t}{\sum_{t=30}^{H+29} d_t}$$
  $$\text{CSL} = 1 - \frac{\text{cycle\_stockouts}}{\text{orders}}$$
  $$\text{Cost} = K \cdot \text{orders} + \left( \frac{h_{\text{annual}}}{365} \right) \sum_{t=30}^{H+29} I_t + c_p \cdot \sum_{t=30}^{H+29} \text{lost}_t$$
  $$\text{LTD Calibration} = \frac{1}{M} \sum_{m=1}^M \mathbf{1}(\text{LTD}_m \le s)$$
  (evaluated on $M=500$ fresh lead-time demand paths from an independent seed stream).
  $$\text{Paired Cost Difference vs } s_{\text{det}}: \quad \Delta \bar{C} \pm 1.96 \cdot \frac{s_{\Delta}}{\sqrt{n}}$$
- **Code Reference**: `stats-service/app/engine/simulation.py:simulate_policy`, `simulate_sku`.
- **Parameters and Defaults**: `n_scenarios = 500`, `horizon_days = 90`, `warmup_days = 30`. Initial stock: $s + Q$.
- **Inputs and Outputs**: Demand matrix $(500, 120)$, policy $(s, Q)$. Outputs: mean costs, fill rate, CSL, ltd_calibration, paired confidence intervals.
- **Edge Cases**: If orders = 0, CSL is 1.0 (or 0.0 if stockouts occurred without replenishment).
- **Worked Example**:
  On benchmark SKU `21755`: Deterministic policy ($s=19, Q=68$) yields Cost = `820.43`, Fill Rate = `0.9518`, CSL = `0.6977`, LTD calibration = `0.9940`.
- **Why This Method**: Verifies operating performance across hundreds of realized demand paths under rigorous inventory accounting.

---

### Method 21: Holdout Replay
- **Purpose**: Backtest the entire forecast-and-optimize pipeline on the final 28 days of observed actual historical data.
- **Symbols**: $T$ (total days), holdout window $[T - 28, T]$.
- **Formula as Implemented**:
  1. Truncate series to training history $y_{\text{train}} = y[:T - 28]$.
  2. Execute model fitting, selection, and inventory optimization strictly on $y_{\text{train}}$.
  3. Simulate resulting policies $(s_{\text{det}}, Q), (s_{\text{emp}}, Q), (s_{\text{quant}}, Q)$ against the unobserved actual demand vector $y_{\text{actual}} = y[T - 28:]$ using identical order timing ($\text{arrival} = t + L + 1$) and 30-day pre-holdout warm-up.
- **Code Reference**: `stats-service/app/engine/replay.py:replay_sku`.
- **Parameters and Defaults**: `holdout_days = 28`, `min_history = 56`.
- **Inputs and Outputs**: Historical series. Output: actual stockout days, lost units, fill rate, ltd_calibration, and total cost on the holdout period.
- **Edge Cases**: If total series length $< 28 + 112 = 140$ days, replay returns `insufficient_history`.
- **Worked Example**:
  Dataset SKU `21755` (Holdout demand = 24 units):
  - Deterministic ($s=19$): cost = `2247.80`, fill rate = `0.4375` (4 stockout days, 27 lost units).
  - Empirical ($s=16$): cost = `2247.80`, fill rate = `0.4375` (4 stockout days, 27 lost units).
- **Why This Method**: Provides ground-truth historical validation without synthetic noise generation.

---

### Method 22: SKU Demand Dependency Analysis
- **Purpose**: Identify cross-SKU substitution and complementarity and evaluate portfolio risk pooling.
- **Symbols**: $\mathbf{D}_{\text{weekly}}$ (weekly aggregated demand), $\mathbf{R}$ (Pearson correlation matrix), $\mathbf{\sigma}_{\text{weekly}}$ (weekly demand std).
- **Formula as Implemented**:
  1. Filter eligible SKUs: include only SKUs with $\ge 20$ non-zero demand weeks.
  2. Aggregate daily demand to Sunday weekly sums ($W\text{-SUN}$).
  3. Compute Pearson correlation matrix $\mathbf{R} = [ \rho_{i, j} ]$.
  4. Filter significant pairs: $|\rho_{i, j}| \ge 0.50$:
     $$\text{relation} = \begin{cases} \text{"complementary"} & \text{if } \rho_{i, j} \ge 0.50 \\ \text{"substitute-like"} & \text{if } \rho_{i, j} \le -0.50 \end{cases}$$
  5. Risk pooling ratio using weekly standard deviations ($\sigma_{\text{weekly}, i} = \sigma_{d, i} \sqrt{7}$):
     $$\text{Pooling Ratio} = \frac{\sqrt{\mathbf{\sigma}_{\text{weekly}}^T \mathbf{R} \mathbf{\sigma}_{\text{weekly}}}}{\sum_{i=1}^n \sigma_{\text{weekly}, i}}$$
- **Code Reference**: `stats-service/app/engine/dependency.py:compute_dependency`.
- **Parameters and Defaults**: Minimum active weeks $\ge 20$, correlation threshold $|\rho| \ge 0.50$.
- **Inputs and Outputs**: Daily demand series and forecast error standard deviations $\mathbf{\sigma}_d$. Output: correlation matrix, filtered pairs, pooling ratio.
- **Edge Cases**: If $n = 1$ or fewer than 2 SKUs meet the 20-week threshold, returns empty pairs and pooling ratio 1.0.
- **Worked Example**:
  On UCI Online Retail dataset: 29 pairs identified with $|\rho| \ge 0.50$; pooling ratio = `0.4840` across 25 SKUs.
- **Why This Method**: Captures co-movement while removing low-activity intermittent noise.

---

### Method 23: Service-Level Sweep
- **Purpose**: Generate the trade-off curve between cycle service level $\alpha$ and simulated inventory performance.
- **Symbols**: $\alpha \in \{0.80, 0.82, \dots, 0.98\}$.
- **Formula as Implemented**:
  For each $\alpha$ in the grid:
  1. Compute empirical reorder point $s_{\text{emp}}(\alpha)$.
  2. Simulate policy $(s_{\text{emp}}(\alpha), Q)$ over 500 demand scenarios.
  3. Record: service level, reorder point, total cost, average inventory, inventory investment ($\text{avg\_inventory} \times c$).
- **Code Reference**: `stats-service/app/engine/simulation.py:compute_sku_sweep`.
- **Parameters and Defaults**: Step size = 0.02 across 10 evaluation points.
- **Why This Method**: Provides the discrete operating alternatives required for portfolio-level budget optimization.

---

### Method 24: Portfolio Greedy Allocation Rule
- **Purpose**: Allocate constrained budget by starting at each SKU's unconstrained cost-minimizing level and performing greedy descent.
- **Symbols**: $k_i$ (curve index for SKU $i$), $\Delta C_i$ (cost increase from decrementing), $\Delta B_i$ (budget saved from decrementing).
- **Formula as Implemented**:
  1. Initialize all SKUs at their individual cost-minimizing service-level index:
     $$k_i = \arg\min_k C_{i, k}$$
  2. While total inventory investment exceeds budget ($\sum b_{i, k_i} > B$) or total average inventory exceeds capacity ($\sum u_{i, k_i} > C$):
     Evaluate candidate decrements $k_i \rightarrow k_i - 1$ for all SKUs with $k_i > 0$:
     $$\text{Cost Increase } \Delta C_i = C_{i, k_i - 1} - C_{i, k_i}$$
     $$\text{Budget Saved } \Delta B_i = b_{i, k_i} - b_{i, k_i - 1}$$
     $$\text{Descent Ratio } r_i = \frac{\Delta C_i}{\max(\Delta B_i, 10^{-9})}$$
     Select the SKU with the smallest cost increase per unit of budget saved:
     $$i^* = \arg\min_{i: k_i > 0, \Delta B_i > 0} r_i$$
     Lower its service level: $k_{i^*} \leftarrow k_{i^*} - 1$.
  3. If all SKUs reach index 0 or no further budget can be saved, terminate.
- **Code Reference**: `stats-service/app/portfolio.py:_solve_greedy`.
- **Parameters and Defaults**: Descent from unconstrained cost-minimizing point; tie-breaker chooses first encountered index.
- **Inputs and Outputs**: SKU curves, budget $B$, capacity $C$. Output: assigned curve indices per SKU.
- **Edge Cases**: If unconstrained solution already satisfies budget and capacity, greedy halts immediately at 0% gap.
- **Worked Example**: At 100% budget, greedy gap is strictly `0.0000%` across both UCI Online Retail and BTP report datasets.
- **Why This Method**: Natural descent heuristic that preserves maximum service levels and avoids arbitrary ascent initialization traps.

---

### Method 25: Mixed-Integer Linear Programming (MILP) Portfolio Optimization
- **Purpose**: Find the globally optimal service-level combination across all SKUs under budget and warehouse capacity limits.
- **Symbols**: Binary decision variables $x_{i, k} \in \{0, 1\}$, cost coefficients $c_{i, k}$, investment coefficients $b_{i, k}$, capacity units $u_{i, k}$.
- **Formula as Implemented**:
  $$\min \sum_{i=1}^N \sum_{k=1}^{K_i} c_{i, k} x_{i, k}$$
  Subject to:
  $$\sum_{k=1}^{K_i} x_{i, k} = 1 \quad \forall i \in \{1, \dots, N\} \quad \text{(exactly one service level per SKU)}$$
  $$\sum_{i=1}^N \sum_{k=1}^{K_i} b_{i, k} x_{i, k} \le B \quad \text{where } b_{i, k} = \text{avg\_inventory}_{i, k} \cdot c_i \quad \text{(budget constraint)}$$
  $$\sum_{i=1}^N \sum_{k=1}^{K_i} u_{i, k} x_{i, k} \le C \quad \text{where } u_{i, k} = \text{avg\_inventory}_{i, k} \quad \text{(capacity constraint)}$$
- **Budget Sweep**: Evaluates 6 evenly spaced budgets spanning from the minimum feasible budget ($\sum_i \min_k b_{i, k}$) to the unconstrained investment level ($\sum_i b_{i, k^*_{\text{unconstrained}}}$).
- **Binding Constraint Check**:
  A constraint is defined as strictly "binding" iff the exact MILP cost at a 1% budget relaxation ($1.01 \cdot B$) is lower than the cost at $B$ by more than $10^{-9}$:
  $$\text{binding} \iff C^*(1.01 \cdot B) < C^*(B) - 10^{-9}$$
- **Code Reference**: `stats-service/app/portfolio.py:_run_milp`, `solve_portfolio_budget_sweep`.
- **Parameters and Defaults**: SciPy `milp` solver with exact integrality constraints (`integrality = np.ones(...)`).
- **Inputs and Outputs**: Cost and investment matrices. Output: optimal indices, exact total cost, optimality gap, binding constraint list.
- **Edge Cases**: If budget is less than minimum feasible budget, returns status `"infeasible"`.
- **Why This Method**: Guarantees mathematically minimal portfolio operating costs under finite working capital.

---

### Method 26: Shadow Price Computation
- **Purpose**: Estimate the marginal economic value (cost reduction) of relaxing the working capital budget by ₹1.
- **Symbols**: $B$ (budget), $C^*(B)$ (optimal MILP cost at budget $B$).
- **Formula as Implemented**:
  $$\lambda_B = \frac{C^*(1.01 \cdot B) - C^*(0.99 \cdot B)}{0.02 \cdot B}$$
  If $C^*(0.99 \cdot B)$ is infeasible, uses forward difference:
  $$\lambda_B = \frac{C^*(1.01 \cdot B) - C^*(B)}{0.01 \cdot B}$$
- **Code Reference**: `stats-service/app/portfolio.py:solve_exact`.
- **Parameters and Defaults**: Budget perturbation $\Delta B / B = 0.01$ (1%).
- **Inputs and Outputs**: Base budget $B$ and SKU curves. Output: signed float `shadow_price`.
- **Edge Cases**: If budget constraint is non-binding ($C^*(1.01 B) \ge C^*(B) - 10^{-9}$), shadow price is reported as `0.0`.
- **Why This Method**: Quantifies return on marginal working-capital allocation.

---

## 3. AI Grounding and Evidence Ledger Rules

AI decision-support narratives are grounded against verified numerical outputs stored in MongoDB session artifacts.

- **Number Extraction**: Regex extracts candidate numeric values from model text, ignoring calendar dates (`YYYY-MM-DD`) and SKU identifiers (`server/src/services/ai/grounding.js:extractNumbers`).
- **Tolerance Matching Rule**: A claimed number $v_{\text{claimed}}$ matches actual artifact value $v_{\text{actual}}$ if:
  $$|v_{\text{claimed}} - v_{\text{actual}}| \le \max(0.005, |v_{\text{actual}}| \times 0.001)$$
  (Tolerance is 0.1% of the true value, floored at 0.005 absolute).
- **Percentage Handling**: Automatically handles percentage conversions between decimal representations ($0.95$) and percentage statements ($95\%$).
- **Safe Integers**: Whitelist of unflagged structural integers:
  $$\text{SAFE\_INTS} = \{0, 1, 2, 3, 4, 5, 7, 10, 28, 50, 56, 90, 365, 500\}$$
- **Enforcement**: Any numeric claim in AI recommendations not matching ledger data within stated tolerance is stripped or flagged before presentation (`server/src/services/ai/grounding.js:groundDraft`).

---

## 4. Assumptions and Limitations

1. **Single-Echelon Inventory**: StockPilot AI models a single stocking tier (store or regional distribution center) supplying end-customer demand. Multi-echelon echelon-stock replenishment and transshipments are not modeled.
2. **Lost Sales Mechanics**: Demand exceeding available physical inventory is modeled as permanently lost sales. Backorders and customer order queuing are not supported.
3. **User-Supplied Cost and Lead-Time Assumptions**: Holding cost fractions, fixed order costs, unit costs, shortage penalties, and lead-time distributions are accepted as user parameters without independent financial audit.
4. **Normal Lead-Time Distribution Model**: Stochastic lead times are generated from a truncated normal distribution $\mathcal{N}(\bar{L}, \sigma_L^2)$ bounded below by 1 day. Complex multimodal supplier delays are approximated by this two-parameter model.
5. **Fixed 365-Day Analysis Window**: Demand history is windowed to the final 365 days of observed data, omitting multi-year trend cycles.
6. **Fixed 28-Day Holdout Replay**: Replay evaluation is conducted over a single 28-day historical window. It provides an illustrative validation check rather than a multi-year cross-validation study.
7. **Correlation Does Not Imply Causality**: SKU dependency analysis computes Pearson correlation on weekly aggregated sales volumes. Cross-elasticity, pricing effects, promotions, and true economic substitutability are not causally modeled.

---

## 5. Known Deviations and Open Questions

The following list records every specific point where the current codebase implementation differs from textbook theoretical formulas, standard practice, or earlier documentation. These are factual reports of the implementation:

- Residual Sample Size Per Step: In rolling-origin evaluation, each fold evaluates a discrete block length of $H_b = 7$ days (or 28 days for full-horizon evaluation). Extracting residuals across a finite number of folds yields a modest sample size of residual vectors per SKU ($8 \times 7 = 56$ residuals), which can exhibit small-sample sampling variance when generating empirical bootstrap paths.
- Annualizing a 28-Day Mean: Annual expected demand is computed by linear scaling of the 28-day forecast mean ($D_{\text{annual}} = 365 \cdot \bar{d}_{28}$). For items with strong quarterly or multi-month seasonality, this extrapolates short-term seasonal surges or troughs to the full annual horizon, directly scaling the EOQ batch quantity.
- Average-Inventory Proxies in Portfolio Allocation: The portfolio MILP and greedy descent formulate budget and capacity constraints using simulated average on-hand inventory ($\text{avg\_inventory} \times c \le B$ and $\sum \text{avg\_inventory} \le C$). This proxy omits in-transit pipeline stock capital $(\bar{L} \bar{d} \cdot c)$ and peak storage footprint ($s + Q$), meaning peak warehouse utilization and total cash exposure may exceed stated limits during replenishment cycles.
- Selection Design and Temporal Leakage Safeguards: Model selection uses folds 1–5 ranked by pinball loss, while out-of-sample reporting reflects folds 6–8. Baseline models (`Naive`, `SeasonalNaive`) are strictly unselectable to ensure that operational policies are driven by structural statistical or ML models. For intermittent or lumpy series where an selected model outputs all-zero forecast means despite recent demand in the last 90 days, the engine falls back to `CrostonSBA`.
- Order Sizing Rule: Code computes batches $b = \lfloor (s - IP)/Q \rfloor + 1$ and orders $b \cdot Q$, rather than strictly placing a fixed single order $Q$ when $IP \le s$. (`stats-service/app/engine/simulation.py:simulate_policy` line 88). This matters because when demand in a single day exceeds $Q$, the system orders multiple packs in one review step to restore inventory position, which prevents systematic runaway deficits not captured by standard textbook $(s, Q)$ equations.
- Holding Cost Accounting Timing: Daily holding cost is calculated on end-of-day on-hand inventory after satisfying demand ($I_t \leftarrow I_t - \text{sold}_t$, `inv_sum += on_hand`), rather than on average on-hand inventory during the day $(I_{t-1} + I_t)/2$ or starting inventory. (`stats-service/app/engine/simulation.py:simulate_policy` line 68). This matters because holding costs are understated by approximately half a day's sales volume.
- Order Arrival Timing: Orders triggered at end of day $t$ arrive on day $t + L + 1$ and become available to satisfy demand on day $t + L + 1$ before demand realization, giving exactly $L$ full days of transit demand exposure.
- Lead Time Truncation in Empirical LTD Sampling: When a sampled lead time $L$ exceeds the forecast horizon length $H$ (28 days), the code clips $L$ to $H$ (`lead_times = np.clip(lead_times, 1, path_len)`). (`stats-service/app/engine/inventory.py:optimize_sku` line 102). This truncates the right tail of long lead-time distributions to at most 28 days, underestimating safety stock for items where $\bar{L} + 3\sigma_L > 28$.
- MASE Scaling Baseline: MASE denominator is computed as the in-sample mean absolute difference with step $m=7$ (seasonal naive differences on training series), rather than textbook lag-1 non-seasonal naive diffs. (`stats-service/app/engine/evaluation.py:evaluate_sku_rolling` lines 103-109). This scales error relative to weekly seasonality rather than consecutive-day random walk.
- Non-parametric Intermittent Interval Seed Derivation: Intermittent simulation seed is generated using `zlib.crc32(sku_id.encode("utf-8"))` rather than the central Blake2b SeedSequence used for other modules. (`stats-service/app/engine/intermittent.py:simulate_intermittent_intervals` line 34).
- Bootstrap Path Horizon Tiling: Mean demand path is tiled periodically if horizon exceeds mean path length, but residuals are horizon-indexed and fall back to pooled residual blocks when pool size is under 10. (`stats-service/app/engine/bootstrap.py:generate_paths` lines 42-49).
- Quantile Ordering Post-Processing: Global LightGBM predicts quantiles independently and enforces monotonic ordering by cascading clipping `p10 = max(0, p10)`, `p50 = max(p10, p50)`, `p90 = max(p50, p90)`. (`stats-service/app/engine/global_lgbm.py:fit_predict_global_quantile` lines 135-137). This introduces an upward bias in the median and upper quantiles if raw quantile crossings occur.
- WAPE on Intermittent Series: WAPE is reported for intermittent and lumpy demand where actual demand sums are small, returning `null` only when actual total volume across the evaluation window is strictly zero. (`stats-service/app/engine/evaluation.py:evaluate_sku_rolling` line 220).
- Dependency Correlation Matrix Metric: Demand dependency evaluates Pearson correlation on weekly aggregated sales of items with $\ge 20$ active weeks, with correlation threshold $|\rho| \ge 0.50$, and scales risk pooling via weekly standard deviations $\sigma_d \sqrt{7}$.
- Central Difference Shadow Price Step Size: Budget shadow price is estimated numerically using a fixed $1\%$ budget perturbation: $(C(1.01 B) - C(0.99 B)) / (0.02 B)$, rather than an analytical dual variable from linear programming relaxation. (`stats-service/app/portfolio.py:solve_exact` lines 504-511). Discrete jumps in the MILP step function can cause local shadow price estimates to be zero or sensitive to the $1\%$ perturbation width.
