"""F0.3: GET /api/scores/entities -- latest per-entity T-GNN scores,
paginated/sortable by abs(score).

Backing: `src/t_gnn/score_entities.py`/`src/t_gnn/tgnn.py`'s
`InferenceResult{entity_id, score, t, trigger, motif_name}` -- the exact
shape already dumped to `scores.json` by the CLI. Rows are populated by
`ApiStateWriter.record_entity_score()`, subscribed to the pipeline
process's `InferenceResultBus`.

`start`/`end` (tasks.md F8.1, added for Milestone F8) are optional unix-
second bounds on `t`. `total` in the response envelope stays `null` for
an unfiltered request (no `COUNT(*)` behind the default "recent page"
case, per F4.5's existing convention) but is computed exactly whenever
either bound is supplied, since F8.5's "average anomalies per hour" needs
a real count, not a `limit`-bounded page.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from t_gnn.api.deps import get_reader, require_postgres
from t_gnn.api.schemas import EntityScoreOut, Paginated
from t_gnn.api_state import ApiStateReader

router = APIRouter(prefix="/api/scores", tags=["scores"])


@router.get("/entities", response_model=Paginated[EntityScoreOut])
def list_entity_scores(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    start: Optional[float] = Query(default=None, description="Unix-seconds lower bound on `t`, inclusive"),
    end: Optional[float] = Query(default=None, description="Unix-seconds upper bound on `t`, inclusive"),
    reader: ApiStateReader = Depends(get_reader),
) -> Paginated[EntityScoreOut]:
    results = require_postgres(lambda: reader.list_entity_scores(limit=limit, offset=offset, start=start, end=end))
    items = [EntityScoreOut(**r.__dict__) for r in results]
    total = require_postgres(lambda: reader.count_entity_scores(start=start, end=end)) if (start is not None or end is not None) else None
    return Paginated[EntityScoreOut](items=items, limit=limit, offset=offset, total=total)


@router.get("/entities/{entity_id}", response_model=EntityScoreOut)
def get_entity_score(entity_id: str, reader: ApiStateReader = Depends(get_reader)) -> EntityScoreOut:
    """tasks.md F10.3: a point lookup, added for the User Investigation
    page's risk-score display -- a specific entity may not appear in
    `list_entity_scores`'s |score|-ranked, `limit`-bounded page at all."""
    result = require_postgres(lambda: reader.get_entity_score(entity_id))
    if result is None:
        raise HTTPException(status_code=404, detail=f"No score recorded for entity {entity_id}")
    return EntityScoreOut(**result.__dict__)
