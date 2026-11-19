import os
from functools import lru_cache

SERVICE_VERSION = "1.0.0"


class Settings:
    def __init__(self) -> None:
        key = os.environ.get("STATS_SERVICE_KEY", "")
        if len(key) < 16:
            raise RuntimeError("STATS_SERVICE_KEY must be set and at least 16 characters")
        self.stats_service_key: str = key
        self.log_level: str = os.environ.get("LOG_LEVEL", "INFO").upper()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
