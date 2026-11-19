import platform
import time
from datetime import datetime, timezone

import numpy as np
import statsforecast

from ..config import SERVICE_VERSION
from ..schemas import RunMeta


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class RunClock:
    def __init__(self) -> None:
        self._t0 = time.perf_counter()
        self._started = datetime.now(timezone.utc)

    def meta(self, seed: int) -> RunMeta:
        return RunMeta(
            service_version=SERVICE_VERSION,
            python_version=platform.python_version(),
            numpy_version=np.__version__,
            statsforecast_version=getattr(statsforecast, "__version__", "unknown"),
            seed=seed,
            started_at=_iso(self._started),
            finished_at=_iso(datetime.now(timezone.utc)),
            duration_ms=int((time.perf_counter() - self._t0) * 1000),
        )
