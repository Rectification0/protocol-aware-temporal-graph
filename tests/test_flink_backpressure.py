"""Backlog B.2: Flink backpressure as an epsilon pressure signal."""

import urllib.error

import pytest

from t_gnn.cold_storage import InMemoryColdStorageWriter
from t_gnn.decay import DecayEngine
from t_gnn.flink.backpressure import FlinkBackpressureProbe, max_backpressure_ratio
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.pruning import EpsilonController, PruningWatcher

# --- EpsilonController ---------------------------------------------------------


def _controller(**kwargs):
    return EpsilonController(epsilon_min=0.1, epsilon_max=0.5, **kwargs)


@pytest.mark.parametrize("ratio, expected", [
    (None, 0.1),   # no reading: no pressure
    (0.05, 0.1),   # Flink's "ok" band: no pressure
    (0.1, 0.1),    # backpressure_low
    (0.3, 0.3),    # halfway between low and high
    (0.5, 0.5),    # backpressure_high: full pressure
    (0.9, 0.5),    # clamped
])
def test_backpressure_scales_between_its_thresholds(ratio, expected):
    assert _controller().compute_epsilon(0, None, ratio) == pytest.approx(expected)


def test_backpressure_competes_with_the_other_signals_by_max():
    controller = _controller(max_edges=100)
    # Size pressure 0.75 beats backpressure 0.5 ...
    assert controller.compute_epsilon(75, None, 0.3) == pytest.approx(0.1 + 0.75 * 0.4)
    # ... and backpressure 1.0 beats size pressure 0.25.
    assert controller.compute_epsilon(25, None, 0.6) == pytest.approx(0.5)


def test_backpressure_thresholds_are_validated():
    with pytest.raises(ValueError):
        _controller(backpressure_low=0.5, backpressure_high=0.5)


# --- PruningWatcher --------------------------------------------------------------


def _watcher(probe):
    return PruningWatcher(
        store=ActiveGraphStore(), decay_engine=DecayEngine(), epsilon_controller=_controller(),
        cold_storage=InMemoryColdStorageWriter(), memory_probe=lambda: None, backpressure_probe=probe,
    )


def test_watcher_feeds_the_probe_reading_into_epsilon_and_reports_it():
    stats = _watcher(lambda: 0.5).run_once(t=0.0)
    assert stats.epsilon == pytest.approx(0.5)
    assert stats.backpressure == 0.5


def test_watcher_without_a_probe_is_unchanged():
    stats = _watcher(None).run_once(t=0.0)
    assert stats.epsilon == pytest.approx(0.1)
    assert stats.backpressure is None


# --- Reading Flink's REST responses ---------------------------------------------


def _vertex(*ratios, status="ok"):
    return {"status": status, "subtasks": [{"subtask": i, "ratio": r} for i, r in enumerate(ratios)]}


def test_max_ratio_is_taken_over_every_subtask_of_every_vertex():
    assert max_backpressure_ratio([_vertex(0.0, 0.2), _vertex(0.7), _vertex(0.1)]) == 0.7


def test_vertices_without_a_sample_yet_carry_no_reading():
    assert max_backpressure_ratio([]) is None
    assert max_backpressure_ratio([{"status": "deprecated"}, _vertex(0.9, status="pending")]) is None
    assert max_backpressure_ratio([{"status": "deprecated"}, _vertex(0.3)]) == 0.3


class _FakeFlink(FlinkBackpressureProbe):
    """The probe with its HTTP layer swapped for canned responses."""

    def __init__(self, responses, **kwargs):
        super().__init__(**kwargs)
        self.responses = responses
        self.requests = []

    def _get(self, path):
        self.requests.append(path)
        response = self.responses[path]
        if isinstance(response, Exception):
            raise response
        return response


def _cluster(job_state="RUNNING", ratios=(0.0, 0.6)):
    responses = {
        "/jobs/overview": {"jobs": [
            {"jid": "old", "name": "t-gnn-decay-baseline", "state": "CANCELED"},
            {"jid": "j1", "name": "t-gnn-decay-baseline", "state": job_state},
            {"jid": "x", "name": "something-else", "state": "RUNNING"},
        ]},
        "/jobs/j1": {"vertices": [{"id": "v1"}, {"id": "v2"}]},
    }
    responses.update({f"/jobs/j1/vertices/v{i + 1}/backpressure": _vertex(r) for i, r in enumerate(ratios)})
    return responses


def test_probe_reads_the_running_jobs_worst_operator():
    probe = _FakeFlink(_cluster())
    assert probe() == 0.6
    assert probe.available and probe.last_ratio == 0.6


def test_probe_caches_the_job_lookup_between_passes():
    probe = _FakeFlink(_cluster())
    probe()
    probe()
    assert probe.requests.count("/jobs/overview") == 1
    assert probe.requests.count("/jobs/j1/vertices/v1/backpressure") == 2


def test_no_running_job_means_no_signal():
    assert _FakeFlink(_cluster(job_state="FAILED"))() is None


def test_unreachable_flink_means_no_signal_and_recovers():
    responses = _cluster()
    responses["/jobs/overview"] = urllib.error.URLError("connection refused")
    probe = _FakeFlink(responses)
    assert probe() is None
    assert not probe.available

    probe.responses = _cluster()
    assert probe() == 0.6
    assert probe.available


def test_a_failure_drops_the_cached_job_so_a_resubmitted_job_is_found():
    probe = _FakeFlink(_cluster())
    probe()
    probe.responses["/jobs/j1/vertices/v1/backpressure"] = urllib.error.HTTPError("u", 404, "gone", None, None)
    assert probe() is None
    probe.responses = _cluster(ratios=(0.2, 0.1))
    assert probe() == 0.2
    assert probe.requests.count("/jobs/overview") == 2
