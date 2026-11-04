"""F0.12: GET /api/security/score -- the company cybersecurity score.

The formula lives in `security_score.py` (its module docstring has the
definition and why). This router only gathers its inputs through
`ApiStateReader.security_score_inputs()` and computes it on read: nothing
is persisted, so the number is always the current window's, and a formula
change takes effect on the next request.

Returns 200 even when the score is withheld (pipeline not reporting):
that is data the dashboard shows, not an error.
"""

from __future__ import annotations

import time
from dataclasses import asdict

from fastapi import APIRouter, Depends

from t_gnn.api.deps import get_reader, require_postgres
from t_gnn.api.schemas import SecurityScoreOut
from t_gnn.api_state import ApiStateReader
from t_gnn.security_score import WINDOW_SECONDS, compute_security_score

router = APIRouter(prefix="/api/security", tags=["security"])


@router.get("/score", response_model=SecurityScoreOut)
def read_security_score(reader: ApiStateReader = Depends(get_reader)) -> SecurityScoreOut:
    now = time.time()
    inputs = require_postgres(lambda: reader.security_score_inputs(since=now - WINDOW_SECONDS))
    return SecurityScoreOut(**asdict(compute_security_score(inputs, now)))
