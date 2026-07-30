"""F13.6: alert acknowledgement.

There is no single unified "alert id" across the two detection paths this
repo has (a motif completion vs. an anomaly-path `InferenceResult`) --
`detection_type` + `detection_ref` (e.g. `"motif_completion"` +
`{motif_name}:{chain_key}:{completed_at}`, or `"anomaly"` +
`{entity_id}:{t}`) identifies which detection is being acknowledged,
matching the same two-path split `pilot.py`/F9's Detection Matrix already
use, rather than inventing a third, unified id space.

Backing: new `alert_acknowledgements` table (`api_state.py`) -- there was
no ack/disposition-beyond-feedback concept anywhere in this repo before
this endpoint.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends

from t_gnn.api.deps import get_writer, require_postgres
from t_gnn.api.schemas import AlertAckIn, AlertAckOut
from t_gnn.api_state import ApiStateWriter

router = APIRouter(prefix="/api/alerts", tags=["alerts"])


@router.post("/ack", response_model=AlertAckOut, status_code=201)
def acknowledge_alert(body: AlertAckIn, writer: ApiStateWriter = Depends(get_writer)) -> AlertAckOut:
    acknowledged_at = time.time()
    require_postgres(
        lambda: writer.record_alert_acknowledgement(
            detection_type=body.detection_type, detection_ref=body.detection_ref,
            analyst=body.analyst, notes=body.notes, t=acknowledged_at,
        )
    )
    return AlertAckOut(
        detection_type=body.detection_type, detection_ref=body.detection_ref,
        acknowledged_by=body.analyst, acknowledged_at=acknowledged_at, notes=body.notes,
    )
