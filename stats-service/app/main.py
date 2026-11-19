import logging
import time
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import SERVICE_VERSION, get_settings
from .routes import private_router, public_router

settings = get_settings()
logging.basicConfig(level=settings.log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
log = logging.getLogger("stats")

app = FastAPI(title="StockPilot Stats Service", version=SERVICE_VERSION, docs_url=None, redoc_url=None, openapi_url=None)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("x-request-id") or uuid.uuid4().hex
    request.state.request_id = rid
    t0 = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = rid
    log.info("%s %s -> %s %dms rid=%s", request.method, request.url.path, response.status_code,
             int((time.perf_counter() - t0) * 1000), rid)
    return response


def _err(status: int, code: str, message: str, request: Request, details=None) -> JSONResponse:
    body = {"error": {"code": code, "message": message, "request_id": getattr(request.state, "request_id", None)}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(status_code=status, content=body)


@app.exception_handler(RequestValidationError)
async def on_validation_error(request: Request, exc: RequestValidationError):
    details = [{"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg", "")} for e in exc.errors()]
    return _err(422, "VALIDATION_ERROR", "Request validation failed", request, details)


@app.exception_handler(StarletteHTTPException)
async def on_http_error(request: Request, exc: StarletteHTTPException):
    code = {401: "UNAUTHENTICATED", 404: "NOT_FOUND", 422: "VALIDATION_ERROR"}.get(exc.status_code, "HTTP_ERROR")
    return _err(exc.status_code, code, str(exc.detail), request)


@app.exception_handler(Exception)
async def on_unhandled(request: Request, exc: Exception):
    log.exception("Unhandled error rid=%s", getattr(request.state, "request_id", None))
    return _err(500, "INTERNAL_ERROR", "Internal error", request)


app.include_router(public_router)
app.include_router(private_router)
