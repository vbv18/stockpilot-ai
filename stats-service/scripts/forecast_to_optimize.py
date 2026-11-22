import json
import sys

fc = json.load(sys.stdin)
skus = [
    {"sku_id": s["sku_id"], "forecast_mean": s["autoets_mean"], "residual_blocks": s["residual_blocks"], "residual_std": s["residual_std"]}
    for s in fc["skus"] if s["status"] == "ok" and s["interval_status"] == "ok"
]
params = {
    "n_bootstrap": fc["params"]["n_bootstrap"], "block_size": fc["params"]["block_size"],
    "bootstrap_seed": fc["params"]["seed"],
}
assumptions = {
    s["sku_id"]: {
        "ordering_cost": 200, "holding_cost_annual": 1825, "shortage_penalty": 50,
        "lead_time_mean": 7, "lead_time_std": 0, "service_level": 0.95, "unit_cost": 100,
    }
    for s in skus
}
print(json.dumps({"skus": skus, "params": params, "assumptions": assumptions}))
