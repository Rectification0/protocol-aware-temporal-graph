"""F0.9: read-only surfacing of config/protocols.yaml and config/motifs.yaml.

Backing: `src/t_gnn/protocol_registry.py`'s `ProtocolDecayRegistry` and
`src/t_gnn/motifs.py`'s `MotifRegistry` -- both already hot-reload from
disk (`reload()`), so this endpoint always reflects whatever's currently on
disk without the API process needing a restart. A write-path (edit
lambda_p / motif window from the dashboard) is explicitly out of scope for
this first pass (tasks.md F15.5) -- today those are hand-edited YAML +
`reload()` per `docs/operational-runbook.md`.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends

from t_gnn.api.deps import get_motif_registry, get_protocol_registry
from t_gnn.api.schemas import MotifConfigOut, MotifStepOut, ProtocolConfigOut
from t_gnn.motifs import MotifRegistry
from t_gnn.protocol_registry import ProtocolDecayRegistry

router = APIRouter(prefix="/api/config", tags=["config"])


@router.get("/protocols", response_model=list[ProtocolConfigOut])
def list_protocols(registry: ProtocolDecayRegistry = Depends(get_protocol_registry)) -> list[ProtocolConfigOut]:
    return [ProtocolConfigOut(**registry.get(name).__dict__) for name in registry.protocols]


@router.get("/motifs", response_model=list[MotifConfigOut])
def list_motifs(registry: MotifRegistry = Depends(get_motif_registry)) -> list[MotifConfigOut]:
    return [
        MotifConfigOut(
            name=definition.name,
            description=definition.description,
            window_seconds=definition.window_seconds,
            steps=[
                MotifStepOut(
                    key_field=step.key_field,
                    edge_type=sorted(step.edge_type),
                    protocol=sorted(step.protocol),
                    src_type=sorted(step.src_type),
                    dst_type=sorted(step.dst_type),
                    key_resolver=step.key_resolver,
                )
                for step in definition.steps
            ],
        )
        for definition in registry.all()
    ]
