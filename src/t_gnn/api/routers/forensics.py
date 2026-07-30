"""F0.6/F0.7: forensic activity reconstruction and edge point-lookup.

Backing: `src/t_gnn/forensics.py`'s `Neo4jForensicQueryAPI` -- this is a
direct, real wrapper (not a staged/mocked read) since Neo4j cold storage is
genuinely wired up (tasks.md 2.4/4.1-4.3). This is the real data source for
User Investigation's "timeline of activity" and "log history" (F10) -- there
is no separate raw-log store.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from t_gnn.api.deps import get_forensics_api
from t_gnn.api.schemas import PrunedEdgeOut
from t_gnn.forensics import Neo4jForensicQueryAPI

router = APIRouter(prefix="/api/forensics", tags=["forensics"])


@router.get("/entity/{entity_id}", response_model=list[PrunedEdgeOut])
def reconstruct_entity_activity(
    entity_id: str,
    start: float = Query(..., description="window start, t_e seconds"),
    end: float = Query(..., description="window end, t_e seconds"),
    api: Neo4jForensicQueryAPI = Depends(get_forensics_api),
) -> list[PrunedEdgeOut]:
    records = api.reconstruct_activity(entity_id, start, end)
    return [PrunedEdgeOut(**r.__dict__) for r in records]


@router.get("/edge/{edge_id}", response_model=PrunedEdgeOut)
def get_pruned_edge(edge_id: str, api: Neo4jForensicQueryAPI = Depends(get_forensics_api)) -> PrunedEdgeOut:
    record = api.get_edge(edge_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"edge {edge_id!r} was never pruned (or is still active)")
    return PrunedEdgeOut(**record.__dict__)
