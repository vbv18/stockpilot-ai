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
        "rop_quantile": o.get("rop_quantile", o["rop_uncertainty_aware"]),
    })
p = op["params"]
params = {
    "n_scenarios": 500, "horizon_days": 90, "block_size": p["block_size"], "seed": 123,
}
assumptions = {
    s["sku_id"]: {
        "ordering_cost": 200, "holding_cost_annual": 1825, "shortage_penalty": 50,
        "lead_time_mean": 7, "lead_time_std": 0, "service_level": 0.95, "unit_cost": 100,
    }
    for s in skus
}
print(json.dumps({"skus": skus, "params": params, "assumptions": assumptions}))
