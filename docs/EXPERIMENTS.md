# StockPilot AI Experimentation Suite

This document describes the offline evaluation CLI (`stats-service/experiments/run_experiments.py`), its invocation commands, output files, schema columns, and generated figures.

## 1. Execution Commands

The experimentation script executes the numerical engine across historical daily sales series:

```bash
# From repository root using the virtual environment Python interpreter:
.\stats-service\.venv\Scripts\python.exe stats-service/experiments/run_experiments.py --csv <path_to_daily_sales.csv> --assumptions <path_to_assumptions.json>

# Linux / macOS:
./stats-service/.venv/bin/python stats-service/experiments/run_experiments.py --csv <path_to_daily_sales.csv> --assumptions <path_to_assumptions.json>
```

### CLI Arguments

| Argument | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `--csv` | string | Yes | - | Path to input daily sales CSV containing SKU demand series. Resolved columns: SKU (`sku_id`, `sku`, `item_id`, `item`, `stockcode`, `product_id`), date (`date`, `ds`, `timestamp`, `day`, `invoice_date`), and quantity (`quantity`, `qty`, `sales`, `units`, `demand`, `y`, `volume`). |
| `--assumptions` | string | No | `None` | Path to JSON file specifying per-SKU parameters (`unit_cost`, `order_cost`, `holding_rate`, `shortage_cost`, `lead_time_mean`, `lead_time_std`, `target_service_level`, `moq`, `pack_size`, `initial_stock`), with optional top-level `budget` and `capacity`. If omitted, distinct per-SKU assumptions are generated automatically. |
| `--tag` | string | No | `None` | Experiment tag sub-folder. When specified, results and figures are written to `experiments/results/<tag>/`. |
| `--output-dir` | string | No | `experiments/results` | Base directory where CSV files, figures, and summary reports are written. |
| `--seed` | integer | No | `42` | Random seed for bootstrap scenario paths and evaluation folds. |
| `--budget` | float | No | `None` | Portfolio working capital budget constraint. If omitted, defaults to 85% of unconstrained inventory investment. |
| `--capacity` | float | No | `None` | Portfolio unit capacity constraint. |

## 2. Output Files

Running the script produces seven CSV files, six PNG figures, and one markdown summary report in `--output-dir` (or `experiments/results/<tag>/`):

### 2.1 Generated CSV Files

1. `model_comparison.csv`: Out-of-sample rolling-origin backtest metrics across candidate forecasting models (folds 1–5 for selection, folds 6–8 for reporting, non-overlapping step 28).
2. `baseline_improvement.csv`: Percentage improvement over Naive baseline in MAE, RMSE, WAPE, and coverage delta.
3. `policy_comparison.csv`: Simulated and holdout replay performance across three replenishment policies (`deterministic`, `uncertainty_aware`, `quantile`), including `ltd_calibration` and paired comparison 95% confidence intervals.
4. `service_level_sweep.csv`: Cost and inventory curves across service levels $\alpha \in [0.80, 0.98]$ in steps of 0.02.
5. `portfolio_cost.csv`: Multi-SKU portfolio resource allocation comparing unconstrained and constrained plans via exact MILP and greedy descent.
6. `portfolio_budget_sweep.csv`: Sweep across 6 evenly spaced budgets from minimum feasible to unconstrained investment, comparing greedy descent heuristic vs exact MILP solutions.
7. `dependency_pairs.csv`: Weekly demand Pearson correlation pairs with $|\rho| \ge 0.50$ across items with $\ge 20$ active weeks.
8. `validation.csv` (generated via `validate_policies.py`): Synthetic policy validation verifying $s_{\text{det}}, s_{\text{quant}}, s_{\text{emp}}$ across Poisson, lognormal-skewed, and lumpy regimes against nominal $\alpha=0.95$.

### 2.2 Generated Figures (`experiments/results/figures/`, 150 dpi)

1. `forecast_fan_chart.png`: Observed demand history, point forecast (P50), and 80% prediction interval (P10-P90) for one smooth and one intermittent SKU.
2. `mase_by_model.png`: Grouped bar chart of rolling-origin MASE across candidate forecasting models per SKU, with horizontal reference at MASE = 1.0.
3. `policy_fill_rate_vs_cost.png`: Scatter plot comparing simulated fill rate vs total cost across policies (`deterministic`, `uncertainty_aware`, `quantile`), with mean marker overlays.
4. `service_level_cost_curves.png`: Operational cost escalation as target cycle service level increases from $\alpha = 0.80$ to $\alpha = 0.98$.
5. `portfolio_frontier.png`: Total portfolio cost vs budget limit, showing greedy heuristic curve vs exact MILP frontier and shaded optimality gap.
6. `correlation_heatmap.png`: Two-dimensional weekly demand Pearson correlation matrix ($\mathbf{R}$) annotated with the portfolio risk pooling ratio.

### 2.3 Generated Markdown Report

- `results_summary.md`: Auto-generated summary report containing markdown tables of all seven CSV outputs.

## 3. CSV Column Definitions

### 3.1 `model_comparison.csv`

| Column | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `sku_id` | string | - | Unique SKU identifier. |
| `demand_class` | string | - | Syntetos-Boylan classification (`smooth`, `erratic`, `intermittent`, `lumpy`). |
| `adi` | float | days | Average Demand Interval ($N / \sum \mathbf{1}(y_t > 0)$). |
| `cv2` | float | - | Squared coefficient of variation of non-zero demands ($(\sigma / \mu)^2$). |
| `chosen_model` | string | - | Winning model selected by lowest rolling MASE. |
| `mase_improvement` | float | % | Percentage MASE reduction vs SeasonalNaive baseline. |
| `seasonal_naive_mae` | float | units/day | Mean Absolute Error for SeasonalNaive across 8 folds. |
| `seasonal_naive_rmse` | float | units/day | Root Mean Squared Error for SeasonalNaive across 8 folds. |
| `seasonal_naive_wape` | float | ratio | Weighted Absolute Percentage Error ($\sum \|e\| / \sum y$) for SeasonalNaive. |
| `seasonal_naive_mase` | float | ratio | Mean Absolute Scaled Error scaled by in-sample seasonal differences ($m=7$). |
| `seasonal_naive_coverage` | float | ratio | Empirical coverage of SeasonalNaive 80% prediction band. |
| `autoets_mae` | float | units/day | Mean Absolute Error for AutoETS. |
| `autoets_rmse` | float | units/day | Root Mean Squared Error for AutoETS. |
| `autoets_wape` | float | ratio | Weighted Absolute Percentage Error for AutoETS. |
| `autoets_mase` | float | ratio | Mean Absolute Scaled Error for AutoETS. |
| `autoets_coverage` | float | ratio | Empirical coverage of AutoETS 80% prediction band. |
| `croston_sba_mae` | float | units/day | Mean Absolute Error for Croston SBA (intermittent/lumpy series). |
| `croston_sba_rmse` | float | units/day | Root Mean Squared Error for Croston SBA. |
| `croston_sba_wape` | float | ratio | Weighted Absolute Percentage Error for Croston SBA. |
| `croston_sba_mase` | float | ratio | Mean Absolute Scaled Error for Croston SBA. |
| `croston_sba_coverage` | float | ratio | Empirical coverage of Croston simulated 80% prediction band. |
| `naive_mae` | float | units/day | Mean Absolute Error for Naive baseline. |
| `naive_rmse` | float | units/day | Root Mean Squared Error for Naive baseline. |
| `naive_wape` | float | ratio | Weighted Absolute Percentage Error for Naive baseline. |
| `naive_mase` | float | ratio | Mean Absolute Scaled Error for Naive baseline. |
| `naive_coverage` | float | ratio | Empirical coverage of Naive baseline 80% prediction band. |
| `global_lgbm_mae` | float | units/day | Mean Absolute Error for GlobalLGBM (smooth/erratic series). |
| `global_lgbm_rmse` | float | units/day | Root Mean Squared Error for GlobalLGBM. |
| `global_lgbm_wape` | float | ratio | Weighted Absolute Percentage Error for GlobalLGBM. |
| `global_lgbm_mase` | float | ratio | Mean Absolute Scaled Error for GlobalLGBM. |
| `global_lgbm_coverage` | float | ratio | Empirical coverage of GlobalLGBM native quantile band (P10-P90). |

### 3.2 `baseline_improvement.csv`

| Column | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `sku_id` | string | - | Unique SKU identifier, or `OVERALL` for the portfolio mean row. |
| `chosen_model` | string | - | Winning model selected by lowest rolling MASE (`N/A` for `OVERALL`). |
| `mae_pct` | float | % | Percentage reduction in MAE of chosen model vs Naive: $(\text{MAE}_{\text{naive}} - \text{MAE}_{\text{chosen}}) / \text{MAE}_{\text{naive}} \times 100$. |
| `rmse_pct` | float | % | Percentage reduction in RMSE of chosen model vs Naive: $(\text{RMSE}_{\text{naive}} - \text{RMSE}_{\text{chosen}}) / \text{RMSE}_{\text{naive}} \times 100$. |
| `wape_pct` | float | % | Percentage reduction in WAPE of chosen model vs Naive: $(\text{WAPE}_{\text{naive}} - \text{WAPE}_{\text{chosen}}) / \text{WAPE}_{\text{naive}} \times 100$. |
| `coverage_minus_nominal` | float | delta | Empirical coverage of chosen model minus nominal 0.80 ($\text{coverage} - 0.80$). |

### 3.3 `policy_comparison.csv`

| Column | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `sku_id` | string | - | Unique SKU identifier. |
| `policy` | string | - | Replenishment policy: `deterministic`, `uncertainty_aware`, or `quantile`. |
| `eoq` | integer | units | Economic Order Quantity lot size ($Q = \max(\text{moq}, \lceil Q_{\text{raw}} / P \rceil P)$). |
| `rop` | integer | units | Reorder point ($s$) under the policy. |
| `sim_total_cost` | float | currency | Mean total operational cost across 500 simulated 90-day scenarios. |
| `sim_service_level` | float | ratio | Mean achieved fill rate across simulated scenarios ($1 - \text{lost} / \text{demand}$). |
| `sim_csl` | float | ratio | Mean cycle service level ($1 - \text{cycle\_stockouts} / \text{orders}$). |
| `ltd_calibration` | float | ratio | Proportion of fresh-path lead-time demand scenarios with $\text{LTD} \le s$. |
| `sim_holding_cost` | float | currency | Mean holding cost across simulated scenarios. |
| `sim_ordering_cost` | float | currency | Mean ordering cost across simulated scenarios. |
| `sim_shortage_cost` | float | currency | Mean shortage penalty cost across simulated scenarios. |
| `sim_avg_inventory` | float | units | Mean daily physical on-hand inventory across simulated scenarios. |
| `sim_stockout_units` | float | units | Mean unfulfilled lost sales units across simulated scenarios. |
| `actual_total_cost` | float | currency | Total cost evaluated on actual held-out demand history (28-day replay). |
| `actual_service_level` | float | ratio | Realized fill rate on actual held-out demand history. |
| `actual_holding_cost` | float | currency | Realized holding cost on actual held-out demand history. |
| `actual_ordering_cost` | float | currency | Realized ordering cost on actual held-out demand history. |
| `actual_shortage_cost` | float | currency | Realized shortage cost on actual held-out demand history. |
| `actual_avg_inventory` | float | units | Realized average daily inventory on actual held-out demand history. |
| `actual_stockout_days` | integer | days | Days with unfulfilled demand during the 28-day holdout replay. |
| `actual_stockout_units` | float | units | Total lost sales units during the 28-day holdout replay. |

### 3.4 `service_level_sweep.csv`

| Column | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `sku_id` | string | - | Unique SKU identifier. |
| `target_service_level` | float | ratio | Target cycle service level ($\alpha \in [0.80, 0.98]$ in steps of 0.02). |
| `policy` | string | - | Replenishment policy (`deterministic`, `uncertainty_aware`, `quantile`). |
| `rop` | integer | units | Reorder point calculated for the target service level. |
| `total_cost` | float | currency | Simulated expected total operational cost at this target service level. |
| `achieved_fill_rate` | float | ratio | Simulated empirical fill rate achieved by the policy. |
| `avg_inventory` | float | units | Simulated average physical on-hand inventory level. |

### 3.5 `portfolio_cost.csv`

| Column | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `sku_id` | string | - | Unique SKU identifier, or `PORTFOLIO_TOTAL` for aggregate row. |
| `unconstrained_service_level` | float | ratio | Service level selected by unconstrained cost minimization. |
| `constrained_service_level` | float | ratio | Service level assigned under budget and capacity constraints. |
| `unconstrained_rop` | integer | units | Reorder point under unconstrained policy (summed on total row). |
| `constrained_rop` | integer | units | Reorder point under constrained policy (summed on total row). |
| `unconstrained_avg_inventory` | float | units | Expected average inventory units under unconstrained plan. |
| `constrained_avg_inventory` | float | units | Expected average inventory units under constrained plan. |
| `unconstrained_inventory_investment` | float | currency | Capital invested ($\text{avg\_inventory} \times \text{unit\_cost}$) unconstrained. |
| `constrained_inventory_investment` | float | currency | Capital invested under portfolio constraints. |
| `unconstrained_total_cost` | float | currency | Total operational cost unconstrained. |
| `constrained_total_cost` | float | currency | Total operational cost under portfolio constraints. |
| `cost_delta` | float | currency | Cost difference ($\text{constrained} - \text{unconstrained}$). |
| `unconstrained_turnover` | float | ratio | Inventory turnover ratio ($\text{annual\_demand} / \text{avg\_inventory}$) unconstrained. |
| `constrained_turnover` | float | ratio | Inventory turnover ratio under portfolio constraints. |
| `budget` | float | currency | Portfolio working capital budget constraint (populated on total row). |
| `capacity` | float | units | Portfolio storage unit capacity constraint (populated on total row). |
| `budget_shadow_price` | float | ratio | Central-difference shadow price: $(C(1.01 B) - C(0.99 B)) / (0.02 B)$. |
| `binding_constraints` | string | - | Semicolon-delimited list of binding constraints (`budget`, `capacity`, `none`). |

### 3.6 `portfolio_budget_sweep.csv`

| Column | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `budget_pct` | float | fraction | Fraction of unconstrained investment ($0.40, 0.52, 0.64, 0.76, 0.88, 1.00$). |
| `budget` | float | currency | Absolute inventory budget limit. |
| `status` | string | - | Solver feasibility status (`optimal` or `infeasible`). |
| `greedy_cost` | float | currency | Total operational cost under greedy heuristic allocation. |
| `exact_cost` | float | currency | Total operational cost under exact MILP allocation. |
| `optimality_gap_pct` | float | % | Heuristic gap percentage: $(C_{\text{greedy}} - C_{\text{exact}}) / C_{\text{exact}} \times 100$. |
| `greedy_avg_service_level` | float | ratio | Mean service level assigned by greedy heuristic. |
| `exact_avg_service_level` | float | ratio | Mean service level assigned by exact MILP solver. |
| `greedy_inventory_investment` | float | currency | Total working capital invested under greedy allocation. |
| `exact_inventory_investment` | float | currency | Total working capital invested under exact MILP allocation. |
| `budget_shadow_price` | float | ratio | Marginal shadow price evaluated via central difference perturbation. |
| `binding_constraints` | string | - | Semicolon-delimited active constraints (`budget`, `capacity`, `none`). |

### 3.7 `dependency_pairs.csv`

| Column | Type | Unit | Description |
| :--- | :--- | :--- | :--- |
| `sku_i` | string | - | Identifier for first SKU in pair. |
| `sku_j` | string | - | Identifier for second SKU in pair. |
| `rho` | float | - | Weekly demand Pearson correlation coefficient ($\rho$). |
| `relation` | string | - | Relationship: `complementary` ($\rho \ge 0.30$) or `substitute-like` ($\rho \le -0.30$). |
