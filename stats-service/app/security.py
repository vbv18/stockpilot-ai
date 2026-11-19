import hmac
from typing import Optional

from fastapi import Header, HTTPException

from .config import get_settings


def require_service_key(x_service_key: Optional[str] = Header(default=None)) -> None:
    expected = get_settings().stats_service_key
    if not x_service_key or not hmac.compare_digest(x_service_key.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid or missing service key")
