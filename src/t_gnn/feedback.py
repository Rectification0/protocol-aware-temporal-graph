"""Analyst-feedback loop for motif prioritization (tasks.md Backlog B.6).

proposal.docx §7 "Future Enhancements": "integrating feedback from analyst
investigations to refine which patterns are considered high priority over
time." Nothing in the pipeline previously consumed an analyst's disposition
of a past `MotifCompletionEvent` (motif_engine.py) -- motif priority was
static config (config/motifs.yaml) with no feedback path back into it. This
module adds that path without touching `motif_engine.py`'s detection logic
itself: it is a downstream consumer of an analyst's disposition, the same
relationship `audit.py`'s `AuditLogger` and `metrics.py`'s
`MetricsCollector` already have to `MotifAlertBus`/`MotifResetBus` -- a new
bus (`MotifFeedbackBus`) plus a subscriber (`MotifPriorityTracker`),
introduced because there's now a real event type and a real consumer for
it, not speculatively.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Literal, Optional

Disposition = Literal["true_positive", "false_positive"]


@dataclass
class MotifFeedbackEvent:
    """An analyst's disposition of a past `MotifCompletionEvent`
    (motif_engine.py) -- e.g. after investigating an alert via
    forensics.py's `Neo4jForensicQueryAPI` (Phase 4)."""

    motif_name: str
    chain_key: str
    disposition: Disposition
    noted_at: float
    analyst: Optional[str] = None


class MotifFeedbackBus:
    """In-process pub/sub for analyst feedback, the same standing-in role
    `PruneEventBus`/`MotifAlertBus`/`MotifResetBus` play for their events."""

    def __init__(self) -> None:
        self._subscribers: list[Callable[[MotifFeedbackEvent], None]] = []

    def subscribe(self, callback: Callable[[MotifFeedbackEvent], None]) -> None:
        self._subscribers.append(callback)

    def publish(self, event: MotifFeedbackEvent) -> None:
        for callback in self._subscribers:
            callback(event)


@dataclass
class MotifPriorityStats:
    motif_name: str
    true_positives: int
    false_positives: int
    priority_score: float


class MotifPriorityTracker:
    """Tracks per-motif true/false-positive counts from analyst feedback
    and derives a priority score -- the mechanism proposal.docx §7's
    "refine which patterns are considered high priority over time"
    describes. Auto-subscribes to a `MotifFeedbackBus` when constructed
    with one, the same auto-subscribe convention `MotifEngine`'s
    `prune_event_bus`/`alert_bus` constructor args use.

    `priority_score()` is a Laplace-smoothed true-positive rate
    (`(tp + 1) / (tp + fp + 2)`) rather than a raw ratio, so a motif with no
    feedback yet reads as a neutral 0.5 instead of an undefined `0/0`, and a
    single disposition doesn't swing the score straight to an extreme.
    """

    def __init__(self, feedback_bus: Optional[MotifFeedbackBus] = None) -> None:
        self._true_positives: dict[str, int] = {}
        self._false_positives: dict[str, int] = {}
        if feedback_bus is not None:
            feedback_bus.subscribe(self.on_feedback)

    def on_feedback(self, event: MotifFeedbackEvent) -> None:
        if event.disposition == "true_positive":
            self._true_positives[event.motif_name] = self._true_positives.get(event.motif_name, 0) + 1
        elif event.disposition == "false_positive":
            self._false_positives[event.motif_name] = self._false_positives.get(event.motif_name, 0) + 1
        else:
            raise ValueError(f"unknown disposition {event.disposition!r}")

    def priority_score(self, motif_name: str) -> float:
        tp = self._true_positives.get(motif_name, 0)
        fp = self._false_positives.get(motif_name, 0)
        return (tp + 1) / (tp + fp + 2)

    def stats_for(self, motif_name: str) -> MotifPriorityStats:
        tp = self._true_positives.get(motif_name, 0)
        fp = self._false_positives.get(motif_name, 0)
        return MotifPriorityStats(
            motif_name=motif_name, true_positives=tp, false_positives=fp,
            priority_score=self.priority_score(motif_name),
        )

    def ranked_motifs(self) -> list[MotifPriorityStats]:
        """Every motif with at least one recorded disposition, highest
        `priority_score` first -- "which patterns are considered high
        priority" (proposal.docx §7), ready to read for triage/
        reprioritization."""
        names = set(self._true_positives) | set(self._false_positives)
        stats = [self.stats_for(name) for name in names]
        stats.sort(key=lambda s: s.priority_score, reverse=True)
        return stats
