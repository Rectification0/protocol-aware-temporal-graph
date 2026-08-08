"""F10.1: GET /api/entities?type=<Type> -- distinct known entity ids, for
the User Investigation page's user-list (`type=User`) and ready for any
future entity picker.

Backing: tasks.md's own F10.1 line offers two options -- `ActiveGraphStore`'s
known node ids, or a Neo4j distinct-entity query. This process never holds
a live `ActiveGraphStore` (F0's decoupled, stateless-reader architecture
decision), so only the second option is actually available here:
`forensics.py`'s `Neo4jForensicQueryAPI.list_entities()`/`count_entities()`,
reading the same cold-storage `Entity` nodes `cold_storage.py`'s write path
(2.4) already creates. Honest consequence: an entity with only currently
-active (not-yet-pruned) edges has no `Entity` node yet and won't appear
here until at least one of its edges is pruned -- see that method's own
docstring.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query

from t_gnn.api.deps import get_forensics_api
from t_gnn.api.schemas import Paginated
from t_gnn.forensics import Neo4jForensicQueryAPI

router = APIRouter(prefix="/api/entities", tags=["entities"])


@router.get("", response_model=Paginated[str])
def list_entities(
    type: Optional[str] = Query(default=None, description="Node-id type prefix, e.g. 'User' matches 'User:*'"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    api: Neo4jForensicQueryAPI = Depends(get_forensics_api),
) -> Paginated[str]:
    type_prefix = f"{type}:" if type else None
    items = api.list_entities(type_prefix=type_prefix, limit=limit, offset=offset)
    total = api.count_entities(type_prefix=type_prefix)
    return Paginated[str](items=items, limit=limit, offset=offset, total=total)
