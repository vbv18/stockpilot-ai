"""
stats-service/app/engine/dependency.py
Computes demand dependency across SKUs:
1. Aggregates daily demand matrix to weekly sums.
2. Computes Pearson correlation matrix R.
3. Finds pairs with |rho| >= 0.3 classified as 'complementary' (rho > 0) or 'substitute-like' (rho < 0).
4. Computes portfolio risk pooling ratio: sqrt(sigma' R sigma) / sum(sigma_i).
"""

from __future__ import annotations

import math
from typing import Any, Dict, List, Union
import numpy as np
import pandas as pd


def compute_dependency(
    daily_matrix: Union[pd.DataFrame, Dict[str, Any], List[Any], np.ndarray],
    forecast_error_std: Union[Dict[str, float], List[float], np.ndarray],
) -> Dict[str, Any]:
    """
    Computes weekly demand dependency, Pearson correlation matrix R,
    identified complementary/substitute pairs (|rho| >= 0.3),
    and portfolio risk pooling ratio: sqrt(sigma' R sigma) / sum(sigma_i).
    """
    # 1. Convert daily_matrix to DataFrame with SKU columns
    if isinstance(daily_matrix, pd.DataFrame):
        df = daily_matrix.copy()
        if "sku_id" in df.columns and ("quantity" in df.columns or "y" in df.columns):
            val_col = "quantity" if "quantity" in df.columns else "y"
            date_col = "date" if "date" in df.columns else df.columns[1]
            df = df.pivot(index=date_col, columns="sku_id", values=val_col)
            df.index = pd.to_datetime(df.index)
        elif "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"])
            df = df.set_index("date")
    elif isinstance(daily_matrix, list):
        series_dict = {}
        for s in daily_matrix:
            sku = getattr(s, "sku_id", None) or (s.get("sku_id") if isinstance(s, dict) else None)
            vals = getattr(s, "values", None) or (s.get("values") if isinstance(s, dict) else None)
            s_date = getattr(s, "start_date", None) or (s.get("start_date") if isinstance(s, dict) else None)
            if sku is not None and vals is not None:
                if s_date:
                    idx = pd.date_range(start=pd.to_datetime(s_date), periods=len(vals), freq="D")
                    series_dict[str(sku)] = pd.Series(vals, index=idx, dtype=float)
                else:
                    series_dict[str(sku)] = pd.Series(vals, dtype=float)
        df = pd.DataFrame(series_dict)
    elif isinstance(daily_matrix, dict):
        df = pd.DataFrame(daily_matrix)
    elif isinstance(daily_matrix, np.ndarray):
        df = pd.DataFrame(daily_matrix)
    else:
        df = pd.DataFrame(daily_matrix)

    df = df.fillna(0.0).astype(float)
    sku_ids = [str(c) for c in df.columns]
    n = len(sku_ids)

    # 2. Aggregate to weekly
    if isinstance(df.index, pd.DatetimeIndex):
        weekly_df = df.resample("W-SUN").sum()
    else:
        n_rows = len(df)
        weekly_df = df.groupby(np.arange(n_rows) // 7).sum()

    weekly_df = weekly_df.fillna(0.0)

    # Filter to include only SKUs with >= 20 non-zero weeks
    active_weeks = (weekly_df > 0).sum(axis=0)
    eligible_skus = [c for c in weekly_df.columns if active_weeks[c] >= 20]
    if eligible_skus:
        weekly_df = weekly_df[eligible_skus]
        sku_ids = [str(c) for c in weekly_df.columns]
        n = len(sku_ids)
    else:
        # If no SKUs meet 20 non-zero weeks, keep columns to avoid empty matrix
        sku_ids = [str(c) for c in weekly_df.columns]
        n = len(sku_ids)

    # 3. Pearson correlation matrix R
    if n > 1 and len(weekly_df) > 1:
        R_df = weekly_df.corr(method="pearson").fillna(0.0)
        np.fill_diagonal(R_df.values, 1.0)
        R_df = R_df.clip(-1.0, 1.0)
    else:
        R_df = pd.DataFrame(np.eye(n), index=sku_ids, columns=sku_ids)

    # 4. Filter pairs with |rho| >= 0.5
    pairs: List[Dict[str, Any]] = []
    for i in range(n):
        for j in range(i + 1, n):
            rho = float(R_df.iloc[i, j])
            if abs(rho) >= 0.5:
                relation = "complementary" if rho > 0 else "substitute-like"
                pairs.append({
                    "sku_i": sku_ids[i],
                    "sku_j": sku_ids[j],
                    "rho": round(rho, 4),
                    "relation": relation,
                })

    pairs.sort(key=lambda p: abs(p["rho"]), reverse=True)

    # 5. Risk pooling ratio: sqrt(sigma' R sigma) / sum(sigma_i) using weekly sigma (sigma_d * sqrt(7))
    if isinstance(forecast_error_std, dict):
        sigma = np.array([float(forecast_error_std.get(s, 1.0)) for s in sku_ids], dtype=float)
    elif isinstance(forecast_error_std, (list, tuple, np.ndarray)):
        sigma = np.asarray(forecast_error_std, dtype=float)
        if len(sigma) != n:
            sigma = np.ones(n, dtype=float)
    else:
        sigma = np.ones(n, dtype=float)

    sigma = np.maximum(sigma, 0.0)
    sigma_weekly = sigma * math.sqrt(7.0)
    R_mat = R_df.values
    quad_form = float(sigma_weekly @ R_mat @ sigma_weekly)
    quad_form = max(0.0, quad_form)
    sum_sigma = float(np.sum(sigma_weekly))

    if sum_sigma > 1e-9:
        pooling_ratio = math.sqrt(quad_form) / sum_sigma
    else:
        pooling_ratio = 1.0
    pooling_ratio = round(pooling_ratio, 4)

    matrix_list = [[round(float(val), 4) for val in row] for row in R_mat]

    return {
        "sku_order": sku_ids,
        "correlation_matrix": matrix_list,
        "pairs": pairs,
        "pooling_ratio": pooling_ratio,
    }
