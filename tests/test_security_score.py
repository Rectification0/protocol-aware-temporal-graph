"""tasks.md F0.12: the company cybersecurity score formula (`security_score.py`)."""

import math

import pytest

from t_gnn.security_score import (
    ANOMALY_MAX_PENALTY,
    BACKLOG_FULL_AGE_SECONDS,
    BACKLOG_MAX_PENALTY,
    DETECTION_MAX_PENALTY,
    FORMULA_VERSION,
    Disposition,
    ScoredDetection,
    SecurityScoreInputs,
    band_for,
    compute_security_score,
)

NOW = 1_800_000_000.0


def _inputs(**overrides):
    base = dict(snapshot_captured_at=NOW - 5, detections=[], dispositions=[], acknowledged_refs=[],
                scored_entities=0, anomalous_entities=0)
    base.update(overrides)
    return SecurityScoreInputs(**base)


def _detection(completed_at=NOW - 60, confidence=1.0, motif="lateral_movement", chain="User:alice"):
    return ScoredDetection(motif_name=motif, chain_key=chain, completed_at=completed_at, confidence=confidence)


def _component(result, key):
    return next(c for c in result.components if c.key == key)


def test_a_quiet_reporting_pipeline_scores_100_good():
    result = compute_security_score(_inputs(), NOW)

    assert result.score == 100.0 and result.band == "good"
    assert result.unavailable_reason is None and result.pipeline_status == "active"
    assert result.formula_version == FORMULA_VERSION
    assert [c.key for c in result.components] == ["detections", "response_backlog", "anomalous_entities"]


def test_score_is_withheld_without_a_metrics_snapshot():
    result = compute_security_score(_inputs(snapshot_captured_at=None, detections=[_detection()]), NOW)

    assert result.score is None and result.band is None
    assert "hasn't reported" in result.unavailable_reason
    assert result.pipeline_status == "inactive"
    assert _component(result, "detections").penalty > 0  # components still computed


def test_score_is_withheld_once_the_pipeline_goes_inactive_but_kept_while_stale():
    stale = compute_security_score(_inputs(snapshot_captured_at=NOW - 120), NOW)
    inactive = compute_security_score(_inputs(snapshot_captured_at=NOW - 301), NOW)

    assert stale.score == 100.0 and stale.pipeline_status == "stale"
    assert inactive.score is None and inactive.pipeline_status == "inactive"
    assert "5 min ago" in inactive.unavailable_reason
    days = compute_security_score(_inputs(snapshot_captured_at=NOW - 15 * 86400), NOW)
    assert "15 days ago" in days.unavailable_reason


def test_detection_penalty_saturates():
    three = compute_security_score(_inputs(detections=[_detection(completed_at=NOW - i) for i in range(3)]), NOW)
    many = compute_security_score(_inputs(detections=[_detection(completed_at=NOW - i) for i in range(40)]), NOW)

    assert _component(three, "detections").penalty == pytest.approx(DETECTION_MAX_PENALTY * (1 - math.exp(-1)))
    assert _component(many, "detections").penalty == pytest.approx(DETECTION_MAX_PENALTY, abs=0.01)


def test_detections_count_their_match_confidence():
    result = compute_security_score(_inputs(detections=[_detection(confidence=0.6)]), NOW)

    assert _component(result, "detections").inputs["weighted_count"] == pytest.approx(0.6)


def test_an_acknowledged_detection_counts_half_and_leaves_the_backlog():
    detection = _detection(completed_at=1_799_999_000.0)  # a whole second: JS writes it without ".0"
    result = compute_security_score(
        _inputs(detections=[detection], acknowledged_refs=["lateral_movement:User:alice:1799999000"]), NOW,
    )

    assert _component(result, "detections").inputs["weighted_count"] == pytest.approx(0.5)
    assert _component(result, "response_backlog").penalty == 0.0


def test_an_ack_for_another_detection_doesnt_count():
    result = compute_security_score(
        _inputs(detections=[_detection(chain="User:alice")],
                acknowledged_refs=[f"lateral_movement:User:bob:{NOW - 60}", "malformed", "x:not-a-time"]),
        NOW,
    )

    assert _component(result, "detections").inputs["acknowledged"] == 0


def test_a_false_positive_disposition_dismisses_earlier_detections_of_that_motif_and_entity():
    earlier, later = _detection(completed_at=NOW - 600), _detection(completed_at=NOW - 60)
    other_entity = _detection(completed_at=NOW - 600, chain="User:bob")
    fp = Disposition("lateral_movement", "User:alice", "false_positive", noted_at=NOW - 300)

    result = compute_security_score(_inputs(detections=[earlier, later, other_entity], dispositions=[fp]), NOW)

    detections = _component(result, "detections")
    assert detections.inputs["counted"] == 2  # `later` came after the disposition, bob's is a different entity
    assert detections.inputs["weighted_count"] == pytest.approx(2.0)


def test_the_latest_disposition_wins():
    detection = _detection(completed_at=NOW - 600)
    marks = [Disposition("lateral_movement", "User:alice", "false_positive", noted_at=NOW - 500),
             Disposition("lateral_movement", "User:alice", "true_positive", noted_at=NOW - 400)]

    result = compute_security_score(_inputs(detections=[detection], dispositions=marks), NOW)

    assert _component(result, "detections").inputs["counted"] == 1


def test_backlog_penalty_grows_with_the_oldest_unacknowledged_detection_up_to_its_cap():
    half = compute_security_score(_inputs(detections=[_detection(completed_at=NOW - BACKLOG_FULL_AGE_SECONDS / 2),
                                                      _detection(completed_at=NOW - 60)]), NOW)
    capped = compute_security_score(_inputs(detections=[_detection(completed_at=NOW - 3 * BACKLOG_FULL_AGE_SECONDS)]),
                                    NOW)

    assert _component(half, "response_backlog").penalty == pytest.approx(BACKLOG_MAX_PENALTY / 2)
    assert _component(capped, "response_backlog").penalty == pytest.approx(BACKLOG_MAX_PENALTY)


def test_anomalous_entity_share_reaches_the_full_penalty_at_five_percent_and_is_provisional():
    some = compute_security_score(_inputs(scored_entities=200, anomalous_entities=5), NOW)  # 2.5%
    lots = compute_security_score(_inputs(scored_entities=200, anomalous_entities=50), NOW)
    none_scored = compute_security_score(_inputs(scored_entities=0, anomalous_entities=0), NOW)

    assert _component(some, "anomalous_entities").penalty == pytest.approx(ANOMALY_MAX_PENALTY / 2)
    assert _component(lots, "anomalous_entities").penalty == pytest.approx(ANOMALY_MAX_PENALTY)
    assert _component(none_scored, "anomalous_entities").penalty == 0.0
    assert _component(some, "anomalous_entities").provisional


def test_score_is_100_minus_the_penalties():
    result = compute_security_score(
        _inputs(detections=[_detection(completed_at=NOW - i) for i in range(3)], scored_entities=100,
                anomalous_entities=5),
        NOW,
    )

    expected = 100 - DETECTION_MAX_PENALTY * (1 - math.exp(-1)) - ANOMALY_MAX_PENALTY
    assert result.score == pytest.approx(round(expected - _component(result, "response_backlog").penalty, 1))


@pytest.mark.parametrize("score, band", [(100, "good"), (85, "good"), (84.9, "fair"), (65, "fair"),
                                         (64.9, "poor"), (40, "poor"), (39.9, "critical"), (0, "critical")])
def test_bands(score, band):
    assert band_for(score) == band


def test_truncated_inputs_are_reported():
    assert compute_security_score(_inputs(detections_truncated=True), NOW).inputs_truncated
