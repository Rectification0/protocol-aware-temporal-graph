"""FastAPI application factory (tasks.md F0.1).

Process model (decided with the developer 2026-07-30): this service is a
**decoupled, stateless reader/thin-writer** -- it never constructs
`ActiveGraphStore`/`MotifEngine`/`TGNNInferenceEngine`/`PruningWatcher`
itself. All "live" data it serves was persisted by
`scripts/run_pipeline.py` (or a successor) into Postgres
(`api_state.py`'s `ApiStateWriter`) or Neo4j (`cold_storage.py`'s
`Neo4jColdStorageWriter`, already real since Phase 2) -- this process only
reads from those, plus writes the small amount of API-originated state
(F9.5 feedback, F13.6 acks) that has nowhere else to live.

F0.15's conventions, applied uniformly across every router:
  - Pagination: `limit`/`offset` query params, `Paginated[T]` response
    envelope (`schemas.py`).
  - Errors: `HTTPException` -> `{"error": {"code": ..., "message": ...}}`,
    via the exception handlers below, so the frontend's error handling
    (F4.3) has one shape to branch on regardless of endpoint.
  - OpenAPI schema is generated for free by FastAPI at `/openapi.json`,
    which F4.1's typed frontend client codegens from.

CORS is left permissive here (any localhost origin) for local frontend dev
against `npm run dev`'s Vite server; tightening this to a specific origin
list is tasks.md F17.3's job once a real deployment topology exists.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from t_gnn.api.routers import alerts, audit, config, forensics, health, metrics, motifs, scores, stream


def create_app() -> FastAPI:
    app = FastAPI(
        title="t-gnn frontend API",
        description="Thin HTTP layer over the existing detection-pipeline modules (tasks.md Milestone F0).",
        version="0.1.0",
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(HTTPException)
    async def _http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"error": {"code": exc.status_code, "message": exc.detail}})

    @app.exception_handler(Exception)
    async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=500, content={"error": {"code": 500, "message": str(exc)}})

    app.include_router(health.router)
    app.include_router(metrics.router)
    app.include_router(scores.router)
    app.include_router(motifs.router)
    app.include_router(forensics.router)
    app.include_router(config.router)
    app.include_router(alerts.router)
    app.include_router(audit.router)
    app.include_router(stream.router)

    return app


app = create_app()
