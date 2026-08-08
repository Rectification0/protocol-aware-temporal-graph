"""F0.8: GET /api/audit/log -- tail/paginate the prune/motif-reset audit
trail for the Log Explorer.

Backing: `src/t_gnn/audit.py`'s `FileAuditSink`, which already writes one
newline-delimited JSON record per prune/motif-reset event (NFR5). This is
the audit trail, not a raw ingested-event store -- this repo has no raw
Sysmon/Windows Event Log persistence layer, so "view raw logs" here means
"view the prune/reset record," not the original source event. See
CLAUDE.md's F0 status notes and `docs/cli-reference.md` for that
distinction; F11.1 (frontend) is expected to label this accordingly.

Reads the file fresh on every request rather than caching -- this is a
low-frequency, append-only log (audit.py's own docstring), so a full scan
per request is cheap at the volumes this repo operates at.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query

from t_gnn.api.deps import audit_log_path
from t_gnn.api.schemas import AuditRecordOut, Paginated
from t_gnn.audit import read_records

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/log", response_model=Paginated[AuditRecordOut])
def list_audit_log(
    since: Optional[float] = Query(default=None, description="only records with logged_at >= since"),
    until: Optional[float] = Query(default=None, description="only records with logged_at <= until"),
    type: Optional[Literal["prune", "motif_reset"]] = Query(default=None),
    entity: Optional[str] = Query(
        default=None, description="exact match against a prune record's src/dst or a motif-reset's chain_key"
    ),
    q: Optional[str] = Query(default=None, description="freetext substring match across all record fields"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    path: Path = Depends(audit_log_path),
) -> Paginated[AuditRecordOut]:
    records = read_records(path, since=since, until=until, record_type=type, entity=entity, q=q)
    page = records[offset:offset + limit]
    items = [AuditRecordOut(**r) for r in page]
    return Paginated[AuditRecordOut](items=items, limit=limit, offset=offset, total=len(records))
