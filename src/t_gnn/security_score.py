"""Company cybersecurity score (tasks.md F0.12).

Nothing in `specs.md`/`design.md`/`functionality.txt` defines an aggregate
security score, so this formula was decided with the developer on
2026-11-04, after a patent-landscape check (the independent claims of the
six closest patents/applications were read; none covers this design as
written). It is computed here, in the backend, so the definition is
centralized and auditable, as F0.12 asks.

A 0-100 score, higher is safer, over a rolling window (24 h). It starts
at 100 and subtracts three capped penalties, all additive:

  - **Detections (max 50).** Motif completions in the window, each
    counting its match confidence (B.4; 1.0 for exact matching), halved
    once an analyst acknowledged it (F13.6), and excluded when the latest
    analyst disposition (F9.5) for that motif and entity, made after it
    completed, is a false positive. Saturating: `50 * (1 - e^(-n/3))`, so
    the first few detections cost the most. Analyst feedback is *not*
    used to weight whole patterns by their true-positive rate: a noisy
    pattern would discount a real attack that blends into it (decided
    2026-11-04; a possible v2 with a minimum sample size and a x1 ceiling).
  - **Response backlog (max 20).** Age of the oldest unacknowledged,
    non-dismissed detection in the window, linear up to 4 h.
  - **Anomalous entities (max 30), provisional.** Share of entities scored
    in the window whose |score| exceeds 6 (F6.2's "critical" magnitude),
    full penalty at 5%. The T-GNN is untrained (specs.md §4), so this
    component is labelled provisional wherever it is shown.

The score is withheld (`score=None`, with a reason) when the pipeline isn't
reporting: no metrics snapshot, or the latest is older than 300 s (F6.5's
"inactive" threshold). A pipeline that isn't watching would otherwise read
as a perfect 100. Every result carries its components and
`FORMULA_VERSION`, so a number on the dashboard can be explained.

Only "now" is computed. `entity_scores` keeps each entity's latest score
only, so the anomalous-entity component can't be reconstructed for a past
time, and a score history would mix exact and approximate points.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

FORMULA_VERSION = "1"
WINDOW_SECONDS = 24 * 3600

DETECTION_MAX_PENALTY = 50.0
DETECTION_SATURATION = 3.0  # n at which the penalty reaches 1 - 1/e (~63%) of its max
ACKNOWLEDGED_WEIGHT = 0.5

BACKLOG_MAX_PENALTY = 20.0
BACKLOG_FULL_AGE_SECONDS = 4 * 3600

ANOMALY_MAX_PENALTY = 30.0
# F6.2's "critical" |score| (frontend/src/features/dashboard/logic.ts,
# SECURITY_LEVEL_THRESHOLDS.maxAbsScore.critical). Keep the two in step.
ANOMALY_SCORE_THRESHOLD = 6.0
ANOMALY_FULL_SHARE = 0.05

# F6.5's monitoring thresholds (frontend dashboard logic.ts): fresh up to
# 30 s, stale up to 300 s, inactive beyond.
PIPELINE_STALE_AFTER_SECONDS = 30.0
PIPELINE_INACTIVE_AFTER_SECONDS = 300.0

# (lowest score in band, band), highest first.
BANDS = ((85.0, "good"), (65.0, "fair"), (40.0, "poor"), (0.0, "critical"))

MOTIF_DETECTION_TYPE = "motif_completion"  # alerts.py's detection_type for a motif completion
FALSE_POSITIVE = "false_positive"


@dataclass(frozen=True)
class ScoredDetection:
    motif_name: str
    chain_key: str
    completed_at: float
    confidence: float


@dataclass(frozen=True)
class Disposition:
    motif_name: str
    chain_key: str
    disposition: str
    noted_at: float


@dataclass(frozen=True)
class SecurityScoreInputs:
    """Everything the formula reads, gathered by
    `ApiStateReader.security_score_inputs()`."""

    snapshot_captured_at: Optional[float]
    detections: list[ScoredDetection]
    dispositions: list[Disposition]
    # `detection_ref`s of motif-completion acknowledgements (alerts.py's
    # `{motif_name}:{chain_key}:{completed_at}`).
    acknowledged_refs: list[str]
    scored_entities: int
    anomalous_entities: int
    # True when the detection query hit its row limit, so the detection
    # and backlog components saw only the most recent detections.
    detections_truncated: bool = False


@dataclass(frozen=True)
class ScoreComponent:
    key: str
    label: str
    penalty: float
    max_penalty: float
    detail: str
    provisional: bool = False
    inputs: dict[str, float] = field(default_factory=dict)


@dataclass(frozen=True)
class SecurityScore:
    score: Optional[float]
    band: Optional[str]
    unavailable_reason: Optional[str]
    pipeline_status: str  # "active" | "stale" | "inactive"
    snapshot_age_seconds: Optional[float]
    computed_at: float
    window_seconds: float
    formula_version: str
    components: list[ScoreComponent]
    inputs_truncated: bool


def band_for(score: float) -> str:
    for floor, band in BANDS:
        if score >= floor:
            return band
    return BANDS[-1][1]


def _ack_key(motif_name: str, chain_key: str, completed_at: float) -> tuple[str, float]:
    return f"{motif_name}:{chain_key}", completed_at


def _parse_ack_ref(ref: str) -> Optional[tuple[str, float]]:
    """The frontend builds the ref with JavaScript's number formatting
    (`1700000000` for a whole second, where Python writes `1700000000.0`),
    so refs are matched on the parsed timestamp, not as strings."""
    prefix, _, ts = ref.rpartition(":")
    if not prefix:
        return None
    try:
        return prefix, float(ts)
    except ValueError:
        return None


def _dismissed(detection: ScoredDetection, dispositions: list[Disposition]) -> bool:
    """`motif_feedback` rows name a motif and entity, not one completion,
    so a disposition applies to that entity's completions of that motif
    from before it was made. The latest such disposition wins."""
    latest: Optional[Disposition] = None
    for d in dispositions:
        if (d.motif_name == detection.motif_name and d.chain_key == detection.chain_key
                and d.noted_at >= detection.completed_at
                and (latest is None or d.noted_at > latest.noted_at)):
            latest = d
    return latest is not None and latest.disposition == FALSE_POSITIVE


def _format_age(seconds: float) -> str:
    if seconds < 3600:
        return f"{seconds / 60:.0f} min"
    if seconds < 86400:
        return f"{seconds / 3600:.0f} h"
    return f"{seconds / 86400:.0f} days"


def pipeline_status(snapshot_age_seconds: Optional[float]) -> str:
    if snapshot_age_seconds is None or snapshot_age_seconds > PIPELINE_INACTIVE_AFTER_SECONDS:
        return "inactive"
    if snapshot_age_seconds > PIPELINE_STALE_AFTER_SECONDS:
        return "stale"
    return "active"


def compute_security_score(inputs: SecurityScoreInputs, now: float) -> SecurityScore:
    acknowledged = {key for key in map(_parse_ack_ref, inputs.acknowledged_refs) if key is not None}

    counted = [d for d in inputs.detections if not _dismissed(d, inputs.dispositions)]
    weighted = 0.0
    oldest_unacknowledged: Optional[float] = None
    acknowledged_count = 0
    for d in counted:
        if _ack_key(d.motif_name, d.chain_key, d.completed_at) in acknowledged:
            weighted += d.confidence * ACKNOWLEDGED_WEIGHT
            acknowledged_count += 1
        else:
            weighted += d.confidence
            if oldest_unacknowledged is None or d.completed_at < oldest_unacknowledged:
                oldest_unacknowledged = d.completed_at

    detection_penalty = DETECTION_MAX_PENALTY * (1.0 - math.exp(-weighted / DETECTION_SATURATION))
    detection = ScoreComponent(
        key="detections", label="Motif detections", penalty=detection_penalty, max_penalty=DETECTION_MAX_PENALTY,
        detail=(f"{len(counted)} detection(s) in the window ({acknowledged_count} acknowledged, "
                f"{len(inputs.detections) - len(counted)} dismissed as false positives), weighted count {weighted:.2f}"),
        inputs={"detections": len(inputs.detections), "counted": len(counted),
                "acknowledged": acknowledged_count, "weighted_count": weighted},
    )

    backlog_age = max(0.0, now - oldest_unacknowledged) if oldest_unacknowledged is not None else 0.0
    backlog_penalty = BACKLOG_MAX_PENALTY * min(1.0, backlog_age / BACKLOG_FULL_AGE_SECONDS)
    backlog = ScoreComponent(
        key="response_backlog", label="Response backlog", penalty=backlog_penalty, max_penalty=BACKLOG_MAX_PENALTY,
        detail=("No unacknowledged detections" if oldest_unacknowledged is None
                else f"Oldest unacknowledged detection is {_format_age(backlog_age)} old"),
        inputs={"oldest_unacknowledged_age_seconds": backlog_age},
    )

    share = inputs.anomalous_entities / inputs.scored_entities if inputs.scored_entities else 0.0
    anomaly_penalty = ANOMALY_MAX_PENALTY * min(1.0, share / ANOMALY_FULL_SHARE)
    anomaly = ScoreComponent(
        key="anomalous_entities", label="Anomalous entities", penalty=anomaly_penalty,
        max_penalty=ANOMALY_MAX_PENALTY, provisional=True,
        detail=(f"{inputs.anomalous_entities} of {inputs.scored_entities} entities scored in the window have "
                f"|score| > {ANOMALY_SCORE_THRESHOLD:g} (untrained model: provisional)"),
        inputs={"scored_entities": inputs.scored_entities, "anomalous_entities": inputs.anomalous_entities,
                "share": share},
    )

    components = [detection, backlog, anomaly]
    age = None if inputs.snapshot_captured_at is None else max(0.0, now - inputs.snapshot_captured_at)
    status = pipeline_status(age)
    if age is None:
        reason: Optional[str] = "No metrics snapshot recorded yet: the pipeline hasn't reported."
    elif status == "inactive":
        reason = (f"The pipeline last reported {_format_age(age)} ago, so recent activity is unknown "
                  f"(withheld after {PIPELINE_INACTIVE_AFTER_SECONDS:.0f} s).")
    else:
        reason = None

    score = None if reason else round(max(0.0, 100.0 - sum(c.penalty for c in components)), 1)
    return SecurityScore(
        score=score, band=band_for(score) if score is not None else None, unavailable_reason=reason,
        pipeline_status=status, snapshot_age_seconds=age, computed_at=now, window_seconds=WINDOW_SECONDS,
        formula_version=FORMULA_VERSION, components=components, inputs_truncated=inputs.detections_truncated,
    )
