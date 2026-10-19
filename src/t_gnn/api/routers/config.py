"""F0.9: surfacing of config/protocols.yaml and config/motifs.yaml.
Frontend Backlog FB.1: the matching write path.

Backing: `src/t_gnn/protocol_registry.py`'s `ProtocolDecayRegistry` and
`src/t_gnn/motifs.py`'s `MotifRegistry` -- both hot-reload from disk
(`reload()`), so the GET endpoints always reflect what's on disk.

FB.1's writes (`PUT /protocols/{protocol}`, `PUT /motifs/{name}`) go through
`config_writer.py`'s `ConfigWriter`: validated, comment-preserving, verified,
atomic edits of the same YAML files -- which stay the single source of truth,
so hand edits per `docs/operational-runbook.md` keep working -- picked up by
the running pipeline's `ConfigFileWatcher`. Decided with the developer
(2026-10-19):

  - Off by default. `API_CONFIG_WRITES_ENABLED=true` turns writes on; until
    then they answer 403 and the Settings form stays read-only
    (`GET /capabilities`). With no real identities yet (F0.11), that
    operator switch *is* the authorization model.
  - Never unaudited. Postgres is checked before the file is touched, and
    every change is recorded (`config_changes`: who, when, old -> new);
    `GET /changes` lists them. The `analyst` name is the mock-auth session's
    claimed name -- an attribution, not an authentication.
"""

from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, Query

from t_gnn.api.deps import (
    config_writes_enabled,
    get_config_writer,
    get_motif_registry,
    get_protocol_registry,
    get_reader,
    get_writer,
    require_postgres,
)
from t_gnn.api.schemas import (
    ConfigCapabilitiesOut,
    ConfigChangeOut,
    MotifConfigOut,
    MotifStepOut,
    MotifWindowIn,
    Paginated,
    ProtocolConfigOut,
    ProtocolLambdaIn,
)
from t_gnn.api_state import ApiStateReader, ApiStateWriter
from t_gnn.config_writer import (
    MAX_LAMBDA_P,
    MAX_WINDOW_SECONDS,
    MIN_LAMBDA_P,
    MIN_WINDOW_SECONDS,
    ConfigChange,
    ConfigTargetNotFound,
    ConfigValidationError,
    ConfigWriteError,
    ConfigWriter,
)
from t_gnn.motifs import MotifRegistry
from t_gnn.protocol_registry import ProtocolDecayRegistry

logger = logging.getLogger(__name__)

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


@router.get("/capabilities", response_model=ConfigCapabilitiesOut)
def read_capabilities(enabled: bool = Depends(config_writes_enabled)) -> ConfigCapabilitiesOut:
    return ConfigCapabilitiesOut(
        writes_enabled=enabled,
        min_lambda_p=MIN_LAMBDA_P,
        max_lambda_p=MAX_LAMBDA_P,
        min_window_seconds=MIN_WINDOW_SECONDS,
        max_window_seconds=MAX_WINDOW_SECONDS,
    )


@router.get("/changes", response_model=Paginated[ConfigChangeOut])
def list_changes(
    limit: int = Query(20, ge=1, le=200),
    offset: int = Query(0, ge=0),
    reader: ApiStateReader = Depends(get_reader),
) -> Paginated[ConfigChangeOut]:
    records = require_postgres(lambda: reader.list_config_changes(limit=limit, offset=offset))
    return Paginated[ConfigChangeOut](
        items=[ConfigChangeOut(**record.__dict__) for record in records], limit=limit, offset=offset, total=None,
    )


def _guarded_write(enabled: bool, writer: ApiStateWriter, analyst: str | None, apply) -> ConfigChangeOut:
    if not enabled:
        raise HTTPException(
            status_code=403,
            detail="Config edits are disabled on this API instance (set API_CONFIG_WRITES_ENABLED=true to allow them).",
        )
    if not writer.ping():
        raise HTTPException(
            status_code=503, detail="Postgres unavailable: refusing a config change that couldn't be audited.",
        )
    try:
        change: ConfigChange = apply()
    except ConfigValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ConfigTargetNotFound as exc:
        raise HTTPException(status_code=404, detail=f"Unknown config entry: {exc.args[0]}") from exc
    except ConfigWriteError as exc:
        raise HTTPException(status_code=409, detail=f"Config file not changed: {exc}") from exc

    changed_at = time.time()
    if not writer.record_config_change(
        change.kind, change.target, change.field, change.old_value, change.new_value, analyst, changed_at,
    ):
        # Postgres dropped between the pre-check and now. The file *is*
        # changed (and the pipeline will pick it up); say so loudly.
        logger.error("FB.1: config change %s applied but its audit row could not be written", change)
    return ConfigChangeOut(
        kind=change.kind, target=change.target, field=change.field, old_value=change.old_value,
        new_value=change.new_value, changed_by=analyst, changed_at=changed_at,
    )


@router.put("/protocols/{protocol}", response_model=ConfigChangeOut)
def update_protocol_lambda(
    protocol: str,
    body: ProtocolLambdaIn,
    enabled: bool = Depends(config_writes_enabled),
    config_writer: ConfigWriter = Depends(get_config_writer),
    writer: ApiStateWriter = Depends(get_writer),
    registry: ProtocolDecayRegistry = Depends(get_protocol_registry),
) -> ConfigChangeOut:
    result = _guarded_write(
        enabled, writer, body.analyst, lambda: config_writer.set_protocol_lambda(protocol, body.lambda_p, body.analyst),
    )
    registry.reload()
    return result


@router.put("/motifs/{name}", response_model=ConfigChangeOut)
def update_motif_window(
    name: str,
    body: MotifWindowIn,
    enabled: bool = Depends(config_writes_enabled),
    config_writer: ConfigWriter = Depends(get_config_writer),
    writer: ApiStateWriter = Depends(get_writer),
    registry: MotifRegistry = Depends(get_motif_registry),
) -> ConfigChangeOut:
    result = _guarded_write(
        enabled, writer, body.analyst, lambda: config_writer.set_motif_window(name, body.window_seconds, body.analyst),
    )
    registry.reload()
    return result
