from t_gnn.baseline import BaselineStore, EWMABaseline
from t_gnn.schema import Edge


def test_ewma_first_sample_sets_mean_with_zero_variance():
    baseline = EWMABaseline(alpha=0.5)
    baseline.update(10.0)
    assert baseline.mean == 10.0
    assert baseline.variance == 0.0
    assert baseline.sample_count == 1


def test_ewma_mean_moves_toward_new_values():
    baseline = EWMABaseline(alpha=0.5)
    baseline.update(10.0)
    baseline.update(20.0)
    assert 10.0 < baseline.mean < 20.0


def test_ewma_variance_grows_after_a_deviating_sample():
    baseline = EWMABaseline(alpha=0.3)
    for _ in range(5):
        baseline.update(10.0)
    assert baseline.std == 0.0

    baseline.update(100.0)
    assert baseline.std > 0.0


def test_z_score_none_below_minimum_samples():
    store = BaselineStore()
    signal = store.observe(entity="User:alice", protocol="RDP", value=1.0, t=0.0)
    assert signal.z_score is None
    assert signal.sample_count == 1


def test_z_score_none_when_baseline_has_zero_variance():
    store = BaselineStore()
    store.observe(entity="User:alice", protocol="RDP", value=1.0, t=0.0)
    signal = store.observe(entity="User:alice", protocol="RDP", value=1.0, t=1.0)
    # Two identical samples -> zero variance -> z-score undefined, not divide-by-zero.
    assert signal.z_score is None


def test_z_score_flags_outlier_after_stable_baseline():
    store = BaselineStore(alpha=0.3)
    entity, protocol = "User:alice", "SMB"
    for i in range(10):
        store.observe(entity=entity, protocol=protocol, value=1.0 + (i % 2) * 0.01, t=float(i))

    signal = store.observe(entity=entity, protocol=protocol, value=50.0, t=10.0)
    assert signal.z_score is not None
    assert signal.z_score > 5.0


def test_baseline_store_keys_by_entity_and_protocol_independently():
    store = BaselineStore()
    store.observe(entity="User:alice", protocol="RDP", value=1.0, t=0.0)
    store.observe(entity="User:alice", protocol="RDP", value=1.0, t=1.0)
    store.observe(entity="User:alice", protocol="RDP", value=1.0, t=2.0)

    # A different protocol for the same entity should have its own fresh baseline.
    signal = store.observe(entity="User:alice", protocol="SMB", value=999.0, t=3.0)
    assert signal.sample_count == 1
    assert signal.z_score is None

    # A different entity, same protocol, should also have its own fresh baseline.
    signal2 = store.observe(entity="User:bob", protocol="RDP", value=999.0, t=3.0)
    assert signal2.sample_count == 1


def test_observe_edge_uses_src_as_entity_and_w_as_value():
    store = BaselineStore()
    edge = Edge(
        src="User:alice",
        dst="Machine:C1042",
        edge_type="Authentication",
        protocol="RDP",
        t_e=100.0,
        w_0=1.0,
        w=0.8,
        w_evaluated_at=100.0,
    )
    signal = store.observe_edge(edge)
    assert signal.entity == "User:alice"
    assert signal.protocol == "RDP"
    assert signal.value == 0.8
    assert signal.t == 100.0


def test_observe_edge_requires_refreshed_weight():
    store = BaselineStore()
    edge = Edge(src="User:alice", dst="Machine:C1042", edge_type="Authentication", protocol="RDP", t_e=100.0, w_0=1.0)
    try:
        store.observe_edge(edge)
        assert False, "expected ValueError for edge with w=None"
    except ValueError:
        pass
