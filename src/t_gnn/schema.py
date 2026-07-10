"""Shared edge data contract (tasks.md 0.2).

This is the single Python-side representation of the edge contract whose
authoritative, language-agnostic definition lives in
config/schema/edge.schema.json. Every component that touches an edge --
the Flink ingestion job, the Active Graph Store (PyTorch Geometric), the
Redis motif cache, and the Neo4j cold-storage writer -- is expected to
round-trip through this shape (or the equivalent in its own runtime) so
that no component silently drifts from the others.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

import jsonschema

_SCHEMA_PATH = Path(__file__).resolve().parents[2] / "config" / "schema" / "edge.schema.json"

NODE_TYPES = ("User", "Machine")
EDGE_TYPES = ("Authentication", "FileTransfer", "RemoteCodeExecution")
PROTOCOLS = ("RDP", "SMB", "Kerberos", "DNS")


@lru_cache(maxsize=1)
def _load_json_schema() -> dict:
    with open(_SCHEMA_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def _infer_node_type(node_id: str) -> Optional[str]:
    """Best-effort node type from an id of the form '<Type>:<name>'."""
    prefix, _, _ = node_id.partition(":")
    return prefix if prefix in NODE_TYPES else None


def make_edge_id(src: str, dst: str, protocol: str, t_e: float) -> str:
    """Deterministic id used as the Active Graph Store / Redis / Neo4j key."""
    raw = f"{src}|{dst}|{protocol}|{t_e!r}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


@dataclass
class Edge:
    src: str
    dst: str
    edge_type: str
    protocol: str
    t_e: float
    w_0: float
    edge_id: Optional[str] = None
    src_type: Optional[str] = None
    dst_type: Optional[str] = None
    w: Optional[float] = None
    w_evaluated_at: Optional[float] = None
    source_system: str = "unknown"
    raw_event_id: Optional[str] = None

    def __post_init__(self) -> None:
        if self.edge_id is None:
            self.edge_id = make_edge_id(self.src, self.dst, self.protocol, self.t_e)
        if self.src_type is None:
            self.src_type = _infer_node_type(self.src)
        if self.dst_type is None:
            self.dst_type = _infer_node_type(self.dst)

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), sort_keys=True)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Edge":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})

    @classmethod
    def from_json(cls, data: str) -> "Edge":
        return cls.from_dict(json.loads(data))

    def validate(self) -> None:
        """Validate this edge against the shared JSON Schema contract.

        Raises jsonschema.ValidationError if the edge does not conform.
        """
        payload = {k: v for k, v in self.to_dict().items() if v is not None}
        jsonschema.validate(instance=payload, schema=_load_json_schema())
