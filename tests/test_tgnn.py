import time

import torch

from t_gnn.baseline import DeviationSignal
from t_gnn.graph_store import ActiveGraphStore
from t_gnn.motif_engine import MotifAlertBus, MotifCompletionEvent
from t_gnn.schema import Edge
from t_gnn.tgnn import DynamicTGNN, EntityFeatureTable, InferenceResultBus, TGNNInferenceEngine


def _edge(src, dst, edge_type="Authentication", protocol="Kerberos", t_e=0.0):
    return Edge(src=src, dst=dst, edge_type=edge_type, protocol=protocol, t_e=t_e, w_0=1.0)


def _deviation(entity, z_score, protocol="Kerberos", t=0.0):
    return DeviationSignal(
        entity=entity, protocol=protocol, t=t, value=1.0,
        baseline_mean=1.0, baseline_std=0.1, sample_count=5, z_score=z_score,
    )


# --- EntityFeatureTable ----------------------------------------------------------


def test_rows_for_assigns_stable_rows_across_calls():
    table = EntityFeatureTable(feature_dim=4)
    first = table.rows_for(["Machine:A", "Machine:B"])
    second = table.rows_for(["Machine:B", "Machine:A"])  # reversed order

    assert torch.equal(first[0], second[1])  # Machine:A's row is identical regardless of call order
    assert torch.equal(first[1], second[0])


def test_rows_for_grows_lazily_for_new_ids():
    table = EntityFeatureTable(feature_dim=4)
    table.rows_for(["Machine:A"])
    assert len(table) == 1

    table.rows_for(["Machine:A", "Machine:B", "Machine:C"])
    assert len(table) == 3


# --- DynamicTGNN.score_entities (5.1/5.2) ----------------------------------------


def test_score_entities_empty_store_returns_empty_dict():
    model = DynamicTGNN()
    store = ActiveGraphStore()
    assert model.score_entities(store, {}) == {}


def test_score_entities_covers_every_live_node():
    model = DynamicTGNN()
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:A", "Machine:B"))
    store.upsert(_edge("Machine:B", "Machine:C"))

    scores = model.score_entities(store, {})

    assert set(scores.keys()) == {"Machine:A", "Machine:B", "Machine:C"}
    assert all(isinstance(v, float) for v in scores.values())


def test_score_entities_reflects_dynamic_edge_dropping():
    """5.1: an edge removed from the live store between calls is reflected
    on the very next forward pass -- no separate sync step needed."""
    model = DynamicTGNN()
    store = ActiveGraphStore()
    isolated_edge = _edge("Machine:A", "Machine:B")
    store.upsert(isolated_edge)
    store.upsert(_edge("Machine:B", "Machine:C"))

    before = model.score_entities(store, {})
    assert "Machine:A" in before

    store.remove(isolated_edge.edge_id)
    after = model.score_entities(store, {})

    assert "Machine:A" not in after
    assert set(after.keys()) == {"Machine:B", "Machine:C"}


def test_score_entities_restricts_to_requested_entity_ids():
    model = DynamicTGNN()
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:A", "Machine:B"))
    store.upsert(_edge("Machine:B", "Machine:C"))

    scores = model.score_entities(store, {}, entity_ids=["Machine:A"])

    assert set(scores.keys()) == {"Machine:A"}


def test_score_entities_ignores_requested_id_absent_from_live_store():
    model = DynamicTGNN()
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:A", "Machine:B"))

    scores = model.score_entities(store, {}, entity_ids=["Machine:A", "Machine:ghost"])

    assert set(scores.keys()) == {"Machine:A"}


def test_deviation_feature_changes_the_score():
    """5.2: the deviation z-score is a real input to the forward pass, not
    a cosmetic side-channel -- changing it changes the model's output for
    an otherwise-identical graph."""
    model = DynamicTGNN()
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:A", "Machine:B"))
    store.upsert(_edge("Machine:B", "Machine:C"))

    baseline_scores = model.score_entities(store, {})
    deviated_scores = model.score_entities(store, {"Machine:A": 25.0})

    assert baseline_scores["Machine:A"] != deviated_scores["Machine:A"]


# --- TGNNInferenceEngine.observe_deviation (5.2) ---------------------------------


def test_observe_deviation_records_z_score():
    store = ActiveGraphStore()
    engine = TGNNInferenceEngine(store=store)

    engine.observe_deviation(_deviation("User:alice", z_score=4.2))

    assert engine._deviation_features["User:alice"] == 4.2  # noqa: SLF001


def test_observe_deviation_ignores_none_z_score_without_clearing_prior_value():
    store = ActiveGraphStore()
    engine = TGNNInferenceEngine(store=store)
    engine.observe_deviation(_deviation("User:alice", z_score=4.2))

    engine.observe_deviation(_deviation("User:alice", z_score=None))

    assert engine._deviation_features["User:alice"] == 4.2  # noqa: SLF001


# --- TGNNInferenceEngine.run_once (5.1/2.8 "periodically") -----------------------


def test_run_once_publishes_scheduled_results_for_every_live_node():
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:A", "Machine:B"))
    bus = InferenceResultBus()
    received = []
    bus.subscribe(received.append)
    engine = TGNNInferenceEngine(store=store, result_bus=bus)

    results = engine.run_once(t=42.0)

    assert {r.entity_id for r in results} == {"Machine:A", "Machine:B"}
    assert all(r.trigger == "scheduled" and r.t == 42.0 for r in results)
    assert received == results


# --- TGNNInferenceEngine.on_motif_completion (5.3 fast path) ---------------------


def test_on_motif_completion_scores_chain_key_neighborhood_only():
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:A", "Machine:B"))       # Machine:B's neighborhood
    store.upsert(_edge("Machine:B", "Machine:C"))
    store.upsert(_edge("Machine:X", "Machine:Y"))        # unrelated subgraph
    engine = TGNNInferenceEngine(store=store)

    event = MotifCompletionEvent(
        motif_name="lateral_pivot", chain_key="Machine:B",
        matched_edges=["e1", "e2"], completed_at=99.0,
    )
    results = engine.on_motif_completion(event)

    assert {r.entity_id for r in results} == {"Machine:A", "Machine:B", "Machine:C"}
    assert all(r.trigger == "motif_completion" and r.motif_name == "lateral_pivot" for r in results)
    assert all(r.t == 99.0 for r in results)


def test_on_motif_completion_auto_subscribes_to_alert_bus():
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:B", "Machine:C"))
    alert_bus = MotifAlertBus()
    result_bus = InferenceResultBus()
    received = []
    result_bus.subscribe(received.append)
    TGNNInferenceEngine(store=store, result_bus=result_bus, alert_bus=alert_bus)

    alert_bus.publish(MotifCompletionEvent(
        motif_name="lateral_pivot", chain_key="Machine:B", matched_edges=["e1"], completed_at=5.0,
    ))

    assert len(received) >= 1
    assert all(r.trigger == "motif_completion" for r in received)


# --- background thread lifecycle -------------------------------------------------


def test_start_stop_runs_scheduled_inference_in_background():
    store = ActiveGraphStore()
    store.upsert(_edge("Machine:A", "Machine:B"))
    bus = InferenceResultBus()
    received = []
    bus.subscribe(received.append)
    engine = TGNNInferenceEngine(store=store, result_bus=bus, poll_interval=0.02)

    engine.start()
    try:
        deadline = time.time() + 2.0
        while time.time() < deadline and not received:
            time.sleep(0.02)
        assert received
    finally:
        engine.stop(timeout=2.0)


def test_stop_is_idempotent_and_joins_thread():
    store = ActiveGraphStore()
    engine = TGNNInferenceEngine(store=store)
    engine.start()
    engine.stop(timeout=2.0)
    engine.stop(timeout=2.0)  # calling stop again should not raise
