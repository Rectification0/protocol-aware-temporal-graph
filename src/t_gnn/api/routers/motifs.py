"""F0.4/F0.5/F9.5 groundwork: motif completions, resets, and analyst
feedback dispositions.

Backing: `src/t_gnn/motif_engine.py`'s `MotifAlertBus`/`MotifResetBus`
(read side populated by `ApiStateWriter.record_motif_completion()`/
`record_motif_reset()`, subscribed in the pipeline process) and
`src/t_gnn/feedback.py`'s `MotifFeedbackBus`/`MotifFeedbackEvent` (F9.5's
true/false-positive disposition -- this endpoint is what makes an
analyst's disposition durable, where the pre-existing
`MotifPriorityTracker` was in-memory-only).

F0.10 (a live-stream variant of completions/resets over WebSocket/SSE) is
deliberately not implemented yet -- deferred per the F0 planning pass,
tracked as its own tasks.md item.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, Query

from t_gnn.api.deps import get_reader, get_writer, require_postgres
from t_gnn.api.schemas import (
    MotifCompletionOut,
    MotifFeedbackIn,
    MotifFeedbackOut,
    MotifResetOut,
    Paginated,
)
from t_gnn.api_state import ApiStateReader, ApiStateWriter
from t_gnn.feedback import MotifFeedbackEvent

router = APIRouter(prefix="/api/motifs", tags=["motifs"])


@router.get("/completions", response_model=Paginated[MotifCompletionOut])
def list_motif_completions(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    motif_name: str | None = None,
    reader: ApiStateReader = Depends(get_reader),
) -> Paginated[MotifCompletionOut]:
    records = require_postgres(lambda: reader.list_motif_completions(limit=limit, offset=offset, motif_name=motif_name))
    items = [MotifCompletionOut(**r.__dict__) for r in records]
    return Paginated[MotifCompletionOut](items=items, limit=limit, offset=offset)


@router.get("/resets", response_model=Paginated[MotifResetOut])
def list_motif_resets(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    reader: ApiStateReader = Depends(get_reader),
) -> Paginated[MotifResetOut]:
    records = require_postgres(lambda: reader.list_motif_resets(limit=limit, offset=offset))
    items = [MotifResetOut(**r.__dict__) for r in records]
    return Paginated[MotifResetOut](items=items, limit=limit, offset=offset)


@router.get("/feedback", response_model=Paginated[MotifFeedbackOut])
def list_motif_feedback(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    reader: ApiStateReader = Depends(get_reader),
) -> Paginated[MotifFeedbackOut]:
    records = require_postgres(lambda: reader.list_motif_feedback(limit=limit, offset=offset))
    items = [MotifFeedbackOut(**r.__dict__) for r in records]
    return Paginated[MotifFeedbackOut](items=items, limit=limit, offset=offset)


@router.post("/feedback", response_model=MotifFeedbackOut, status_code=201)
def submit_motif_feedback(
    body: MotifFeedbackIn,
    writer: ApiStateWriter = Depends(get_writer),
    reader: ApiStateReader = Depends(get_reader),
) -> MotifFeedbackOut:
    """F0.11 note: `analyst` is accepted as a free-text field for now (the
    mock-auth bypass's identity, not a verified session) -- real
    attribution needs F0.11's real login to land first."""
    noted_at = time.time()
    event = MotifFeedbackEvent(
        motif_name=body.motif_name, chain_key=body.chain_key,
        disposition=body.disposition, noted_at=noted_at, analyst=body.analyst,
    )
    require_postgres(lambda: writer.record_motif_feedback(event))
    latest = require_postgres(lambda: reader.list_motif_feedback(limit=1, offset=0))
    return MotifFeedbackOut(**latest[0].__dict__)
