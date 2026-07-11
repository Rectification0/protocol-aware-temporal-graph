"""Motif definition schema + config-driven registry (tasks.md 3.1/3.9, FR3.1/FR3.5).

Mirrors the split already used for edges (config/schema/edge.schema.json +
schema.py's `Edge`) and protocols (config/protocols.yaml +
protocol_registry.py's `ProtocolDecayRegistry`): the authoritative shape
lives in config/schema/motif.schema.json, config/motifs.yaml is the
operator-editable instance data, and this module is the Python
representation plus the loader that validates one against the other.

**Extensibility mechanism (3.9): config-driven vs. code-driven.** A new
motif expressible as an ordered sequence of typed edge-pattern steps,
chained by a single entity-binding key, within a time bound, is added by
editing config/motifs.yaml and calling `MotifRegistry.reload()` -- no code
change or redeploy (FR3.5's "operator-configurable... without code
redeploy where feasible"). The escape hatch for motifs whose entity-linkage
can't be expressed that way (e.g. a chain that needs to consult an asset
inventory rather than a naming-convention heuristic) is code: add a new
`KeyResolver` to `KEY_RESOLVERS` and reference its name from `key_resolver`
in config. This is the same split already used elsewhere in this codebase
(protocol lambda_p values are config; the *shape* of the decay formula is
code) -- structural pattern matching stays declarative, semantics that
can't be declared stay code.

**Chaining model.** Each step names which of its own endpoints
(`key_field`: "src"/"dst") carries the chain's entity-binding key, and how
to test whether that endpoint continues an existing chain (`key_resolver`).
Step 0 always establishes a fresh chain: its key_field endpoint's raw node
id becomes the chain key. Every later step must resolve to that same key to
advance. Because `key_resolver` computes a deterministic candidate key
directly from the edge's endpoint (not by scanning existing motif states),
motif_engine.py can look up the corresponding Redis-backed state in O(1),
matching design.md 2.6's delta-update requirement.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Optional, Protocol

import jsonschema
import yaml

from t_gnn.schema import Edge

_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "config" / "schema" / "motif.schema.json"
_DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "motifs.yaml"


@lru_cache(maxsize=1)
def _load_json_schema() -> dict:
    with open(_SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _as_frozenset(value: object) -> frozenset:
    """Normalize a schema field that may be null / a single string / a list
    of strings into a frozenset ('any' is represented as an empty set)."""
    if value is None:
        return frozenset()
    if isinstance(value, str):
        return frozenset({value})
    return frozenset(value)


class KeyResolver(Protocol):
    """Computes the chain-binding key a given endpoint node id would need to
    match, so the engine can look up motif state by that key directly."""

    def candidate_key(self, node_id: str) -> Optional[str]: ...


class IdentityKeyResolver:
    """The endpoint's own node id *is* the chain key -- used when the same
    entity literally appears at both ends of the chain link (e.g. a service
    account authenticated in one hop is the same node writing to a share in
    the next)."""

    def candidate_key(self, node_id: str) -> Optional[str]:
        return node_id


class HostAdminKeyResolver:
    """Heuristic placeholder for real directory/asset-inventory linkage
    between a Machine and the User account(s) that administer it (design.md
    2.6's "Machine B's admin account"). Guesses that an admin/service
    account is named after its host, e.g. 'User:C1042-admin' or
    'User:C1042$' administers 'Machine:C1042', by taking the leading
    alnum run of the username as the candidate machine name.

    This is a documented, refinable heuristic in the same spirit as
    sysmon_adapter.py's port/LogonType-based protocol inference -- it is
    expected to be replaced by a real identity/asset-inventory lookup once
    that data source exists; nothing downstream depends on it being exact.
    """

    def candidate_key(self, node_id: str) -> Optional[str]:
        _, _, name = node_id.partition(":")
        if not name:
            return None
        stem = ""
        for ch in name:
            if ch.isalnum():
                stem += ch
            else:
                break
        return f"Machine:{stem}" if stem else None


KEY_RESOLVERS: dict[str, KeyResolver] = {
    "identity": IdentityKeyResolver(),
    "host_admin": HostAdminKeyResolver(),
}


@dataclass(frozen=True)
class MotifStep:
    key_field: str
    edge_type: frozenset = field(default_factory=frozenset)
    protocol: frozenset = field(default_factory=frozenset)
    src_type: frozenset = field(default_factory=frozenset)
    dst_type: frozenset = field(default_factory=frozenset)
    key_resolver: str = "identity"

    def __post_init__(self) -> None:
        if self.key_field not in ("src", "dst"):
            raise ValueError(f"key_field must be 'src' or 'dst', got {self.key_field!r}")
        if self.key_resolver not in KEY_RESOLVERS:
            raise ValueError(f"unknown key_resolver {self.key_resolver!r}")

    def matches_shape(self, edge: Edge) -> bool:
        """Structural match against this step's pattern, ignoring chaining."""
        if self.edge_type and edge.edge_type not in self.edge_type:
            return False
        if self.protocol and edge.protocol not in self.protocol:
            return False
        if self.src_type and edge.src_type not in self.src_type:
            return False
        if self.dst_type and edge.dst_type not in self.dst_type:
            return False
        return True

    def match_score(self, edge: Edge) -> Optional[float]:
        """Fuzzy counterpart to `matches_shape()` (tasks.md Backlog B.4,
        proposal.docx §7's "probabilistic or fuzzy pattern matching ... to
        capture variations of known attack techniques").

        `src_type`/`dst_type` still must match exactly when specified --
        they encode the pattern's structural *roles* (e.g. "a Machine
        authenticating to a Machine"), not a technique an attacker could
        plausibly substitute. `edge_type`/`protocol` are the dimensions
        where a real variation is plausible (an attacker using RDP where
        the canonical pattern used SMB to reach the same kind of hop), so
        they contribute partial credit instead of an all-or-nothing reject.

        Returns `None` if the step cannot match at all (a structural-role
        mismatch, or every specified fuzzy dimension missed); otherwise a
        score in `(0, 1]`, where `1.0` means an exact match identical to
        `matches_shape()`.
        """
        if self.src_type and edge.src_type not in self.src_type:
            return None
        if self.dst_type and edge.dst_type not in self.dst_type:
            return None

        dimensions = 0
        matched = 0
        if self.edge_type:
            dimensions += 1
            if edge.edge_type in self.edge_type:
                matched += 1
        if self.protocol:
            dimensions += 1
            if edge.protocol in self.protocol:
                matched += 1

        if dimensions == 0:
            return 1.0
        if matched == 0:
            return None
        return matched / dimensions

    def endpoint(self, edge: Edge) -> str:
        return edge.src if self.key_field == "src" else edge.dst

    def candidate_key(self, edge: Edge) -> Optional[str]:
        return KEY_RESOLVERS[self.key_resolver].candidate_key(self.endpoint(edge))

    @classmethod
    def from_dict(cls, data: dict) -> "MotifStep":
        return cls(
            key_field=data["key_field"],
            edge_type=_as_frozenset(data.get("edge_type")),
            protocol=_as_frozenset(data.get("protocol")),
            src_type=_as_frozenset(data.get("src_type")),
            dst_type=_as_frozenset(data.get("dst_type")),
            key_resolver=data.get("key_resolver", "identity"),
        )


@dataclass(frozen=True)
class MotifDefinition:
    name: str
    steps: tuple[MotifStep, ...]
    window_seconds: float
    description: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.steps:
            raise ValueError("a motif definition needs at least one step")

    @property
    def final_stage(self) -> int:
        """Stage index reached once the last step has matched."""
        return len(self.steps)

    @classmethod
    def from_dict(cls, name: str, data: dict) -> "MotifDefinition":
        return cls(
            name=name,
            steps=tuple(MotifStep.from_dict(s) for s in data["steps"]),
            window_seconds=float(data["window_seconds"]),
            description=data.get("description"),
        )


class MotifRegistry:
    """Loads + validates motif definitions from config/motifs.yaml against
    config/schema/motif.schema.json (tasks.md 3.1), with the same
    re-read-from-disk hot-reload primitive as `ProtocolDecayRegistry`."""

    def __init__(self, config_path: Optional[Path] = None) -> None:
        self._config_path = Path(config_path) if config_path else _DEFAULT_CONFIG_PATH
        self._definitions: dict[str, MotifDefinition] = {}
        self.reload()

    def reload(self) -> None:
        with open(self._config_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

        schema = _load_json_schema()
        definitions: dict[str, MotifDefinition] = {}
        for name, body in (raw.get("motifs") or {}).items():
            jsonschema.validate(instance=body, schema=schema)
            definitions[name] = MotifDefinition.from_dict(name, body)
        self._definitions = definitions

    @property
    def names(self) -> tuple[str, ...]:
        return tuple(self._definitions.keys())

    def get(self, name: str) -> MotifDefinition:
        return self._definitions[name]

    def all(self) -> list[MotifDefinition]:
        return list(self._definitions.values())
