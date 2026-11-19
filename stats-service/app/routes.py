import numpy as np
import statsforecast
from fastapi import APIRouter, Depends, HTTPException

from .config import SERVICE_VERSION
from .engine.evaluation import aggregate, evaluate_series
from .engine.forecasting import fit_sku, to_sku_forecast
from .engine.inventory import optimize_sku
from .engine.meta import RunClock
from .engine.simulation import aggregate as aggregate_simulation, simulate_sku
from .schemas import (
    EvaluateRequest,
    EvaluateResponse,
    ForecastRequest,
    ForecastResponse,
    OptimizeRequest,
    OptimizeResponse,
    SimulateRequest,
    SimulateResponse,
)
from .security import require_service_key

public_router = APIRouter()
private_router = APIRouter(dependencies=[Depends(require_service_key)])


def _ensure_unique(ids: list[str]) -> None:
    if len(set(ids)) != len(ids):
        raise HTTPException(status_code=422, detail="Duplicate sku_id values in request")


@public_router.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "service_version": SERVICE_VERSION,
        "statsforecast_version": getattr(statsforecast, "__version__", "unknown"),
    }


@private_router.post("/forecast", response_model=ForecastResponse)
def forecast(req: ForecastRequest) -> ForecastResponse:
    _ensure_unique([s.sku_id for s in req.series])
    clock = RunClock()
    out = []
    for s in req.series:
        y = np.asarray(s.values, dtype=float)
        out.append(to_sku_forecast(fit_sku(s.sku_id, y, req.params), s.start_date, len(y)))
    return ForecastResponse(run_meta=clock.meta(req.params.seed), params=req.params, skus=out)


@private_router.post("/evaluate", response_model=EvaluateResponse)
def evaluate(req: EvaluateRequest) -> EvaluateResponse:
    _ensure_unique([s.sku_id for s in req.series])
    clock = RunClock()
    evals = [evaluate_series(s.sku_id, s.start_date, np.asarray(s.values, dtype=float), req.params) for s in req.series]
    return EvaluateResponse(run_meta=clock.meta(req.params.seed), params=req.params, skus=evals, aggregate=aggregate(evals))


@private_router.post("/optimize", response_model=OptimizeResponse)
def optimize(req: OptimizeRequest) -> OptimizeResponse:
    _ensure_unique([s.sku_id for s in req.skus])
    for s in req.skus:
        bad = [i for i, b in enumerate(s.residual_blocks) if len(b) != req.params.block_size]
        if bad:
            raise HTTPException(status_code=422, detail=f"{s.sku_id}: residual block length must equal block_size")
    clock = RunClock()
    skus = [optimize_sku(s, req.params) for s in req.skus]
    return OptimizeResponse(run_meta=clock.meta(req.params.bootstrap_seed), params=req.params, skus=skus)


@private_router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    _ensure_unique([s.sku_id for s in req.skus])
    for s in req.skus:
        if any(len(b) != req.params.block_size for b in s.residual_blocks):
            raise HTTPException(status_code=422, detail=f"{s.sku_id}: residual block length must equal block_size")
    clock = RunClock()
    results = [simulate_sku(s, req.params) for s in req.skus]
    return SimulateResponse(run_meta=clock.meta(req.params.seed), params=req.params, skus=results,
                            aggregate=aggregate_simulation(results))
