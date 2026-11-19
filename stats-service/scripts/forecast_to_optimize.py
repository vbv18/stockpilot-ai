import json
import sys

fc = json.load(sys.stdin)
skus = [
    {"sku_id": s["sku_id"], "forecast_mean": s["autoets_mean"], "residual_blocks": s["residual_blocks"], "residual_std": s["residual_std"]}
    for s in fc["skus"] if s["status"] == "ok" and s["interval_status"] == "ok"
]
params = {
    "ordering_cost": 200, "holding_cost_daily": 5, "shortage_penalty": 50,
    "lead_time_days": 7, "target_service_level": 0.95,
    "n_bootstrap": fc["params"]["n_bootstrap"], "block_size": fc["params"]["block_size"],
    "bootstrap_seed": fc["params"]["seed"],
}
print(json.dumps({"skus": skus, "params": params}))
