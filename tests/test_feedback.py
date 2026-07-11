"""Tests for the analyst-feedback loop (tasks.md Backlog B.6)."""

import pytest

from t_gnn.feedback import MotifFeedbackBus, MotifFeedbackEvent, MotifPriorityTracker


def _feedback(motif_name, disposition, t=0.0, analyst=None):
    return MotifFeedbackEvent(motif_name=motif_name, chain_key="Machine:C1", disposition=disposition,
                               noted_at=t, analyst=analyst)


def test_priority_score_is_neutral_before_any_feedback():
    tracker = MotifPriorityTracker()
    assert tracker.priority_score("lateral_pivot") == 0.5


def test_priority_score_rises_with_true_positives():
    tracker = MotifPriorityTracker()
    tracker.on_feedback(_feedback("lateral_pivot", "true_positive"))
    assert tracker.priority_score("lateral_pivot") > 0.5


def test_priority_score_falls_with_false_positives():
    tracker = MotifPriorityTracker()
    tracker.on_feedback(_feedback("lateral_pivot", "false_positive"))
    assert tracker.priority_score("lateral_pivot") < 0.5


def test_priority_score_reflects_accumulated_dispositions():
    tracker = MotifPriorityTracker()
    for _ in range(8):
        tracker.on_feedback(_feedback("lateral_pivot", "true_positive"))
    for _ in range(2):
        tracker.on_feedback(_feedback("lateral_pivot", "false_positive"))

    stats = tracker.stats_for("lateral_pivot")
    assert stats.true_positives == 8
    assert stats.false_positives == 2
    assert stats.priority_score == (8 + 1) / (8 + 2 + 2)


def test_unknown_disposition_raises():
    tracker = MotifPriorityTracker()
    with pytest.raises(ValueError):
        tracker.on_feedback(_feedback("lateral_pivot", "maybe"))


def test_ranked_motifs_orders_by_priority_score_descending():
    tracker = MotifPriorityTracker()
    for _ in range(5):
        tracker.on_feedback(_feedback("lateral_pivot", "true_positive"))
    for _ in range(5):
        tracker.on_feedback(_feedback("admin_share_escalation", "false_positive"))

    ranked = tracker.ranked_motifs()
    assert [s.motif_name for s in ranked] == ["lateral_pivot", "admin_share_escalation"]
    assert ranked[0].priority_score > ranked[1].priority_score


def test_ranked_motifs_excludes_motifs_with_no_feedback():
    tracker = MotifPriorityTracker()
    tracker.on_feedback(_feedback("lateral_pivot", "true_positive"))
    assert [s.motif_name for s in tracker.ranked_motifs()] == ["lateral_pivot"]


def test_bus_auto_subscribes_tracker_on_construction():
    bus = MotifFeedbackBus()
    tracker = MotifPriorityTracker(feedback_bus=bus)

    bus.publish(_feedback("lateral_pivot", "true_positive"))

    assert tracker.priority_score("lateral_pivot") > 0.5
