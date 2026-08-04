"""F0.10: a push channel for `MotifCompletionEvent`/`MotifResetEvent`/
`InferenceResult`/prune events, for Live Monitoring (F13).

Honest framing given this milestone's decoupled-process architecture
decision (see CLAUDE.md's F0 addendum): the API process never shares
memory with whatever is running the detection pipeline, so there is no
real in-process bus here to subscribe to the way `ApiStateWriter` does
inside the pipeline process. What this endpoint actually does is poll
`ApiStateReader` (for motif completions/resets/entity-score upserts,
Postgres-backed) and `audit.py`'s `FileAuditSink` log (for prune events,
file-backed) on a short interval and push whatever's new as
Server-Sent Events -- a low-latency push *experience* for the client, built
on a polling implementation, not a true zero-latency bus relay. SSE (not
WebSocket) was chosen because it needs no extra dependency beyond FastAPI/
Starlette already in use, and this channel is one-directional
(server -> client) with no need for client->server messages.

Event types on the wire: `motif_completion`, `motif_reset`,
`inference_result`, `prune`, `heartbeat` (the last only so an idle
connection's client-side reconnect-with-backoff logic, F4.6, can
distinguish "still alive, just quiet" from a stalled connection).
"""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import AsyncGenerator

import psycopg2
from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from t_gnn.api.deps import StreamConfig, audit_log_path, get_reader, get_stream_config
from t_gnn.api.schemas import AuditRecordOut, EntityScoreOut, MotifCompletionOut, MotifResetOut
from t_gnn.api_state import ApiStateReader
from t_gnn.audit import read_records

router = APIRouter(prefix="/api/stream", tags=["stream"])


def _sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload)}\n\n"


async def _poll_once(reader: ApiStateReader, audit_path: Path, cursors: dict) -> list[str]:
    """One poll pass across all four sources. Returns the SSE lines to
    emit and mutates `cursors` in place so the next pass only sees newer
    rows. Postgres errors are caught per-source (rather than killing the
    whole stream) and surfaced as an `error` event -- the same
    graceful-degradation posture `require_postgres` gives the request/
    response endpoints, adapted for a long-lived connection that should
    keep retrying instead of terminating."""
    lines: list[str] = []

    try:
        completions = reader.list_motif_completions_since(cursors["completion_id"])
        for c in completions:
            cursors["completion_id"] = max(cursors["completion_id"], c.id)
            lines.append(_sse("motif_completion", MotifCompletionOut(**c.__dict__).model_dump()))

        resets = reader.list_motif_resets_since(cursors["reset_id"])
        for r in resets:
            cursors["reset_id"] = max(cursors["reset_id"], r.id)
            lines.append(_sse("motif_reset", MotifResetOut(**r.__dict__).model_dump()))

        score_updates = reader.list_entity_scores_since(cursors["score_updated_at"])
        for su in score_updates:
            cursors["score_updated_at"] = max(cursors["score_updated_at"], su.updated_at)
            lines.append(_sse("inference_result", EntityScoreOut(**su.result.__dict__).model_dump()))
    except psycopg2.Error as exc:
        lines.append(_sse("error", {"message": f"Postgres unavailable: {exc}"}))

    prune_records = read_records(audit_path, since=cursors["prune_logged_at"], record_type="prune")
    for rec in reversed(prune_records):  # read_records is newest-first; emit oldest-first
        lines.append(_sse("prune", AuditRecordOut(**rec).model_dump()))
    if prune_records:
        cursors["prune_logged_at"] = max(r["logged_at"] for r in prune_records) + 1e-6

    return lines


async def _event_generator(
    request: Request, reader: ApiStateReader, audit_path: Path, config: StreamConfig,
) -> AsyncGenerator[str, None]:
    cursors = {"completion_id": 0, "reset_id": 0, "score_updated_at": 0.0, "prune_logged_at": time.time()}
    iterations = 0
    while True:
        if await request.is_disconnected():
            break

        for line in await _poll_once(reader, audit_path, cursors):
            yield line
        yield _sse("heartbeat", {"t": time.time()})

        iterations += 1
        if config.max_iterations is not None and iterations >= config.max_iterations:
            break
        await asyncio.sleep(config.poll_interval_seconds)


@router.get("/events")
async def stream_events(
    request: Request,
    reader: ApiStateReader = Depends(get_reader),
    audit_path: Path = Depends(audit_log_path),
    config: StreamConfig = Depends(get_stream_config),
) -> StreamingResponse:
    return StreamingResponse(
        _event_generator(request, reader, audit_path, config),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
