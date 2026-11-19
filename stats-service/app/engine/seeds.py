import hashlib


def derive_seed(base_seed: int, *parts: str) -> int:
    """Deterministic 64-bit seed. Never use Python's hash() (it is salted per process)."""
    payload = ":".join([str(int(base_seed)), *parts]).encode("utf-8")
    return int.from_bytes(hashlib.blake2b(payload, digest_size=8).digest(), "big")
