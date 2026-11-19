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
    """Residual block bootstrap.

    mean_path: baseline mean demand (length m). If horizon > m the mean is tiled (pattern repeated).
    blocks: array (B, block_size) of residual blocks (actual - forecast).
    Returns array (n_paths, horizon) of demand clipped at zero (NOT rounded).
    """
    mean_path = np.asarray(mean_path, dtype=float)
    blocks = np.asarray(blocks, dtype=float)
    if blocks.ndim != 2 or blocks.shape[0] < 1 or blocks.shape[1] != block_size:
        raise ValueError("residual blocks must have shape (B, block_size) with B >= 1")
    if mean_path.ndim != 1 or mean_path.shape[0] < 1:
        raise ValueError("mean_path must be a non-empty 1-D array")
    base = np.tile(mean_path, int(np.ceil(horizon / mean_path.shape[0])))[:horizon]
    n_blocks = int(np.ceil(horizon / block_size))
    idx = rng.integers(0, blocks.shape[0], size=(n_paths, n_blocks))
    noise = blocks[idx].reshape(n_paths, n_blocks * block_size)[:, :horizon]
    return np.clip(base[None, :] + noise, 0.0, None)
