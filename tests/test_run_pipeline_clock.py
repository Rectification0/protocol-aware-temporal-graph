"""`scripts/run_pipeline.py --clock` (synthetic mode): with the default
wall clock, every edge's `t_e` is the real time it was generated -- the
fix for the dashboard's "last 24h" ranges showing nothing, because the old
accelerated clock stamped everything in the future. `--clock simulated`
keeps that accelerated behavior on request.

The script isn't a package module, so it's loaded by path. Importing it
has no side effects beyond `t_gnn.db`'s `.env` load (everything else lives
in `main()`)."""

from __future__ import annotations

import importlib.util
import itertools
import random
import time
from pathlib import Path

import pytest

from t_gnn.motif_engine import InMemoryMotifStateStore, MotifEngine
from t_gnn.motifs import MotifRegistry

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "run_pipeline.py"


@pytest.fixture(scope="module")
def pipeline():
    spec = importlib.util.spec_from_file_location("run_pipeline_under_test", _SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _take(stream, n):
    return list(itertools.islice(stream, n))


def test_wall_clock_stamps_every_edge_at_real_time(pipeline, capsys):
    before = time.time()
    edges = _take(pipeline._synthetic_edge_stream(random.Random(1), 20, 10, attack_every=5, clock="wall"), 60)
    after = time.time()

    assert all(before <= e.t_e <= after + 1 for e in edges), "no edge may be stamped in the future"
    assert [e.t_e for e in edges] == sorted(e.t_e for e in edges), "timestamps stay monotonic"
    assert len({e.edge_id for e in edges}) == len(edges), "restamped attack hops get fresh, unique ids"
    capsys.readouterr()


def test_simulated_clock_is_still_accelerated_into_the_future(pipeline, capsys):
    before = time.time()
    edges = _take(pipeline._synthetic_edge_stream(random.Random(1), 20, 10, attack_every=5, clock="simulated"), 60)

    # 1-30 simulated seconds per edge, plus hour-long attack hop gaps.
    assert edges[-1].t_e - before > 60 * 1.0
    capsys.readouterr()


def test_restamped_attacks_still_complete_their_motifs(pipeline, capsys):
    """Collapsing a lateral_pivot's 1h hop gap to 1ms must not stop the
    engine from detecting it -- the windows bound the *maximum* gap."""
    engine = MotifEngine(definitions=MotifRegistry().all(), state_store=InMemoryMotifStateStore())
    rng = random.Random(7)
    machines = [f"C{1000 + i}" for i in range(10)]
    now = time.time()

    completed = []
    for kind in ("lateral_pivot", "admin_share_escalation"):
        attack = pipeline._restamp_now(pipeline._inject_attack(kind, rng, 20, machines, now), now)
        assert all(now <= e.t_e < now + 1 for e in attack)
        for edge in attack:
            completed += [event.motif_name for event in engine.on_edge(edge)]

    assert sorted(completed) == ["admin_share_escalation", "lateral_pivot"]
    capsys.readouterr()
