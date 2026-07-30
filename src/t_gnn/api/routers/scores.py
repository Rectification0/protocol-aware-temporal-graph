"""F0.3: GET /api/scores/entities -- latest per-entity T-GNN scores,
paginated/sortable by abs(score).

Backing: `src/t_gnn/score_entities.py`/`src/t_gnn/tgnn.py`'s
`InferenceResult{entity_id, score, t, trigger, motif_name}` -- the exact
shape already dumped to `scores.json` by the CLI. Rows are populated by
`ApiStateWriter.record_entity_score()`, subscribed to the pipeline
process's `InferenceResultBus`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from t_gnn.api.deps import get_reader, require_postgres
from t_gnn.api.schemas import EntityScoreOut, Paginated
from t_gnn.api_state import ApiStateReader

router = APIRouter(prefix="/api/scores", tags=["scores"])


@router.get("/entities", response_model=Paginated[EntityScoreOut])
def list_entity_scores(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    reader: ApiStateReader = Depends(get_reader),
) -> Paginated[EntityScoreOut]:
    results = require_postgres(lambda: reader.list_entity_scores(limit=limit, offset=offset))
    items = [EntityScoreOut(**r.__dict__) for r in results]
    return Paginated[EntityScoreOut](items=items, limit=limit, offset=offset)
