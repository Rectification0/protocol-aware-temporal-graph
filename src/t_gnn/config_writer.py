"""Validated, comment-preserving writes to config/protocols.yaml and
config/motifs.yaml (tasks.md Frontend Backlog FB.1).

Decided with the developer (2026-10-19): the YAML files stay the single
source of truth -- hand edits per `docs/operational-runbook.md` keep
working -- and the running pipeline picks up changes by hot-reloading them
(`ConfigFileWatcher`, `scripts/run_pipeline.py`). Writes are gated off by
default (`API_CONFIG_WRITES_ENABLED`, see `t_gnn.api.routers.config`); that
gate, not this module, is the authorization story until F0.11 exists.

Why a line edit instead of `yaml.safe_dump`: both files are heavily
commented (rationale for every constant), and PyYAML drops comments on a
round trip. So exactly one value line is rewritten in place, and then the
result is *verified semantically* before anything touches disk:

  1. the edited text re-parses, and equals the original parse except for
     the intended field(s) -- any other difference aborts the write;
  2. the edited file loads through the real registry (`ProtocolDecayRegistry`
     / `MotifRegistry`, the latter including its JSON-Schema validation);
  3. only then is it written atomically (temp file + `os.replace`), so a
     concurrent reader -- the pipeline's watcher -- never sees half a file.

Validation bounds are deliberately wide sanity rails, not tuning advice:
they reject values that are certainly mistakes (a negative or zero decay
constant, a half-life shorter than a minute or longer than a year, a motif
window under a minute or over 30 days), not values that are merely unusual.
"""

from __future__ import annotations

import copy
import math
import os
import re
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Optional

import yaml

from t_gnn.motifs import MotifRegistry
from t_gnn.protocol_registry import ProtocolDecayRegistry

_REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROTOCOLS_PATH = _REPO_ROOT / "config" / "protocols.yaml"
DEFAULT_MOTIFS_PATH = _REPO_ROOT / "config" / "motifs.yaml"

MIN_HALF_LIFE_SECONDS = 60.0
MAX_HALF_LIFE_SECONDS = 365 * 24 * 3600.0
MIN_LAMBDA_P = math.log(2) / MAX_HALF_LIFE_SECONDS
MAX_LAMBDA_P = math.log(2) / MIN_HALF_LIFE_SECONDS

MIN_WINDOW_SECONDS = 60
MAX_WINDOW_SECONDS = 30 * 24 * 3600


class ConfigValidationError(ValueError):
    """The requested value is out of bounds -- the caller's mistake (HTTP 422)."""


class ConfigTargetNotFound(KeyError):
    """No such protocol/motif in the file (HTTP 404)."""


class ConfigWriteError(RuntimeError):
    """The edit couldn't be applied safely -- e.g. the file's layout isn't
    one the line edit recognizes, or verification failed. Nothing was
    written (HTTP 409: the file needs a human)."""


@dataclass(frozen=True)
class ConfigChange:
    kind: str  # "protocol" | "motif"
    target: str  # protocol or motif name
    field: str  # "lambda_p" | "window_seconds"
    old_value: float
    new_value: float


def half_life_hours(lambda_p: float) -> float:
    return math.log(2) / lambda_p / 3600


def validate_lambda_p(lambda_p: float) -> float:
    if not isinstance(lambda_p, (int, float)) or isinstance(lambda_p, bool) or not math.isfinite(lambda_p):
        raise ConfigValidationError("lambda_p must be a finite number")
    if lambda_p <= 0:
        raise ConfigValidationError("lambda_p must be positive (zero or negative would mean edges never decay or grow)")
    if not MIN_LAMBDA_P <= lambda_p <= MAX_LAMBDA_P:
        raise ConfigValidationError(
            f"lambda_p {lambda_p:g} implies a half-life of {half_life_hours(lambda_p):.4g}h; "
            f"must be between {MIN_HALF_LIFE_SECONDS / 60:g} minute and {MAX_HALF_LIFE_SECONDS / 86400:g} days "
            f"(lambda_p {MIN_LAMBDA_P:.3g}..{MAX_LAMBDA_P:.3g})"
        )
    return float(lambda_p)


def validate_window_seconds(window_seconds: int) -> int:
    if isinstance(window_seconds, bool) or not isinstance(window_seconds, int):
        raise ConfigValidationError("window_seconds must be a whole number of seconds")
    if not MIN_WINDOW_SECONDS <= window_seconds <= MAX_WINDOW_SECONDS:
        raise ConfigValidationError(
            f"window_seconds must be between {MIN_WINDOW_SECONDS} (1 minute) and {MAX_WINDOW_SECONDS} (30 days)"
        )
    return window_seconds


def _format_number(value: float) -> str:
    # Plain decimal, matching the files' existing style (0.0000192), never
    # scientific notation -- and still exactly round-trippable by YAML.
    text = f"{value:.12f}".rstrip("0").rstrip(".")
    if float(text) != value:
        text = repr(value)
    return text


def _block_bounds(lines: list[str], section: str, name: str) -> tuple[int, int]:
    """[start, end) line range of `name`'s mapping under top-level `section:`,
    in the files' fixed layout (section at col 0, entries at 2, fields at 4)."""
    try:
        section_at = next(i for i, line in enumerate(lines) if line.rstrip() == f"{section}:")
    except StopIteration:
        raise ConfigWriteError(f"no top-level '{section}:' section found") from None
    entry = re.compile(rf"^  {re.escape(name)}:\s*(#.*)?$")
    start = None
    for i in range(section_at + 1, len(lines)):
        line = lines[i]
        if line.strip() and not line.startswith(" ") and not line.startswith("#"):
            break  # next top-level key -- left the section
        if entry.match(line):
            start = i
            break
    if start is None:
        raise ConfigTargetNotFound(name)
    end = len(lines)
    for i in range(start + 1, len(lines)):
        line = lines[i]
        if line.strip() and not line.startswith("#") and (len(line) - len(line.lstrip())) <= 2:
            end = i
            break
    return start, end


def _replace_field(lines: list[str], start: int, end: int, field: str, value_text: str, comment: str) -> None:
    pattern = re.compile(rf"^(    {re.escape(field)}:\s*)([^#\s]+)(\s*)(#.*)?$")
    for i in range(start + 1, end):
        match = pattern.match(lines[i].rstrip("\r\n"))
        if match:
            newline = lines[i][len(lines[i].rstrip("\r\n")) :]  # keep the file's own line ending
            lines[i] = f"{match.group(1)}{value_text}  # {comment}{newline}"
            return
    raise ConfigWriteError(f"no '{field}:' line in that entry's block (unrecognized layout -- edit by hand)")


def _read_exact(path: Path) -> str:
    # Not `read_text()`: universal-newline decoding would turn CRLF into LF,
    # silently rewriting every line ending of a Windows checkout on write.
    return path.read_bytes().decode("utf-8")


def _utc_now_label() -> str:
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())


class ConfigWriter:
    """One instance per process; a lock serializes concurrent API writes."""

    def __init__(
        self,
        protocols_path: Optional[Path] = None,
        motifs_path: Optional[Path] = None,
        clock: Callable[[], str] = _utc_now_label,
    ) -> None:
        self.protocols_path = Path(protocols_path) if protocols_path else DEFAULT_PROTOCOLS_PATH
        self.motifs_path = Path(motifs_path) if motifs_path else DEFAULT_MOTIFS_PATH
        self._clock = clock
        self._lock = threading.Lock()

    def set_protocol_lambda(self, protocol: str, lambda_p: float, analyst: Optional[str]) -> ConfigChange:
        lambda_p = validate_lambda_p(lambda_p)
        with self._lock:
            text = _read_exact(self.protocols_path)
            before = yaml.safe_load(text) or {}
            current = (before.get("protocols") or {}).get(protocol)
            if current is None:
                raise ConfigTargetNotFound(protocol)
            old = float(current["lambda_p"])
            hours = half_life_hours(lambda_p)

            lines = text.splitlines(keepends=True)
            start, end = _block_bounds(lines, "protocols", protocol)
            note = self._note(analyst, f"was {_format_number(old)}")
            _replace_field(lines, start, end, "lambda_p", _format_number(lambda_p), f"~{hours:.3g}h half-life; {note}")
            has_half_life = "half_life_hours" in current
            if has_half_life:
                _replace_field(lines, start, end, "half_life_hours", _format_number(round(hours, 3)), "derived: ln(2)/lambda_p")
            edited = "".join(lines)

            expected = copy.deepcopy(before)
            expected["protocols"][protocol]["lambda_p"] = lambda_p
            if has_half_life:
                expected["protocols"][protocol]["half_life_hours"] = round(hours, 3)
            self._verify(edited, expected, self.protocols_path, ProtocolDecayRegistry)
            self._write_atomic(self.protocols_path, edited)
        return ConfigChange("protocol", protocol, "lambda_p", old, lambda_p)

    def set_motif_window(self, motif: str, window_seconds: int, analyst: Optional[str]) -> ConfigChange:
        window_seconds = validate_window_seconds(window_seconds)
        with self._lock:
            text = _read_exact(self.motifs_path)
            before = yaml.safe_load(text) or {}
            current = (before.get("motifs") or {}).get(motif)
            if current is None:
                raise ConfigTargetNotFound(motif)
            old = int(current["window_seconds"])

            lines = text.splitlines(keepends=True)
            start, end = _block_bounds(lines, "motifs", motif)
            _replace_field(
                lines, start, end, "window_seconds", str(window_seconds),
                f"{window_seconds / 3600:.3g}h; {self._note(analyst, f'was {old}')}",
            )
            edited = "".join(lines)

            expected = copy.deepcopy(before)
            expected["motifs"][motif]["window_seconds"] = window_seconds
            self._verify(edited, expected, self.motifs_path, MotifRegistry)
            self._write_atomic(self.motifs_path, edited)
        return ConfigChange("motif", motif, "window_seconds", float(old), float(window_seconds))

    def _note(self, analyst: Optional[str], was: str) -> str:
        who = analyst.strip() if analyst and analyst.strip() else "unknown analyst"
        # Keep the comment one line and comment-safe whatever was typed.
        who = re.sub(r"[\r\n#]", " ", who)[:64]
        return f"set via dashboard by {who}, {self._clock()} ({was})"

    @staticmethod
    def _verify(edited: str, expected: dict[str, Any], path: Path, registry_cls: type) -> None:
        try:
            parsed = yaml.safe_load(edited) or {}
        except yaml.YAMLError as exc:
            raise ConfigWriteError(f"edited file no longer parses: {exc}") from exc
        if parsed != expected:
            raise ConfigWriteError("edit would change more than the requested field -- nothing written")
        # Load through the real registry (MotifRegistry also schema-validates),
        # from a temp file beside the original so relative behavior matches.
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.verify-", suffix=".yaml")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
                f.write(edited)
            registry_cls(Path(tmp))
        except Exception as exc:  # noqa: BLE001 -- any loader failure means "don't write"
            raise ConfigWriteError(f"edited file fails to load: {exc}") from exc
        finally:
            Path(tmp).unlink(missing_ok=True)

    @staticmethod
    def _write_atomic(path: Path, content: str) -> None:
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8", newline="") as f:
                f.write(content)
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise


class ConfigFileWatcher:
    """Hot-reload for the pipeline (`scripts/run_pipeline.py`): polls the
    config files' mtimes and, when one changes, re-reads it through the
    registry and hands the new state to `on_reload`. Polling, not inotify --
    portable, dependency-free, and a config edit taking a few seconds to
    land is fine. A file that fails to load is reported and skipped; the
    pipeline keeps running on its last good config."""

    def __init__(
        self,
        protocol_registry: ProtocolDecayRegistry,
        motif_registry: MotifRegistry,
        on_motifs_reloaded: Callable[[MotifRegistry], None],
        protocols_path: Optional[Path] = None,
        motifs_path: Optional[Path] = None,
        log: Callable[[str], None] = print,
    ) -> None:
        self._protocol_registry = protocol_registry
        self._motif_registry = motif_registry
        self._on_motifs_reloaded = on_motifs_reloaded
        self._paths = {
            "protocols": Path(protocols_path) if protocols_path else DEFAULT_PROTOCOLS_PATH,
            "motifs": Path(motifs_path) if motifs_path else DEFAULT_MOTIFS_PATH,
        }
        self._log = log
        self._mtimes = {name: self._mtime(path) for name, path in self._paths.items()}

    @staticmethod
    def _mtime(path: Path) -> Optional[int]:
        try:
            return path.stat().st_mtime_ns
        except OSError:
            return None

    def check(self) -> list[str]:
        """Reload whichever files changed since the last check; returns their names."""
        reloaded = []
        for name, path in self._paths.items():
            mtime = self._mtime(path)
            if mtime is None or mtime == self._mtimes[name]:
                continue
            self._mtimes[name] = mtime
            try:
                if name == "protocols":
                    self._protocol_registry.reload()
                else:
                    self._motif_registry.reload()
                    self._on_motifs_reloaded(self._motif_registry)
            except Exception as exc:  # noqa: BLE001 -- keep running on the last good config
                self._log(f"CONFIG RELOAD FAILED for {path.name}: {exc} -- keeping the previous config")
                continue
            reloaded.append(name)
            self._log(f"CONFIG RELOADED {path.name}")
        return reloaded
