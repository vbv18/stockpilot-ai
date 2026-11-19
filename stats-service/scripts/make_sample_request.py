import json

import numpy as np

rng = np.random.default_rng(7)


def series(n: int, base: float, amp: float, noise: float) -> list[float]:
    t = np.arange(n)
    vals = np.clip(base + amp * np.sin(2 * np.pi * t / 7) + rng.normal(0, noise, n), 0, None)
    return np.rint(vals).tolist()


body = {
    "series": [
        {"sku_id": "SYN-A", "start_date": "2026-01-01", "values": series(220, 40, 12, 6)},
        {"sku_id": "SYN-B", "start_date": "2026-01-01", "values": series(220, 15, 5, 4)},
        {"sku_id": "SYN-SHORT", "start_date": "2026-01-01", "values": series(30, 10, 2, 2)},
        {"sku_id": "SYN-ZERO", "start_date": "2026-01-01", "values": [0] * 120},
    ],
    "params": {"seed": 42},
}
print(json.dumps(body))
