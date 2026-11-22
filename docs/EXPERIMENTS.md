# StockPilot AI Experimentation Suite

## Run Instructions

The evaluation script runs the numerical engine across historical daily sales series and generates four evaluation datasets.

### Prerequisites

Activate the Python virtual environment with dependencies installed (`statsforecast`, `numpy`, `scipy`, `pandas`):

```bash
# Windows
stats-service\.venv\Scripts\activate

# Unix / macOS
source stats-service/.venv/bin/activate
```

### Execution

Run the script from the repository root:

```bash
python stats-service/experiments/run_experiments.py --csv <path_to_daily_sales.csv> --assumptions <path_to_assumptions.json>
```

Or from within the `stats-service` directory:

```bash
cd stats-service
python experiments/run_experiments.py --csv <path_to_daily_sales.csv> --assumptions <path_to_assumptions.json>
```

### Arguments

| Argument | Required | Default | Description |
|---|---|---|---|
| `--csv` | Yes | - | Path to input daily sales CSV containing SKU demand series. Expected columns include SKU identifier (`sku_id`, `sku`), date (`date`, `ds`), and sales quantity (`quantity`, `sales`, `units`). |
| `--assumptions` | Yes | - | Path to JSON file specifying per-SKU inventory cost and lead time parameters (`ordering_cost`, `holding_cost_annual`, `shortage_penalty`, `lead_time_mean`, `lead_time_std`, `service_level`, `unit_cost`), plus optional top-level `budget` and `capacity`. |
| `--output-dir` | No | `experiments/results` | Destination directory where the four output CSV files are written. |
| `--seed` | No | `42` | Fixed pseudorandom seed for scenario bootstrap generation and Monte Carlo simulation. |
| `--budget` | No | None | Optional portfolio inventory capital budget constraint in currency units. Overrides value in assumptions JSON. |
| `--capacity` | No | None | Optional portfolio total storage unit capacity constraint. Overrides value in assumptions JSON. |

---

## Column Definitions

The script outputs four CSV files in the results directory:
1. `model_comparison.csv`
2. `policy_comparison.csv`
3. `service_level_sweep.csv`
4. `portfolio_cost.csv`

---

### 1. `model_comparison.csv`

Per-SKU backtest evaluation across rolling origins comparing baseline and candidate forecasting models.

| Column | Type | Description |
|---|---|---|
| `sku_id` | string | Unique SKU identifier. |
| `demand_class` | string | Syntetos-Boylan demand classification: `smooth`, `erratic`, `intermittent`, or `lumpy`. |
| `adi` | float | Average Demand Interval (average inter-arrival time between positive demand occurrences in days). |
| `cv2` | float | Squared coefficient of variation of non-zero demand quantities ($(\sigma / \mu)^2$). |
| `chosen_model` | string | Selected point forecast model based on lowest rolling MASE (`AutoETS`, `SeasonalNaive`, or `CrostonSBA`). |
| `mase_improvement` | float | Percentage MASE reduction of the chosen model relative to SeasonalNaive baseline. |
| `seasonal_naive_mae` | float | Mean Absolute Error for SeasonalNaive across 8 rolling cutoffs. |
| `seasonal_naive_rmse` | float | Root Mean Squared Error for SeasonalNaive across 8 rolling cutoffs. |
| `seasonal_naive_wape` | float | Weighted Absolute Percentage Error for SeasonalNaive ($\sum \|y - \hat{y}\| / \sum y$). |
| `seasonal_naive_mase` | float | Mean Absolute Scaled Error for SeasonalNaive scaled by in-sample seasonal differences ($m=7$). |
| `seasonal_naive_coverage` | float | Empirical coverage of SeasonalNaive 80% prediction interval (nominal target: 0.80). |
| `autoets_mae` | float | Mean Absolute Error for AutoETS across 8 rolling cutoffs. |
| `autoets_rmse` | float | Root Mean Squared Error for AutoETS across 8 rolling cutoffs. |
| `autoets_wape` | float | Weighted Absolute Percentage Error for AutoETS. |
| `autoets_mase` | float | Mean Absolute Scaled Error for AutoETS. |
| `autoets_coverage` | float | Empirical coverage of AutoETS 80% prediction interval. |
| `croston_sba_mae` | float | Mean Absolute Error for Croston SBA (populated for intermittent/lumpy series; empty otherwise). |
| `croston_sba_rmse` | float | Root Mean Squared Error for Croston SBA. |
| `croston_sba_wape` | float | Weighted Absolute Percentage Error for Croston SBA. |
| `croston_sba_mase` | float | Mean Absolute Scaled Error for Croston SBA. |
| `croston_sba_coverage` | float | Empirical coverage of Croston simulated 80% prediction interval. |

---

### 2. `policy_comparison.csv`

Performance comparison across replenishment policies on simulated bootstrap scenarios and on actual held-out demand.

| Column | Type | Description |
|---|---|---|
| `sku_id` | string | Unique SKU identifier. |
| `policy` | string | Replenishment policy name: `deterministic`, `uncertainty_aware`, or `quantile`. |
| `eoq` | integer | Economic Order Quantity lot size ($Q = \sqrt{2 D S / H}$). |
| `rop` | integer | Reorder point computed under the corresponding policy ($s$). |
| `sim_total_cost` | float | Mean total operational inventory cost across Monte Carlo bootstrap scenarios. |
| `sim_service_level` | float | Achieved fill rate across simulated scenarios ($1 - \text{lost units} / \text{total demand}$). |
| `sim_holding_cost` | float | Mean inventory holding cost across simulated scenarios. |
| `sim_ordering_cost` | float | Mean fixed replenishment ordering cost across simulated scenarios. |
| `sim_shortage_cost` | float | Mean penalty cost incurred from stockouts across simulated scenarios. |
| `sim_avg_inventory` | float | Mean daily physical on-hand inventory level across simulated scenarios. |
| `sim_stockout_units` | float | Mean cumulative lost sales units across simulated scenarios. |
| `actual_total_cost` | float | Total inventory cost observed on actual held-out demand history (28-day replay). |
| `actual_service_level` | float | Achieved fill rate on actual held-out demand history. |
| `actual_holding_cost` | float | Realized inventory holding cost on actual held-out demand history. |
| `actual_ordering_cost` | float | Realized fixed ordering cost on actual held-out demand history. |
| `actual_shortage_cost` | float | Realized stockout penalty cost on actual held-out demand history. |
| `actual_avg_inventory` | float | Realized average daily on-hand inventory level on actual held-out demand history. |
| `actual_stockout_days` | integer | Number of days experiencing stockouts during the 28-day holdout replay. |
| `actual_stockout_units` | float | Total lost sales units during the 28-day holdout replay. |

---

### 3. `service_level_sweep.csv`

Cost and inventory trade-off points evaluated across target service levels $\alpha \in [0.80, 0.98]$ in increments of 0.02.

| Column | Type | Description |
|---|---|---|
| `sku_id` | string | Unique SKU identifier. |
| `target_service_level` | float | Nominal target cycle service level ($\alpha$). |
| `policy` | string | Policy evaluated: `deterministic`, `uncertainty_aware`, or `quantile`. |
| `rop` | integer | Reorder point calculated for the target service level. |
| `total_cost` | float | Simulated expected total operational cost at the specified target service level. |
| `achieved_fill_rate` | float | Simulated empirical fill rate achieved by the policy at this target service level. |
| `avg_inventory` | float | Simulated expected average on-hand inventory units at this target service level. |

---

### 4. `portfolio_cost.csv`

Multi-SKU portfolio resource allocation comparing unconstrained cost-minimizing targets against budget- and capacity-constrained plans. Includes per-SKU allocation rows and a final `PORTFOLIO_TOTAL` aggregate summary row.

| Column | Type | Description |
|---|---|---|
| `sku_id` | string | Unique SKU identifier, or `PORTFOLIO_TOTAL` for the portfolio aggregate row. |
| `unconstrained_service_level` | float | Service level chosen to minimize total inventory cost in the absence of portfolio constraints. |
| `constrained_service_level` | float | Service level assigned under portfolio budget and capacity constraints. |
| `unconstrained_rop` | integer | Reorder point under unconstrained policy (sum across SKUs on `PORTFOLIO_TOTAL` row). |
| `constrained_rop` | integer | Reorder point under constrained policy (sum across SKUs on `PORTFOLIO_TOTAL` row). |
| `unconstrained_avg_inventory` | float | Expected average on-hand inventory units unconstrained. |
| `constrained_avg_inventory` | float | Expected average on-hand inventory units constrained. |
| `unconstrained_inventory_investment` | float | Capital invested in inventory unconstrained ($\text{avg\_inventory} \times \text{unit\_cost}$). |
| `constrained_inventory_investment` | float | Capital invested in inventory under portfolio constraints. |
| `unconstrained_total_cost` | float | Expected total inventory cost unconstrained. |
| `constrained_total_cost` | float | Expected total inventory cost under portfolio constraints. |
| `cost_delta` | float | Net operational cost difference ($\text{constrained\_total\_cost} - \text{unconstrained\_total\_cost}$). |
| `unconstrained_turnover` | float | Annual inventory turnover ratio unconstrained ($\text{annual\_demand} / \text{avg\_inventory}$). |
| `constrained_turnover` | float | Annual inventory turnover ratio under portfolio constraints. |
| `budget` | float | Portfolio budget limit applied (currency units). Populated on `PORTFOLIO_TOTAL` row. |
| `capacity` | float | Portfolio storage unit capacity limit applied. Populated on `PORTFOLIO_TOTAL` row. |
| `budget_shadow_price` | float | Marginal operational cost reduction per currency unit of additional budget. Populated on `PORTFOLIO_TOTAL` row. |
| `binding_constraints` | string | Semicolon-delimited list of binding constraints (`budget`, `capacity`, or `none`). Populated on `PORTFOLIO_TOTAL` row. |
