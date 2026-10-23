"""Backlog B.1: the Flink job's per-record logic, without PyFlink or Kafka."""

import json
import math

import pytest

from t_gnn.baseline import BaselineStore
from t_gnn.decay import DecayEngine
from t_gnn.flink.logic import (
    DEFAULT_PROTOCOL_KEY,
    baseline_key,
    decayed_record,
    expiry_time,
    lambda_records,
    next_refresh_time,
    observe_from_state,
    parse_decayed_record,
    parse_lambda_record,
    refresh_at_ingest,
    resolve_lambda,
    to_millis,
    weight_record,
)
from t_gnn.protocol_registry import ProtocolDecayRegistry
from t_gnn.schema import Edge
from t_gnn.streaming import DecayStreamProcessor


def _edge(src="User:alice", protocol="RDP", t_e=1000.0, w_0=1.0):
    return Edge(src=src, dst="Machine:C1", edge_type="Authentication", protocol=protocol, t_e=t_e, w_0=w_0)


def test_lambda_records_cover_every_protocol_and_the_default():
    registry = ProtocolDecayRegistry()
    records = dict(lambda_records(registry, published_at=5.0))
    assert set(records) == {DEFAULT_PROTOCOL_KEY, *registry.protocols}
    for key, value in records.items():
        protocol, lambda_p = parse_lambda_record(value)
        assert protocol == key
        assert lambda_p == registry.lambda_for(key)
        assert json.loads(value)["published_at"] == 5.0


def test_resolve_lambda_prefers_protocol_then_default_then_none():
    assert resolve_lambda({"RDP": 0.1, DEFAULT_PROTOCOL_KEY: 0.2}, "RDP") == 0.1
    assert resolve_lambda({DEFAULT_PROTOCOL_KEY: 0.2}, "SMB") == 0.2
    assert resolve_lambda({}, "SMB") is None


def test_refresh_at_ingest_matches_decay_engine():
    registry = ProtocolDecayRegistry()
    edge = _edge(w_0=0.7)
    expected = DecayEngine(registry).refresh(edge, t=edge.t_e)
    assert refresh_at_ingest(edge, registry.lambda_for("RDP")) == expected


def test_expiry_time_is_when_weight_reaches_the_floor():
    edge = _edge(w_0=1.0)
    t = expiry_time(edge, lambda_p=0.01, expire_below=0.05)
    assert math.isclose(math.exp(-0.01 * (t - edge.t_e)), 0.05)
    assert expiry_time(edge, lambda_p=0.0, expire_below=0.05) == math.inf
    assert expiry_time(_edge(w_0=0.01), lambda_p=0.01, expire_below=0.05) == 1000.0


def test_next_refresh_is_an_interval_on_or_the_expiry_moment_if_sooner():
    edge = _edge(w_0=1.0)
    assert next_refresh_time(edge, 1000.0, lambda_p=0.0001, interval=60.0, expire_below=0.05) == 1060.0
    expiry = expiry_time(edge, 0.01, 0.05)  # ~299.6s after t_e
    assert next_refresh_time(edge, 1280.0, lambda_p=0.01, interval=60.0, expire_below=0.05) == expiry
    # Already past expiry (e.g. lambda_p was just raised): due now, not in the past.
    assert next_refresh_time(edge, 1500.0, lambda_p=0.01, interval=60.0, expire_below=0.05) == 1500.0


def test_weight_record_flags_expiry_at_the_floor():
    edge = _edge(w_0=1.0)
    live, expired = weight_record(edge, 1060.0, lambda_p=0.01, expire_below=0.05)
    assert not expired
    assert live["w"] == pytest.approx(math.exp(-0.6))
    assert live["edge_id"] == edge.edge_id and live["lambda_p"] == 0.01
    # The timer lands on the nearest millisecond, so expiry tolerates a hair above the floor.
    at_floor = to_millis(expiry_time(edge, 0.01, 0.05)) / 1000.0
    record, expired = weight_record(edge, at_floor, lambda_p=0.01, expire_below=0.05)
    assert expired and record["expired"]


def test_observe_from_state_matches_baseline_store_step_for_step():
    registry = ProtocolDecayRegistry()
    lambda_p = registry.lambda_for("RDP")
    store = BaselineStore()
    state = None
    for i, w_0 in enumerate([1.0, 0.8, 0.9, 0.3, 1.0, 0.95]):
        edge = refresh_at_ingest(_edge(t_e=1000.0 + i, w_0=w_0), lambda_p)
        state, signal = observe_from_state(state, edge)
        assert signal == store.observe_edge(edge)


def test_decayed_record_round_trips_what_the_in_process_pipeline_produces():
    processed = DecayStreamProcessor().process(_edge(), t=1000.0)
    edge, signal = parse_decayed_record(decayed_record(processed.edge, processed.deviation))
    assert edge == processed.edge
    assert signal == processed.deviation


def test_baseline_key_is_entity_and_protocol():
    assert baseline_key(_edge(src="User:bob", protocol="SMB")) == "User:bob|SMB"
