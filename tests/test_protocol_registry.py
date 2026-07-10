from t_gnn.protocol_registry import ProtocolDecayRegistry


def test_loads_minimum_required_protocol_set():
    registry = ProtocolDecayRegistry()
    for protocol in ("RDP", "SMB", "Kerberos", "DNS"):
        assert protocol in registry.protocols


def test_unknown_protocol_falls_back_to_default():
    registry = ProtocolDecayRegistry()
    cfg = registry.get("Telnet")
    assert cfg.lambda_p == registry._default_lambda  # noqa: SLF001 -- internal check


def test_rdp_decays_faster_than_smb():
    # Sanity check on the placeholder constants (tasks.md 0.3): RDP sessions
    # are short-lived and should decay faster (larger lambda_p) than SMB
    # shares, which are routinely left open far longer.
    registry = ProtocolDecayRegistry()
    assert registry.lambda_for("RDP") > registry.lambda_for("SMB")


def test_kerberos_decays_faster_than_dns():
    registry = ProtocolDecayRegistry()
    assert registry.lambda_for("Kerberos") > registry.lambda_for("DNS")


def test_reload_picks_up_file_changes(tmp_path):
    config_path = tmp_path / "protocols.yaml"
    config_path.write_text(
        "default_lambda_p: 0.001\n"
        "protocols:\n"
        "  RDP:\n"
        "    lambda_p: 0.5\n"
    )
    registry = ProtocolDecayRegistry(config_path=config_path)
    assert registry.lambda_for("RDP") == 0.5

    config_path.write_text(
        "default_lambda_p: 0.001\n"
        "protocols:\n"
        "  RDP:\n"
        "    lambda_p: 0.9\n"
    )
    registry.reload()
    assert registry.lambda_for("RDP") == 0.9
