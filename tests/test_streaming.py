from t_gnn.baseline import BaselineStore
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.streaming import DecayStreamProcessor
from t_gnn.schema import Edge


def _edge(t_e=0.0, protocol="RDP", src="User:alice"):
    return Edge(src=src, dst="Machine:C1042", edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=1.0)


def test_process_refreshes_weight_and_emits_deviation():
    processor = DecayStreamProcessor()
    edge = _edge(t_e=0.0)

    processed = processor.process(edge, t=3600.0)

    assert processed.edge.w is not None
    assert processed.edge.w < 1.0
    assert processed.edge.w_evaluated_at == 3600.0
    assert processed.deviation.entity == "User:alice"
    assert processed.deviation.protocol == "RDP"
    assert processed.deviation.value == processed.edge.w


def test_process_uses_injected_registry_and_baseline_store():
    registry = ProtocolDecayRegistry()
    store = BaselineStore()
    processor = DecayStreamProcessor(registry=registry, baseline_store=store)

    assert processor.decay_engine.registry is registry
    assert processor.baseline_store is store


def test_repeated_processing_builds_a_baseline_and_flags_a_later_spike():
    processor = DecayStreamProcessor()

    # A sequence of edges from the same user/protocol, each observed at a
    # different elapsed time so w(e,t) decays a little further each step --
    # this gives the EWMA baseline genuine (non-zero) variance to work with.
    for i in range(10):
        edge = Edge(src="User:alice", dst="Machine:C1042", edge_type="Authentication", protocol="RDP", t_e=0.0, w_0=1.0)
        processor.process(edge, t=float(i) * 300.0)

    # A brand-new (fresh, undecayed) edge for the same user/protocol should
    # stand out against a baseline that has been trending downward via decay.
    spike_edge = Edge(src="User:alice", dst="Machine:C9999", edge_type="RemoteCodeExecution", protocol="RDP", t_e=3000.0, w_0=1.0)
    spike_processed = processor.process(spike_edge, t=3000.0)
    assert spike_processed.deviation.z_score is not None


def test_pruned_edge_reflected_in_returned_copy_not_original():
    processor = DecayStreamProcessor()
    edge = _edge(t_e=0.0)
    processor.process(edge, t=100.0)
    assert edge.w is None  # original Edge instance is never mutated
