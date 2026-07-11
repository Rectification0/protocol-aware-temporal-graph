"""Tests for MotifEngine's fuzzy/probabilistic matching mode (tasks.md Backlog B.4)."""

from t_gnn.motif_engine import InMemoryMotifStateStore, MotifEngine
from t_gnn.motifs import MotifDefinition, MotifStep
from t_gnn.schema import Edge


def _edge(src, dst, edge_type="Authentication", protocol="Kerberos", t_e=0.0):
    return Edge(src=src, dst=dst, edge_type=edge_type, protocol=protocol, t_e=t_e, w_0=1.0)


# Two-hop motif where the second hop has BOTH a protocol and an edge_type
# constraint, so it has two "fuzzy" dimensions to partially match.
_TWO_STEP = MotifDefinition(
    name="two_step",
    window_seconds=100.0,
    steps=(
        MotifStep(key_field="dst", src_type=frozenset({"Machine"}), dst_type=frozenset({"Machine"})),
        MotifStep(
            key_field="src", key_resolver="host_admin",
            src_type=frozenset({"User"}), dst_type=frozenset({"Machine"}),
            edge_type=frozenset({"Authentication"}), protocol=frozenset({"RDP"}),
        ),
    ),
)


def _engine(fuzzy, min_confidence=0.5):
    return MotifEngine(
        definitions=[_TWO_STEP], state_store=InMemoryMotifStateStore(),
        fuzzy=fuzzy, min_confidence=min_confidence,
    )


def test_fuzzy_mode_completes_exact_sequence_with_confidence_one():
    engine = _engine(fuzzy=True)
    hop1 = _edge("Machine:A", "Machine:B", t_e=0.0)
    hop2 = _edge("User:B-admin", "Machine:C", edge_type="Authentication", protocol="RDP", t_e=10.0)

    assert engine.on_edge(hop1) == []
    completions = engine.on_edge(hop2)

    assert len(completions) == 1
    assert completions[0].confidence == 1.0


def test_fuzzy_mode_completes_a_variant_technique_with_reduced_confidence():
    """The attacker used SMB instead of the canonical RDP for the second
    hop -- edge_type still matches (Authentication) but protocol doesn't,
    so 1 of 2 fuzzy dimensions is satisfied (confidence 0.5), which still
    clears the default min_confidence=0.5 threshold."""
    engine = _engine(fuzzy=True, min_confidence=0.5)
    hop1 = _edge("Machine:A", "Machine:B", t_e=0.0)
    hop2 = _edge("User:B-admin", "Machine:C", edge_type="Authentication", protocol="SMB", t_e=10.0)

    engine.on_edge(hop1)
    completions = engine.on_edge(hop2)

    assert len(completions) == 1
    assert completions[0].confidence == 0.5


def test_fuzzy_mode_drops_a_match_below_min_confidence():
    engine = _engine(fuzzy=True, min_confidence=0.75)
    hop1 = _edge("Machine:A", "Machine:B", t_e=0.0)
    hop2 = _edge("User:B-admin", "Machine:C", edge_type="Authentication", protocol="SMB", t_e=10.0)

    engine.on_edge(hop1)
    completions = engine.on_edge(hop2)

    assert completions == []  # confidence 0.5 < min_confidence 0.75


def test_fuzzy_mode_still_hard_rejects_structural_role_mismatch():
    """Even in fuzzy mode, the second hop must still be User->Machine --
    a Machine->Machine second hop is not a "variant technique," it's a
    completely different shape."""
    engine = _engine(fuzzy=True)
    hop1 = _edge("Machine:A", "Machine:B", t_e=0.0)
    wrong_shape_hop2 = _edge("Machine:B-admin", "Machine:C", edge_type="Authentication", protocol="RDP", t_e=10.0)

    engine.on_edge(hop1)
    completions = engine.on_edge(wrong_shape_hop2)

    assert completions == []


def test_non_fuzzy_mode_still_requires_exact_match_regardless_of_min_confidence():
    """Default fuzzy=False must behave identically to the pre-B.4 engine --
    a low min_confidence should NOT admit a protocol mismatch when fuzzy
    matching isn't enabled at all."""
    engine = _engine(fuzzy=False, min_confidence=0.0)
    hop1 = _edge("Machine:A", "Machine:B", t_e=0.0)
    hop2 = _edge("User:B-admin", "Machine:C", edge_type="Authentication", protocol="SMB", t_e=10.0)

    engine.on_edge(hop1)
    completions = engine.on_edge(hop2)

    assert completions == []  # protocol=SMB doesn't match the required RDP, and fuzzy is off
