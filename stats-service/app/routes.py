import statsforecast
from fastapi import APIRouter, Depends

from .config import SERVICE_VERSION
from .security import require_service_key

public_router = APIRouter()
private_router = APIRouter(dependencies=[Depends(require_service_key)])


@public_router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service_version": SERVICE_VERSION,
        "statsforecast_version": getattr(statsforecast, "__version__", "unknown"),
    }
