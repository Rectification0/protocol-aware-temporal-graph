"""Protocol Decay Registry: protocol -> lambda_p (tasks.md 0.3).

This is the base config-loading layer the Flink broadcast-state registry
(design.md 2.2, tasks.md 1.1/1.2) will wrap in Phase 1. Phase 0 only needs
a single source of truth for the initial/placeholder decay constants that
every component (Flink job, calibration scripts, tests) can load without
duplicating numbers inline.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import yaml

_DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[2] / "config" / "protocols.yaml"


@dataclass(frozen=True)
class ProtocolDecayConfig:
    protocol: str
    lambda_p: float
    half_life_hours: Optional[float] = None
    description: Optional[str] = None


class ProtocolDecayRegistry:
    """Loads protocol -> lambda_p mappings from config/protocols.yaml.

    Phase 0 provides load/reload/lookup only. Phase 1 wires this into
    Flink broadcast state so lambda_p updates propagate without redeploy
    (tasks.md 1.1/1.2) instead of each task manager re-reading the file.
    """

    def __init__(self, config_path: Optional[Path] = None) -> None:
        self._config_path = Path(config_path) if config_path else _DEFAULT_CONFIG_PATH
        self._default_lambda: float = 0.0
        self._protocols: dict[str, ProtocolDecayConfig] = {}
        self.reload()

    def reload(self) -> None:
        """Re-read the config file from disk (hot-reload primitive)."""
        with open(self._config_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}

        self._default_lambda = float(raw.get("default_lambda_p", 0.0))

        protocols: dict[str, ProtocolDecayConfig] = {}
        for name, cfg in (raw.get("protocols") or {}).items():
            protocols[name] = ProtocolDecayConfig(
                protocol=name,
                lambda_p=float(cfg["lambda_p"]),
                half_life_hours=cfg.get("half_life_hours"),
                description=cfg.get("description"),
            )
        self._protocols = protocols

    @property
    def protocols(self) -> tuple[str, ...]:
        return tuple(self._protocols.keys())

    def get(self, protocol: str) -> ProtocolDecayConfig:
        try:
            return self._protocols[protocol]
        except KeyError:
            return ProtocolDecayConfig(protocol=protocol, lambda_p=self._default_lambda)

    def lambda_for(self, protocol: str) -> float:
        return self.get(protocol).lambda_p

    def update(self, protocol: str, lambda_p: float) -> None:
        """In-memory update of a single protocol's lambda_p, without
        touching config/protocols.yaml on disk (tasks.md Backlog B.3's
        `AdaptiveDecayCalibrator` writes here; a human-driven correction
        per task 1.7 still goes through hand-editing the YAML + `reload()`).
        Preserves the existing `half_life_hours`/`description` metadata for
        that protocol if it was already configured; falls back to a bare
        `ProtocolDecayConfig` if the protocol wasn't already in the
        registry (e.g. a protocol observed live that isn't in
        config/protocols.yaml, previously only covered by the
        `default_lambda_p` fallback)."""
        existing = self._protocols.get(protocol)
        self._protocols[protocol] = ProtocolDecayConfig(
            protocol=protocol,
            lambda_p=lambda_p,
            half_life_hours=existing.half_life_hours if existing else None,
            description=existing.description if existing else None,
        )
