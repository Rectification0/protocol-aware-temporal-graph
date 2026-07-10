import pytest

from t_gnn.ingestion.sysmon_adapter import (
    CHANNEL_SECURITY,
    CHANNEL_SYSMON,
    SysmonEventAdapter,
    UnsupportedEventError,
)


@pytest.fixture
def adapter():
    return SysmonEventAdapter()


def test_security_4624_rdp_logon_maps_to_authentication(adapter):
    raw = {
        "Channel": CHANNEL_SECURITY,
        "EventID": 4624,
        "TimeCreated": 1_700_000_000,
        "Computer": "C2001",
        "TargetUserName": "alice",
        "LogonType": "10",
    }
    edge = adapter.parse(raw)
    assert edge.edge_type == "Authentication"
    assert edge.protocol == "RDP"
    assert edge.src == "User:alice"
    assert edge.dst == "Machine:C2001"


def test_security_4769_kerberos_service_ticket(adapter):
    raw = {
        "Channel": CHANNEL_SECURITY,
        "EventID": 4769,
        "TimeCreated": 1_700_000_100,
        "Computer": "DC01",
        "TargetUserName": "bob",
    }
    edge = adapter.parse(raw)
    assert edge.edge_type == "Authentication"
    assert edge.protocol == "Kerberos"


def test_security_5145_share_access_maps_to_filetransfer_smb(adapter):
    raw = {
        "Channel": CHANNEL_SECURITY,
        "EventID": 5145,
        "TimeCreated": 1_700_000_200,
        "Computer": "FS01",
        "SubjectUserName": "carol",
    }
    edge = adapter.parse(raw)
    assert edge.edge_type == "FileTransfer"
    assert edge.protocol == "SMB"
    assert edge.src == "User:carol"
    assert edge.dst == "Machine:FS01"


def test_sysmon_networkconnect_maps_to_machine_to_machine_auth_hop(adapter):
    raw = {
        "Channel": CHANNEL_SYSMON,
        "EventID": 3,
        "TimeCreated": 1_700_000_300,
        "Computer": "C1042",
        "DestinationHostname": "C2001",
        "DestinationPort": "3389",
    }
    edge = adapter.parse(raw)
    assert edge.edge_type == "Authentication"
    assert edge.protocol == "RDP"
    assert edge.src == "Machine:C1042"
    assert edge.dst == "Machine:C2001"


def test_sysmon_processcreate_maps_to_rce_user_to_machine_hop(adapter):
    raw = {
        "Channel": CHANNEL_SYSMON,
        "EventID": 1,
        "TimeCreated": 1_700_000_400,
        "Computer": "C3007",
        "User": "CORP\\admin_bob",
        "ParentImage": "C:\\Windows\\psexesvc.exe",
    }
    edge = adapter.parse(raw)
    assert edge.edge_type == "RemoteCodeExecution"
    assert edge.protocol == "SMB"
    assert edge.src == "User:CORP\\admin_bob"
    assert edge.dst == "Machine:C3007"


def test_sysmon_filecreate_unc_path_maps_to_filetransfer(adapter):
    raw = {
        "Channel": CHANNEL_SYSMON,
        "EventID": 11,
        "TimeCreated": 1_700_000_500,
        "Computer": "C1042",
        "TargetFilename": "\\\\FS02\\shared\\payload.exe",
    }
    edge = adapter.parse(raw)
    assert edge.edge_type == "FileTransfer"
    assert edge.protocol == "SMB"
    assert edge.dst == "Machine:FS02"


def test_sysmon_filecreate_local_path_is_skipped(adapter):
    raw = {
        "Channel": CHANNEL_SYSMON,
        "EventID": 11,
        "TimeCreated": 1_700_000_600,
        "Computer": "C1042",
        "TargetFilename": "C:\\Users\\alice\\Downloads\\file.txt",
    }
    assert adapter.parse(raw) is None


def test_unsupported_event_id_raises(adapter):
    raw = {"Channel": CHANNEL_SYSMON, "EventID": 999, "TimeCreated": 1, "Computer": "X"}
    with pytest.raises(UnsupportedEventError):
        adapter.parse(raw)


def test_two_hop_canonical_motif_reconstruction(adapter):
    """Sanity check the seed motif (specs.md FR3.1) is representable as two
    edges from this adapter: Machine A -> Machine B, then Machine B's admin
    account -> Machine C."""
    hop1 = adapter.parse(
        {
            "Channel": CHANNEL_SYSMON,
            "EventID": 3,
            "TimeCreated": 1_700_000_000,
            "Computer": "MachineA",
            "DestinationHostname": "MachineB",
            "DestinationPort": "445",
        }
    )
    hop2 = adapter.parse(
        {
            "Channel": CHANNEL_SYSMON,
            "EventID": 1,
            "TimeCreated": 1_700_010_000,
            "Computer": "MachineC",
            "User": "MachineB\\Administrator",
            "ParentImage": "C:\\Windows\\wmiprvse.exe",
        }
    )
    assert hop1.dst == "Machine:MachineB"
    assert hop2.src == "User:MachineB\\Administrator"
    assert hop2.dst == "Machine:MachineC"
