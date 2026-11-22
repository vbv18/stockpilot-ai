# StockPilot AI Statistical & Optimization Methodology

This document outlines the mathematical formulas, algorithms, model evaluation rules, and simulation mechanics implemented in StockPilot AI.

---

## 1. Time Series Ingestion & Demand Preprocessing

Raw transactional records (e.g. daily sales or e-commerce invoices) are grouped by SKU and calendar date $t$:
$$D_{i, t} = \sum_{k} \text{quantity}_{i, t, k}$$

### Missing Date Imputation

Unobserved dates between the first observed transaction date $t_{\min}$ and dataset cutoff date $t_{\max}$ are imputed with zero demand ($D_{i, t} = 0$).

### Intermittent Demand Classification

Demand series are classified using Syntetos-Boylan criteria based on Average Demand Interval ($ADI$) and squared Coefficient of Variation ($CV^2$):

- $ADI = \frac{N}{\sum_{t=1}^N \mathbf{1}(D_t > 0)}$
- $CV^2 = \left(\frac{\sigma_{D, \text{nonzero}}}{\mu_{D, \text{nonzero}}}\right)^2$
- **Smooth**: $ADI < 1.32$ and $CV^2 < 0.49$
- **Intermittent**: $ADI \ge 1.32$ and $CV^2 < 0.49$ (Croston or SBA candidate)
- **Erratic**: $ADI < 1.32$ and $CV^2 \ge 0.49$
- **Lumpy**: $ADI \ge 1.32$ and $CV^2 \ge 0.49$

---

## 2. Statistical Forecasting Models

StockPilot AI evaluates candidate models per SKU using rolling-origin backtesting:

1. **Exponential Smoothing (ETS)**: State-space formulation (additive or multiplicative trend and seasonality).
2. **Croston Method / Syntetos-Boylan Approximation (SBA)**: Decoupled demand size and inter-arrival forecasting for intermittent demand:
   $$\hat{y}_{\text{SBA}} = \left(1 - \frac{\alpha}{2}\right) \frac{\hat{z}_t}{\hat{p}_t}$$
3. **Seasonal Naive**: $D_{t+h} = D_{t+h-m}$ where $m$ is the seasonal period (e.g., 7 days).

### Forecast Evaluation Metrics

Let $y_t$ denote actual demand and $\hat{y}_t$ denote forecasted demand over evaluation horizon $H$:

- **WAPE** (Weighted Absolute Percentage Error):
  $$\text{WAPE} = \frac{\sum_{t=1}^H |y_t - \hat{y}_t|}{\sum_{t=1}^H y_t}$$
- **RMSE** (Root Mean Squared Error):
  $$\text{RMSE} = \sqrt{\frac{1}{H} \sum_{t=1}^H (y_t - \hat{y}_t)^2}$$
- **MAE** (Mean Absolute Error):
  $$\text{MAE} = \frac{1}{H} \sum_{t=1}^H |y_t - \hat{y}_t|$$

---

## 3. Inventory Policy Optimization

### 3.1 Economic Order Quantity (EOQ)

Given annual demand $D_{\text{annual}}$, fixed order placement cost $K$ (or $S$), unit cost $c$, and annual holding rate $h$ (where $H = h \cdot c$):
$$Q^* = \sqrt{\frac{2 K D_{\text{annual}}}{H}}$$

When minimum order quantity ($MOQ$) or pack sizes $P$ apply:
$$Q_{\text{recommended}} = \max\left(MOQ, \left\lceil \frac{Q^*}{P} \right\rceil \cdot P\right)$$

### 3.2 Lead-Time Demand Parameters

For replenishment lead time $L$ (in days) and daily demand mean $\mu_d$ and standard deviation $\sigma_d$:
$$\mu_L = L \cdot \mu_d$$
When daily demand is independent and identically distributed:
$$\sigma_L = \sqrt{L} \cdot \sigma_d$$
When lead time $L$ is stochastic with mean $\mu_L$ and standard deviation $\sigma_L$:
$$\sigma_{\text{LTD}} = \sqrt{\mu_L \sigma_d^2 + \mu_d^2 \sigma_L^2}$$

### 3.3 Safety Stock ($SS$) and Reorder Point ($s$)

For target cycle service level $\alpha \in (0, 1)$ with standard normal quantile $z_\alpha = \Phi^{-1}(\alpha)$:
$$SS = z_\alpha \cdot \sigma_L$$
The deterministic Reorder Point ($s$ or $ROP$) is:
$$s = \mu_L + SS = \mu_L + z_\alpha \cdot \sigma_L$$

### 3.4 Empirical Non-Parametric Reorder Point

For non-normal or skewed intermittent demand distributions, $s$ is derived directly from empirical lead-time demand quantiles:
$$s = \text{Quantile}_{\alpha}(\{D_{L, k}\}_{k=1}^B)$$
where $\{D_{L, k}\}$ is generated via rolling lead-time block aggregations or historical boot-strapped demand traces.

---

## 4. Monte Carlo Lead-Time Demand Simulation

To validate inventory policies $(s, Q)$ under stochastic real-world conditions, StockPilot AI executes discrete-event daily simulations across $N$ independent replications over horizon $T$ days (e.g. 90 days, 1000 runs):

### Daily Event Sequence

1. **Order Receipt**: Outstanding purchase orders scheduled to arrive on day $t$ increment on-hand inventory $I_t$.
2. **Demand Realization**:
   - Resampled from residual bootstrap: $\tilde{D}_t = \max\left(0, \hat{y}*t + \epsilon_t^*\right)$, where $\epsilon_t^_$ is sampled uniformly with replacement from model residuals.
3. **Order Fulfillment**:
   - Sales: $S_t = \min(I_t, \tilde{D}_t)$
   - Unmet Demand (Lost Sales): $U_t = \tilde{D}_t - S_t$
   - Ending Inventory: $I_{t+1} = I_t - S_t$
4. **Replenishment Review**:
   - Inventory Position: $IP_t = I_{t+1} + \text{InTransit}_t$
   - If $IP_t \le s$: trigger purchase order of quantity $Q$ with arrival scheduled at day $t + L$.

### Performance & Cost Metrics

- **Fill Rate (Unit Service Level)**:
  $$\text{Fill Rate} = \frac{\sum_{t=1}^T S_t}{\sum_{t=1}^T \tilde{D}_t}$$
- **Cycle Service Level**:
  $$\text{CSL} = 1 - \frac{\text{Number of cycles with stockout}}{\text{Total replenishment cycles}}$$
- **Total Operational Cost**:
  $$\text{Cost}_{\text{total}} = \sum_{t=1}^T \left( c_h \cdot I_t + c_p \cdot U_t \right) + K \cdot N_{\text{orders}}$$
  where $c_h = \frac{h \cdot c}{365}$ is holding cost per unit per day, and $c_p$ is shortage penalty per lost unit.
