import numpy as np
import statsforecast
from fastapi import APIRouter, Depends, HTTPException

from .config import SERVICE_VERSION
from .engine.evaluation import aggregate, evaluate_series
from .engine.forecasting import fit_sku, to_sku_forecast
from .engine.inventory import optimize_sku
from .engine.meta import RunClock
from .engine.replay import aggregate_replay, replay_sku
from .engine.simulation import aggregate as aggregate_simulation, simulate_sku
from .portfolio import solve_portfolio
from .schemas import (
    EvaluateRequest,
    EvaluateResponse,
    ForecastRequest,
    ForecastResponse,
    OptimizeRequest,
    OptimizeResponse,
    PortfolioRequest,
    PortfolioResponse,
    ReplayRequest,
    ReplayResponse,
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
        if s.sku_id not in req.assumptions:
            raise HTTPException(status_code=422, detail=f"Missing assumptions for {s.sku_id}")
        bad = [i for i, b in enumerate(s.residual_blocks) if len(b) != req.params.block_size]
        if bad:
            raise HTTPException(status_code=422, detail=f"{s.sku_id}: residual block length must equal block_size")
    clock = RunClock()
    skus = [optimize_sku(s, req.params, req.assumptions[s.sku_id]) for s in req.skus]
    return OptimizeResponse(run_meta=clock.meta(req.params.bootstrap_seed), params=req.params, skus=skus)


@private_router.post("/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest) -> SimulateResponse:
    _ensure_unique([s.sku_id for s in req.skus])
    for s in req.skus:
        if s.sku_id not in req.assumptions:
            raise HTTPException(status_code=422, detail=f"Missing assumptions for {s.sku_id}")
        if any(len(b) != req.params.block_size for b in s.residual_blocks):
            raise HTTPException(status_code=422, detail=f"{s.sku_id}: residual block length must equal block_size")
    clock = RunClock()
    results = [simulate_sku(s, req.params, req.assumptions[s.sku_id]) for s in req.skus]
    sweep_map = {r.sku_id: r.sweep for r in results if r.sweep is not None}
    return SimulateResponse(
        run_meta=clock.meta(req.params.seed),
        params=req.params,
        skus=results,
        aggregate=aggregate_simulation(results),
        sweep=sweep_map if sweep_map else None,
    )


@private_router.post("/replay", response_model=ReplayResponse)
def replay(req: ReplayRequest) -> ReplayResponse:
    _ensure_unique([s.sku_id for s in req.series])
    for s in req.series:
        if s.sku_id not in req.assumptions:
            raise HTTPException(status_code=422, detail=f"Missing assumptions for {s.sku_id}")
    clock = RunClock()
    results = [replay_sku(s, req.params, req.assumptions[s.sku_id]) for s in req.series]
    return ReplayResponse(
        run_meta=clock.meta(req.params.seed),
        params=req.params,
        skus=results,
        aggregate=aggregate_replay(results),
    )


@private_router.post("/portfolio", response_model=PortfolioResponse)
def portfolio(req: PortfolioRequest) -> PortfolioResponse:
    if req.budget is None and req.capacity is None:
        raise HTTPException(status_code=422, detail="At least one of budget or capacity must be set.")
    _ensure_unique([s.sku_id for s in req.skus])
    return solve_portfolio(req)

