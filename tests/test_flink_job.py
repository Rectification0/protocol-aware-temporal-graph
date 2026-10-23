"""Backlog B.1: the real Flink decay/baseline job, end to end on the compose stack.

Runs its own copy of the job on throwaway topics (`t_gnn.flink.harness.
IsolatedJob`), so its event-time clock -- driven by the test's own edge
timestamps -- can't touch the long-running `t-gnn-decay-baseline` job. Skipped unless Kafka (localhost:9092) and
the Flink REST API (localhost:8081) are up: `docker compose up -d`. Slow-ish
(~70s, mostly job startup and the backpressure test).
"""

import json
import math
import threading
import time

import pytest

confluent_kafka = pytest.importorskip("confluent_kafka", reason="needs the [flink] extra: pip install -e '.[flink]'")

from t_gnn.flink.harness import IsolatedJob, stack_up  # noqa: E402
from t_gnn.flink.kafka_io import drain, make_producer, produce_edge, publish_lambdas, tail_consumer  # noqa: E402
from t_gnn.flink.logic import expiry_time, parse_decayed_record  # noqa: E402
from t_gnn.flink.backpressure import FlinkBackpressureProbe  # noqa: E402
from t_gnn.cold_storage import InMemoryColdStorageWriter  # noqa: E402
from t_gnn.decay import DecayEngine  # noqa: E402
from t_gnn.graph_store import ActiveGraphStore  # noqa: E402
from t_gnn.pruning import EpsilonController, PruningWatcher  # noqa: E402
from t_gnn.protocol_registry import ProtocolDecayRegistry  # noqa: E402
from t_gnn.schema import Edge  # noqa: E402
from t_gnn.streaming import DecayStreamProcessor  # noqa: E402

BOOTSTRAP = "localhost:9092"
FLINK_URL = "http://localhost:8081"
T0 = 1_000_000.0  # the test's own event-time origin; its topics see no other clock
REFRESH_INTERVAL = 60.0
EXPIRE_BELOW = 0.05


pytestmark = pytest.mark.skipif(not stack_up(BOOTSTRAP, FLINK_URL), reason="Kafka/Flink not reachable -- run `docker compose up -d` first")


class Collector:
    """Accumulates the job's output records, keyed for lookups across tests."""

    def __init__(self, consumer, decayed_topic: str) -> None:
        self.consumer = consumer
        self.decayed_topic = decayed_topic
        self.decayed: list = []
        self.weights: list[dict] = []

    def poll(self, timeout: float) -> None:
        for topic, value in drain(self.consumer, timeout=timeout):
            if topic == self.decayed_topic:
                self.decayed.append(parse_decayed_record(value))
            else:
                self.weights.append(json.loads(value))

    def decayed_for(self, entity: str) -> list:
        return [(edge, signal) for edge, signal in self.decayed if edge.src == entity]

    def weights_for(self, edge_id: str) -> list[dict]:
        return [w for w in self.weights if w["edge_id"] == edge_id]

    def wait_for(self, predicate, timeout: float = 60.0) -> None:
        deadline = time.monotonic() + timeout
        while not predicate():
            if time.monotonic() > deadline:
                seen = {}
                for edge, _ in self.decayed:
                    seen[edge.src] = seen.get(edge.src, 0) + 1
                weights = [(w["src"], round(w["t"], 3), w["expired"]) for w in self.weights]
                raise AssertionError(f"timed out waiting for the job's output; decayed per entity={seen}, weights={weights}")
            self.poll(timeout=1.0)


def _edge(src: str, t_e: float, protocol: str = "RDP", w_0: float = 1.0) -> Edge:
    return Edge(src=src, dst="Machine:C1", edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=w_0)


@pytest.fixture(scope="module")
def job():
    with IsolatedJob("t-gnn-test", ["--refresh-interval", str(REFRESH_INTERVAL), "--expire-below", str(EXPIRE_BELOW),
                                    "--out-of-orderness", "0", "--idleness", "1"], BOOTSTRAP, FLINK_URL) as isolated:
        collector = Collector(tail_consumer([isolated.topics["decayed"], isolated.topics["weights"]], BOOTSTRAP),
                              isolated.topics["decayed"])
        try:
            yield {"topics": isolated.topics, "collector": collector, "producer": make_producer(BOOTSTRAP),
                   "job_name": isolated.name}
        finally:
            collector.consumer.close()


@pytest.fixture(scope="module")
def published(job):
    """Publishes the registry's lambda_p values -- but first sends an edge
    with nothing published yet, recording what the job did with it."""
    producer, collector = job["producer"], job["collector"]
    held = _edge("User:held", t_e=T0)
    produce_edge(producer, held, topic=job["topics"]["edges"])
    producer.flush(10)
    collector.poll(timeout=5.0)
    before = list(collector.decayed_for("User:held"))

    registry = ProtocolDecayRegistry()
    publish_lambdas(producer, registry, topic=job["topics"]["lambdas"])
    collector.wait_for(lambda: collector.decayed_for("User:held"))
    return {**job, "registry": registry, "held": held, "held_before_publish": before}


def test_holds_an_edge_until_a_lambda_is_published(published):
    assert published["held_before_publish"] == []
    [(edge, signal)] = published["collector"].decayed_for("User:held")
    assert edge.edge_id == published["held"].edge_id
    assert edge.w == 1.0 and signal.sample_count == 1


def test_decayed_output_matches_the_in_process_pipeline(published):
    producer, collector = published["producer"], published["collector"]
    entity = "User:baseline"
    edges = [_edge(entity, T0 + 1 + i, protocol="Kerberos", w_0=w_0)
             for i, w_0 in enumerate([1.0, 0.8, 0.9, 0.3, 1.0, 0.95])]
    for edge in edges:
        produce_edge(producer, edge, topic=published["topics"]["edges"])
    producer.flush(10)
    collector.wait_for(lambda: len(collector.decayed_for(entity)) == len(edges))

    processor = DecayStreamProcessor(registry=published["registry"])
    for (edge, signal), sent in zip(collector.decayed_for(entity), edges):
        expected = processor.process(sent, t=sent.t_e)
        assert edge.edge_id == sent.edge_id
        assert edge.w == pytest.approx(expected.edge.w) and edge.w_evaluated_at == expected.edge.w_evaluated_at
        assert signal.sample_count == expected.deviation.sample_count
        assert signal.baseline_mean == pytest.approx(expected.deviation.baseline_mean)
        assert signal.baseline_std == pytest.approx(expected.deviation.baseline_std)
        assert signal.z_score == pytest.approx(expected.deviation.z_score)
    assert collector.decayed_for(entity)[-1][1].z_score is not None


def test_timer_refreshes_follow_a_hot_reloaded_lambda_to_expiry(published):
    producer, collector = published["producer"], published["collector"]
    edges_topic, lambdas_topic = published["topics"]["edges"], published["topics"]["lambdas"]
    rdp = published["registry"].lambda_for("RDP")
    tracked = _edge("User:decaying", t_e=T0 + 10)

    def advance_clock_to(t: float) -> None:
        # Any later edge moves the watermark (out-of-orderness is 0 here).
        produce_edge(producer, _edge("User:clock", t_e=t, protocol="DNS"), topic=edges_topic)
        producer.flush(10)

    produce_edge(producer, tracked, topic=edges_topic)
    advance_clock_to(T0 + 160)
    collector.wait_for(lambda: len(collector.weights_for(tracked.edge_id)) == 2)

    # Hot reload: a much faster RDP decay, straight into broadcast state.
    fast = 0.01
    producer.produce(lambdas_topic, key="RDP", value=json.dumps({"protocol": "RDP", "lambda_p": fast, "published_at": time.time()}))
    producer.flush(10)
    # Broadcast state sends no ack, so confirm the update has landed: a
    # sentinel edge whose first refresh (t_e + 60) falls inside a small clock
    # step reports the lambda_p it was decayed with. The steps stay short of
    # the tracked edge's next timer (T0 + 190), so its sequence is untouched.
    for k in range(20):
        sentinel = _edge(f"User:sentinel-{k}", t_e=T0 + 100 + k)
        produce_edge(producer, sentinel, topic=edges_topic)
        advance_clock_to(T0 + 165 + k)
        collector.wait_for(lambda: collector.weights_for(sentinel.edge_id))
        if collector.weights_for(sentinel.edge_id)[0]["lambda_p"] == fast:
            break
    else:
        raise AssertionError("the hot-reloaded lambda_p never reached broadcast state")

    advance_clock_to(T0 + 1000)
    collector.wait_for(lambda: any(w["expired"] for w in collector.weights_for(tracked.edge_id)))
    collector.poll(timeout=3.0)  # anything after expiry would be a bug

    refreshes = collector.weights_for(tracked.edge_id)
    expiry = expiry_time(tracked, fast, EXPIRE_BELOW)
    assert [round(w["t"], 3) for w in refreshes] == [T0 + 70, T0 + 130, T0 + 190, T0 + 250, round(expiry, 3)]
    assert [w["lambda_p"] for w in refreshes] == [rdp, rdp, fast, fast, fast]
    assert [w["expired"] for w in refreshes] == [False, False, False, False, True]
    for w in refreshes:
        assert w["w"] == pytest.approx(math.exp(-w["lambda_p"] * (w["t"] - tracked.t_e)))


def test_real_backpressure_tightens_epsilon(published):
    """Backlog B.2 on the live cluster. Must stay the last test in this module:
    it buries the job in work, which the module teardown then cancels.

    The overload is genuine Flink backpressure, not a stub. Slow-decaying DNS
    edges each queue tens of thousands of 60s re-evaluations, and one edge far
    in the future releases all of those timers at once. While the Python
    decay operator works through them, a background producer keeps feeding
    the source, which blocks on the full buffers -- what a log spike does."""
    producer, edges_topic = published["producer"], published["topics"]["edges"]
    for i in range(200):
        produce_edge(producer, _edge(f"User:storm-{i}", t_e=T0 + 5_000, protocol="DNS"), topic=edges_topic)
    produce_edge(producer, _edge("User:clock", t_e=T0 + 5_000 + 4e6, protocol="DNS"), topic=edges_topic)
    producer.flush(10)

    stop = threading.Event()

    def keep_feeding():
        feeder = make_producer(BOOTSTRAP)
        i = 0
        while not stop.is_set():
            produce_edge(feeder, _edge(f"User:feed-{i}", t_e=T0 + 5_000 + 4e6 + i, protocol="DNS"), topic=edges_topic)
            i += 1
            if i % 500 == 0:
                feeder.flush(5)
        feeder.flush(5)

    feeder = threading.Thread(target=keep_feeding, daemon=True)
    feeder.start()
    try:
        watcher = PruningWatcher(
            store=ActiveGraphStore(), decay_engine=DecayEngine(),
            epsilon_controller=EpsilonController(epsilon_min=0.05, epsilon_max=0.4),
            cold_storage=InMemoryColdStorageWriter(), memory_probe=lambda: None,
            backpressure_probe=FlinkBackpressureProbe(FLINK_URL, job_name=published["job_name"], timeout=5.0),
        )
        readings = []
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            stats = watcher.run_once(t=0.0)
            readings.append(stats.backpressure)
            if stats.backpressure is not None and stats.backpressure >= 0.5:
                break
            time.sleep(2.0)
        else:
            raise AssertionError(f"no high backpressure within 120s; readings={readings}")
    finally:
        stop.set()
        feeder.join(timeout=10)

    assert readings[0] is not None  # the probe found the job from the first pass
    assert stats.epsilon == pytest.approx(0.4)  # backpressure >= 0.5 is full pressure
