"""F8.4: GET /api/pilot/latest-report -- serves `pilot.py`'s real
precision/recall figures for the Threat Analytics page's "detection rate"
metric, added to F0 per that task's own "add to F0 if pilot reports should
be API-served rather than file-only" instruction.

Backing: `src/t_gnn/pilot.py`'s `run_pilot()`/`PilotReport`, whose CLI
already dumps `{"anomaly": {...}, "motif": {...}}` to a JSON file via
`--output`. This endpoint reads that same file rather than re-running the
evaluation itself -- per this repo's own architecture, `pilot.py` is a
batch tool a human runs against labeled ground truth (docs/operational-
runbook.md's "Running a pilot evaluation"), not something the always-on
API process can or should invoke live. `evaluated_at` is the file's own
mtime, since neither the dataclass nor its JSON dump carries a timestamp;
the frontend uses it to render the required "as of last pilot evaluation"
label rather than presenting this as live.
"""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException

from t_gnn.api.deps import pilot_report_path
from t_gnn.api.schemas import PilotReportOut

router = APIRouter(prefix="/api/pilot", tags=["pilot"])


@router.get("/latest-report", response_model=PilotReportOut)
def get_latest_pilot_report(path: Path = Depends(pilot_report_path)) -> PilotReportOut:
    if not path.is_file():
        raise HTTPException(status_code=404, detail=f"No pilot report found at {path}")
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=500, detail=f"Pilot report at {path} is unreadable: {exc}") from exc
    return PilotReportOut(anomaly=payload["anomaly"], motif=payload["motif"], evaluated_at=path.stat().st_mtime)
