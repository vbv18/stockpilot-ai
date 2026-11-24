from __future__ import annotations

import logging
from typing import Any, Dict

import lightgbm
from lightgbm import LGBMRegressor
import numpy as np
import pandas as pd

log = logging.getLogger("stats.global_lgbm")

FEATURE_COLS = [
    "sku_code",
    "dow",
    "sin_dow",
    "cos_dow",
    "sin_doy",
    "cos_doy",
    "lag_1",
    "lag_7",
    "lag_14",
    "roll_mean_7",
    "roll_mean_28",
    "sku_mean",
    "sku_std",
    "sku_zero_ratio",
]


def fit_predict_global_quantile(
    panel_df: pd.DataFrame,
    horizon: int,
    seed: int,
) -> Dict[str, Dict[str, np.ndarray]]:
    """
    Fits global quantile LightGBM models across a panel of SKUs and generates
    recursive multi-step forecasts with P50 feedback for quantiles [0.1, 0.5, 0.9].

    Parameters
    ----------
    panel_df : pd.DataFrame
        DataFrame with columns ['sku_id', 'date', 'y'].
    horizon : int
        Forecast horizon (number of days ahead).
    seed : int
        RNG seed for model reproducibility.

    Returns
    -------
    dict
        {sku_id: {'p10': np.ndarray, 'p50': np.ndarray, 'p90': np.ndarray}}
        Enforcing 0 <= p10 <= p50 <= p90.
    """
    if panel_df is None or len(panel_df) == 0:
        return {}

    df = panel_df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["sku_id", "date"]).reset_index(drop=True)
    df["y"] = df["y"].astype(float)

    sku_list = sorted(df["sku_id"].unique().tolist())
    sku_to_code = {s: i for i, s in enumerate(sku_list)}
    df["sku_code"] = df["sku_id"].map(sku_to_code).astype(int)

    # Compute SKU mean, std, zero_ratio on train only
    sku_stats: Dict[str, Dict[str, float]] = {}
    for s in sku_list:
        sub_y = df[df["sku_id"] == s]["y"].values
        m = float(np.mean(sub_y)) if len(sub_y) > 0 else 0.0
        std = float(np.std(sub_y, ddof=1)) if len(sub_y) > 1 else 0.0
        if not np.isfinite(std):
            std = 0.0
        zr = float(np.mean(sub_y == 0.0)) if len(sub_y) > 0 else 0.0
        sku_stats[s] = {"mean": m, "std": std, "zero_ratio": zr}

    df["sku_mean"] = df["sku_id"].map(lambda s: sku_stats[s]["mean"]).astype(float)
    df["sku_std"] = df["sku_id"].map(lambda s: sku_stats[s]["std"]).astype(float)
    df["sku_zero_ratio"] = df["sku_id"].map(lambda s: sku_stats[s]["zero_ratio"]).astype(float)

    dow = df["date"].dt.dayofweek
    df["dow"] = dow.astype(int)
    df["sin_dow"] = np.sin(2.0 * np.pi * dow / 7.0).astype(float)
    df["cos_dow"] = np.cos(2.0 * np.pi * dow / 7.0).astype(float)

    doy = df["date"].dt.dayofyear
    df["sin_doy"] = np.sin(2.0 * np.pi * doy / 365.25).astype(float)
    df["cos_doy"] = np.cos(2.0 * np.pi * doy / 365.25).astype(float)

    df["lag_1"] = df.groupby("sku_id")["y"].shift(1).astype(float)
    df["lag_7"] = df.groupby("sku_id")["y"].shift(7).astype(float)
    df["lag_14"] = df.groupby("sku_id")["y"].shift(14).astype(float)

    df["roll_mean_7"] = (
        df.groupby("sku_id")["y"]
        .shift(1)
        .rolling(7, min_periods=1)
        .mean()
        .astype(float)
    )
    df["roll_mean_28"] = (
        df.groupby("sku_id")["y"]
        .shift(1)
        .rolling(28, min_periods=1)
        .mean()
        .astype(float)
    )

    valid_mask = df["lag_14"].notna()
    if valid_mask.sum() < 20:
        valid_mask = df["lag_1"].notna()
    if valid_mask.sum() == 0:
        valid_mask = pd.Series(True, index=df.index)

    df_train = df[valid_mask].copy()
    X_train = df_train[FEATURE_COLS]
    y_train = df_train["y"].values

    n_samples = len(X_train)
    min_child = max(1, min(20, n_samples // 2))

    models: Dict[float, LGBMRegressor] = {}
    for alpha in [0.1, 0.5, 0.9]:
        reg = LGBMRegressor(
            objective="quantile",
            alpha=alpha,
            n_estimators=150,
            learning_rate=0.05,
            num_leaves=15,
            min_child_samples=min_child,
            n_jobs=2,
            verbosity=-1,
            random_state=seed,
        )
        reg.fit(X_train, y_train)
        models[alpha] = reg

    # Recursive multi-step forecasting with P50 feedback
    history = {s: list(df[df["sku_id"] == s]["y"].values) for s in sku_list}
    last_dates = {s: df[df["sku_id"] == s]["date"].max() for s in sku_list}
    preds: Dict[str, Dict[str, list[float]]] = {s: {"p10": [], "p50": [], "p90": []} for s in sku_list}

    for step in range(1, horizon + 1):
        step_rows: list[dict[str, Any]] = []
        for s in sku_list:
            cur_date = last_dates[s] + pd.Timedelta(days=step)
            cur_dow = int(cur_date.dayofweek)
            cur_doy = int(cur_date.dayofyear)
            hist = history[s]

            l1 = hist[-1] if len(hist) >= 1 else sku_stats[s]["mean"]
            l7 = hist[-7] if len(hist) >= 7 else l1
            l14 = hist[-14] if len(hist) >= 14 else l7

            r7 = float(np.mean(hist[-7:])) if len(hist) >= 1 else sku_stats[s]["mean"]
            r28 = float(np.mean(hist[-28:])) if len(hist) >= 1 else sku_stats[s]["mean"]

            step_rows.append({
                "sku_code": sku_to_code[s],
                "dow": cur_dow,
                "sin_dow": float(np.sin(2.0 * np.pi * cur_dow / 7.0)),
                "cos_dow": float(np.cos(2.0 * np.pi * cur_dow / 7.0)),
                "sin_doy": float(np.sin(2.0 * np.pi * cur_doy / 365.25)),
                "cos_doy": float(np.cos(2.0 * np.pi * cur_doy / 365.25)),
                "lag_1": float(l1),
                "lag_7": float(l7),
                "lag_14": float(l14),
                "roll_mean_7": float(r7),
                "roll_mean_28": float(r28),
                "sku_mean": sku_stats[s]["mean"],
                "sku_std": sku_stats[s]["std"],
                "sku_zero_ratio": sku_stats[s]["zero_ratio"],
            })

        X_step = pd.DataFrame(step_rows)[FEATURE_COLS]

        raw_10 = models[0.1].predict(X_step)
        raw_50 = models[0.5].predict(X_step)
        raw_90 = models[0.9].predict(X_step)

        # Enforce 0 <= p10 <= p50 <= p90
        p10_clean = np.maximum(0.0, raw_10)
        p50_clean = np.maximum(p10_clean, raw_50)
        p90_clean = np.maximum(p50_clean, raw_90)

        for i, s in enumerate(sku_list):
            v10 = float(p10_clean[i])
            v50 = float(p50_clean[i])
            v90 = float(p90_clean[i])
            preds[s]["p10"].append(v10)
            preds[s]["p50"].append(v50)
            preds[s]["p90"].append(v90)
            history[s].append(v50)

    return {
        s: {
            "p10": np.asarray(preds[s]["p10"], dtype=float),
            "p50": np.asarray(preds[s]["p50"], dtype=float),
            "p90": np.asarray(preds[s]["p90"], dtype=float),
        }
        for s in sku_list
    }
