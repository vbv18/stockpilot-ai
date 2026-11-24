from __future__ import annotations

import numpy as np


def block_cutoffs(n: int, min_history: int, block_size: int, origin_step: int) -> list[int]:
    """Training lengths c: train on y[:c], evaluate on y[c:c+block_size].

    Origins are spaced `origin_step` apart and aligned so the LAST block ends exactly at n.
    Every origin has at least `min_history` training observations. Returned ascending.
    """
    cutoffs: list[int] = []
    c = n - block_size
    while c >= min_history:
        cutoffs.append(c)
        c -= origin_step
    cutoffs.reverse()
    return cutoffs


def generate_paths(
    mean_path: np.ndarray,
    blocks: np.ndarray,
    n_paths: int,
    horizon: int,
    block_size: int,
    rng: np.random.Generator,
) -> np.ndarray:
    """Residual bootstrap indexed by horizon step h.

    mean_path: baseline mean demand (length m). If horizon > m the mean is tiled.
    blocks: array (B, block_size) of out-of-sample rolling-origin forecast residual blocks.
    Returns array (n_paths, horizon) of demand clipped at zero (NOT rounded).
    """
    mean_path = np.asarray(mean_path, dtype=float)
    blocks = np.asarray(blocks, dtype=float)
    if blocks.ndim != 2 or blocks.shape[0] < 1 or blocks.shape[1] != block_size:
        raise ValueError("residual blocks must have shape (B, block_size) with B >= 1")
    if mean_path.ndim != 1 or mean_path.shape[0] < 1:
        raise ValueError("mean_path must be a non-empty 1-D array")

    base = np.tile(mean_path, int(np.ceil(horizon / mean_path.shape[0])))[:horizon]
    noise = np.zeros((n_paths, horizon), dtype=float)
    b_len = blocks.shape[1]
    min_pool = 10

    for h in range(horizon):
        step = h if h < b_len else (b_len - 1)
        pool = blocks[:, step]
        if len(pool) < min_pool:
            start_step = max(0, step - 1)
            end_step = min(b_len, step + 2)
            pool = blocks[:, start_step:end_step].ravel()
            if len(pool) < min_pool:
                pool = blocks.ravel()
        noise[:, h] = rng.choice(pool, size=n_paths, replace=True)

    return np.clip(base[None, :] + noise, 0.0, None)
