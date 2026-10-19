"""Frontend Backlog FB.1: `config_writer.py` -- comment-preserving, verified,
atomic YAML edits, plus the pipeline's `ConfigFileWatcher` hot reload.
Runs against copies of the real config files, so the line-edit logic is
tested on the actual layout it has to handle."""

from __future__ import annotations

import math
import os
import shutil
from pathlib import Path

import pytest
import yaml

from t_gnn.config_writer import (
    MAX_WINDOW_SECONDS,
    ConfigFileWatcher,
    ConfigTargetNotFound,
    ConfigValidationError,
    ConfigWriteError,
    ConfigWriter,
)
from t_gnn.motifs import MotifRegistry
from t_gnn.protocol_registry import ProtocolDecayRegistry

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture
def paths(tmp_path):
    protocols = tmp_path / "protocols.yaml"
    motifs = tmp_path / "motifs.yaml"
    shutil.copy(REPO / "config" / "protocols.yaml", protocols)
    shutil.copy(REPO / "config" / "motifs.yaml", motifs)
    return protocols, motifs


@pytest.fixture
def writer(paths):
    return ConfigWriter(*paths, clock=lambda: "2026-10-19 12:00 UTC")


def _changed_lines(before: str, after: str) -> list[tuple[str, str]]:
    a, b = before.splitlines(), after.splitlines()
    assert len(a) == len(b), "a value edit must never add or remove lines"
    return [(x, y) for x, y in zip(a, b) if x != y]


def test_protocol_edit_changes_only_its_value_lines_and_keeps_every_comment(writer, paths):
    protocols, _ = paths
    before = protocols.read_text(encoding="utf-8")

    change = writer.set_protocol_lambda("SMB", 0.00002, "alice")

    after = protocols.read_text(encoding="utf-8")
    changed = _changed_lines(before, after)
    assert [old.strip().split(":")[0] for old, _ in changed] == ["lambda_p", "half_life_hours"]
    assert "set via dashboard by alice, 2026-10-19 12:00 UTC (was 0.000004)" in after
    # Every comment line outside the edited lines survives verbatim.
    assert [l for l in before.splitlines() if l.lstrip().startswith("#")] == [
        l for l in after.splitlines() if l.lstrip().startswith("#")
    ]
    assert (change.old_value, change.new_value) == (0.000004, 0.00002)
    registry = ProtocolDecayRegistry(protocols)
    assert registry.lambda_for("SMB") == 0.00002
    assert registry.get("SMB").half_life_hours == pytest.approx(math.log(2) / 0.00002 / 3600, abs=1e-3)
    assert registry.lambda_for("RDP") == 0.0001925  # neighbours untouched


def test_motif_edit_changes_one_line_and_passes_schema_validation(writer, paths):
    _, motifs = paths
    before = motifs.read_text(encoding="utf-8")

    change = writer.set_motif_window("lateral_pivot", 7200, "bob")

    changed = _changed_lines(before, motifs.read_text(encoding="utf-8"))
    assert len(changed) == 1 and changed[0][1].startswith("    window_seconds: 7200  # 2h; set via dashboard by bob")
    assert (change.old_value, change.new_value) == (14400, 7200)
    registry = MotifRegistry(motifs)
    assert registry.get("lateral_pivot").window_seconds == 7200
    assert registry.get("admin_share_escalation").window_seconds == 3600


def test_analyst_name_cannot_break_out_of_the_yaml_comment(writer, paths):
    _, motifs = paths
    writer.set_motif_window("lateral_pivot", 7200, "mallory\nwindow_seconds: 1 # x")

    parsed = yaml.safe_load(motifs.read_text(encoding="utf-8"))
    assert parsed["motifs"]["lateral_pivot"]["window_seconds"] == 7200


def test_preserves_crlf_line_endings(writer, paths):
    _, motifs = paths
    motifs.write_bytes(motifs.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))

    writer.set_motif_window("lateral_pivot", 7200, "bob")

    raw = motifs.read_bytes()
    assert raw.count(b"\n") == raw.count(b"\r\n")


@pytest.mark.parametrize("value", [0, -1e-5, float("nan"), float("inf"), 1.0, 1e-12, True])
def test_rejects_out_of_bounds_lambda(writer, paths, value):
    protocols, _ = paths
    before = protocols.read_bytes()
    with pytest.raises(ConfigValidationError):
        writer.set_protocol_lambda("SMB", value, "alice")
    assert protocols.read_bytes() == before


@pytest.mark.parametrize("value", [0, 59, MAX_WINDOW_SECONDS + 1, 3600.5, True])
def test_rejects_out_of_bounds_window(writer, value):
    with pytest.raises(ConfigValidationError):
        writer.set_motif_window("lateral_pivot", value, "bob")


def test_unknown_targets_are_reported_not_created(writer, paths):
    protocols, motifs = paths
    before = (protocols.read_bytes(), motifs.read_bytes())
    with pytest.raises(ConfigTargetNotFound):
        writer.set_protocol_lambda("FTP", 0.00002, "alice")
    with pytest.raises(ConfigTargetNotFound):
        writer.set_motif_window("no_such_motif", 7200, "bob")
    assert (protocols.read_bytes(), motifs.read_bytes()) == before


def test_unrecognized_layout_aborts_without_writing(writer, paths):
    _, motifs = paths
    # Value on its own continuation line: valid YAML, same data, but not the
    # one-line layout the line edit recognizes -- so it must refuse, not guess.
    text = motifs.read_bytes().decode("utf-8").replace(
        "    window_seconds: 14400  # ~4 hours, per specs.md FR3.1's example bound",
        "    window_seconds:\n      14400",
    )
    motifs.write_bytes(text.encode("utf-8"))
    assert yaml.safe_load(text)["motifs"]["lateral_pivot"]["window_seconds"] == 14400
    before = motifs.read_bytes()

    with pytest.raises(ConfigWriteError):
        writer.set_motif_window("lateral_pivot", 7200, "bob")
    assert motifs.read_bytes() == before


def test_leaves_no_temp_files_behind(writer, paths):
    protocols, _ = paths
    writer.set_protocol_lambda("SMB", 0.00002, "alice")
    with pytest.raises(ConfigValidationError):
        writer.set_protocol_lambda("SMB", -1, "alice")
    assert sorted(p.name for p in protocols.parent.iterdir()) == ["motifs.yaml", "protocols.yaml"]


def _touch_later(path: Path):
    stat = path.stat()
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns + 1_000_000_000))


def test_watcher_hot_reloads_both_registries(writer, paths):
    protocols, motifs = paths
    protocol_registry = ProtocolDecayRegistry(protocols)
    motif_registry = MotifRegistry(motifs)
    pushed = []
    watcher = ConfigFileWatcher(
        protocol_registry, motif_registry, lambda reg: pushed.append(reg.all()),
        protocols_path=protocols, motifs_path=motifs, log=lambda _: None,
    )
    assert watcher.check() == []

    writer.set_protocol_lambda("SMB", 0.00002, "alice")
    writer.set_motif_window("lateral_pivot", 7200, "bob")
    _touch_later(protocols)
    _touch_later(motifs)

    assert sorted(watcher.check()) == ["motifs", "protocols"]
    assert protocol_registry.lambda_for("SMB") == 0.00002
    assert {d.name: d.window_seconds for d in pushed[-1]}["lateral_pivot"] == 7200
    assert watcher.check() == []  # no change since


def test_watcher_keeps_last_good_config_when_a_hand_edit_breaks_the_file(paths):
    protocols, motifs = paths
    protocol_registry = ProtocolDecayRegistry(protocols)
    messages = []
    watcher = ConfigFileWatcher(
        protocol_registry, MotifRegistry(motifs), lambda reg: None,
        protocols_path=protocols, motifs_path=motifs, log=messages.append,
    )
    protocols.write_text("protocols: [this is: not, a mapping", encoding="utf-8")
    _touch_later(protocols)

    assert watcher.check() == []
    assert protocol_registry.lambda_for("SMB") == 0.000004
    assert any("CONFIG RELOAD FAILED" in m for m in messages)
