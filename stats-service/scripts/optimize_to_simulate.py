import json
import sys

fc = json.load(open(sys.argv[1]))
op = json.load(open(sys.argv[2]))
by = {s["sku_id"]: s for s in fc["skus"]}
skus = []
for o in op["skus"]:
    if o["status"] != "ok":
        continue
    f = by[o["sku_id"]]
    skus.append({
        "sku_id": o["sku_id"], "forecast_mean": f["autoets_mean"], "residual_blocks": f["residual_blocks"],
        "eoq": o["eoq"], "rop_deterministic": o["rop_deterministic"], "rop_uncertainty_aware": o["rop_uncertainty_aware"],
    })
p = op["params"]
params = {
    "ordering_cost": p["ordering_cost"], "holding_cost_daily": p["holding_cost_daily"], "shortage_penalty": p["shortage_penalty"],
    "lead_time_days": p["lead_time_days"], "n_scenarios": 500, "horizon_days": 90, "block_size": p["block_size"], "seed": 123,
}
print(json.dumps({"skus": skus, "params": params}))
