"""Sysmon / Windows Security Event Log ingestion adapter (tasks.md 0.5).

Maps normalized Windows Event Log records (Security channel logon/share
events plus Sysmon channel process/network/file events) onto the shared
typed-edge contract (config/schema/edge.schema.json), per specs.md
FR5.2/FR5.3: every edge is one of Authentication / FileTransfer /
RemoteCodeExecution, tagged with an underlying protocol (RDP/SMB/Kerberos/
DNS) so FR1's per-protocol decay applies uniformly regardless of which
event source produced it.

This adapter expects events already normalized to a flat dict (as most log
shippers -- Winlogbeat, NXLog -- produce), not raw XML. Each raw_event must
carry at least: EventID, Channel, TimeCreated (epoch seconds), Computer.

Design note: the two event families are deliberately combined to reconstruct
both hops of the canonical lateral-movement motif (specs.md 1.1, design.md
2.6):
  - Sysmon EventID 3 (NetworkConnect) yields a Machine -> Machine edge --
    "Machine A authenticates to Machine B" (hop 1).
  - Security 4624/4625/4648/4768/4769 and Sysmon EventID 1 (ProcessCreate)
    yield User -> Machine edges -- "Machine B's admin account -> Machine C"
    (hop 2, auth or RCE).
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from t_gnn.schema import Edge

CHANNEL_SECURITY = "Security"
CHANNEL_SYSMON = "Microsoft-Windows-Sysmon/Operational"

# Sysmon/Security Event IDs this adapter understands, per specs.md FR5.2/FR5.3.
EVENT_ID_LOGON = {4624, 4625, 4648}       # Authentication (interactive/network logon)
EVENT_ID_KERBEROS = {4768, 4769}          # Authentication (TGT/TGS request)
EVENT_ID_SHARE_ACCESS = {5140, 5145}      # FileTransfer (network share object access)
EVENT_ID_PROCESS_CREATE = 1               # RemoteCodeExecution (Sysmon ProcessCreate)
EVENT_ID_NETWORK_CONNECT = 3              # Authentication (Sysmon NetworkConnect)
EVENT_ID_FILE_CREATE = 11                 # FileTransfer (Sysmon FileCreate)

_PORT_PROTOCOL_MAP = {
    3389: "RDP",
    445: "SMB",
    88: "Kerberos",
    53: "DNS",
}

# Remote-exec tooling whose parent process indicates the transport used to
# invoke the child process remotely -- placeholder heuristic for staging;
# refined once real Sysmon telemetry is available (tasks.md 1.7).
_RCE_PARENT_PROTOCOL_HINTS = {
    "psexesvc.exe": "SMB",       # PsExec rides the ADMIN$/IPC$ SMB share
    "wmiprvse.exe": "Kerberos",  # WMI/DCOM authenticates via Kerberos by default
    "wsmprovhost.exe": "Kerberos",  # WinRM/PowerShell remoting
}


class UnsupportedEventError(ValueError):
    """Raised when an event's (Channel, EventID) has no registered mapping."""


def _logon_protocol(fields: dict[str, Any]) -> str:
    if str(fields.get("LogonType")) == "10":  # RemoteInteractive
        return "RDP"
    if fields.get("AuthenticationPackageName") == "Kerberos":
        return "Kerberos"
    return "SMB"  # network/NTLM logon -- closest analogue absent richer data


def _network_connect_protocol(fields: dict[str, Any]) -> str:
    port = fields.get("DestinationPort")
    try:
        return _PORT_PROTOCOL_MAP.get(int(port), "Kerberos")
    except (TypeError, ValueError):
        return "Kerberos"


def _rce_protocol(fields: dict[str, Any]) -> str:
    parent = str(fields.get("ParentImage", "")).rsplit("\\", 1)[-1].lower()
    return _RCE_PARENT_PROTOCOL_HINTS.get(parent, "SMB")


def _share_dst_from_unc(target_filename: str) -> Optional[str]:
    """Extract the server name from a UNC path (\\\\server\\share\\file) if present."""
    parts = target_filename.replace("/", "\\").split("\\")
    parts = [p for p in parts if p]
    return parts[0] if len(parts) >= 2 and target_filename.replace("/", "\\").startswith("\\\\") else None


def _handle_logon(raw: dict[str, Any]) -> Optional[Edge]:
    user = raw.get("TargetUserName")
    computer = raw.get("Computer")
    if not user or not computer:
        return None
    return Edge(
        src=f"User:{user}",
        dst=f"Machine:{computer}",
        edge_type="Authentication",
        protocol=_logon_protocol(raw),
        t_e=float(raw["TimeCreated"]),
        w_0=1.0 if raw.get("EventID") == 4624 else 0.7,
        source_system="sysmon",
        raw_event_id=str(raw.get("EventID")),
    )


def _handle_kerberos(raw: dict[str, Any]) -> Optional[Edge]:
    user = raw.get("TargetUserName")
    computer = raw.get("Computer")
    if not user or not computer:
        return None
    return Edge(
        src=f"User:{user}",
        dst=f"Machine:{computer}",
        edge_type="Authentication",
        protocol="Kerberos",
        t_e=float(raw["TimeCreated"]),
        w_0=1.0,
        source_system="sysmon",
        raw_event_id=str(raw.get("EventID")),
    )


def _handle_share_access(raw: dict[str, Any]) -> Optional[Edge]:
    user = raw.get("SubjectUserName")
    computer = raw.get("Computer")
    if not user or not computer:
        return None
    return Edge(
        src=f"User:{user}",
        dst=f"Machine:{computer}",
        edge_type="FileTransfer",
        protocol="SMB",
        t_e=float(raw["TimeCreated"]),
        w_0=1.0,
        source_system="sysmon",
        raw_event_id=str(raw.get("EventID")),
    )


def _handle_process_create(raw: dict[str, Any]) -> Optional[Edge]:
    user = raw.get("User")
    computer = raw.get("Computer")
    if not user or not computer:
        return None
    return Edge(
        src=f"User:{user}",
        dst=f"Machine:{computer}",
        edge_type="RemoteCodeExecution",
        protocol=_rce_protocol(raw),
        t_e=float(raw["TimeCreated"]),
        w_0=1.0,
        source_system="sysmon",
        raw_event_id=str(raw.get("EventID")),
    )


def _handle_network_connect(raw: dict[str, Any]) -> Optional[Edge]:
    src_computer = raw.get("Computer")
    dst_computer = raw.get("DestinationHostname") or raw.get("DestinationIp")
    if not src_computer or not dst_computer:
        return None
    return Edge(
        src=f"Machine:{src_computer}",
        dst=f"Machine:{dst_computer}",
        edge_type="Authentication",
        protocol=_network_connect_protocol(raw),
        t_e=float(raw["TimeCreated"]),
        w_0=1.0,
        source_system="sysmon",
        raw_event_id=str(raw.get("EventID")),
    )


def _handle_file_create(raw: dict[str, Any]) -> Optional[Edge]:
    src_computer = raw.get("Computer")
    target_filename = raw.get("TargetFilename", "")
    dst_server = _share_dst_from_unc(target_filename)
    if not src_computer or not dst_server:
        return None
    return Edge(
        src=f"Machine:{src_computer}",
        dst=f"Machine:{dst_server}",
        edge_type="FileTransfer",
        protocol="SMB",
        t_e=float(raw["TimeCreated"]),
        w_0=1.0,
        source_system="sysmon",
        raw_event_id=str(raw.get("EventID")),
    )


_HandlerFn = Callable[[dict[str, Any]], Optional[Edge]]
_HANDLERS: dict[tuple[str, int], _HandlerFn] = {}
for _eid in EVENT_ID_LOGON:
    _HANDLERS[(CHANNEL_SECURITY, _eid)] = _handle_logon
for _eid in EVENT_ID_KERBEROS:
    _HANDLERS[(CHANNEL_SECURITY, _eid)] = _handle_kerberos
for _eid in EVENT_ID_SHARE_ACCESS:
    _HANDLERS[(CHANNEL_SECURITY, _eid)] = _handle_share_access
_HANDLERS[(CHANNEL_SYSMON, EVENT_ID_PROCESS_CREATE)] = _handle_process_create
_HANDLERS[(CHANNEL_SYSMON, EVENT_ID_NETWORK_CONNECT)] = _handle_network_connect
_HANDLERS[(CHANNEL_SYSMON, EVENT_ID_FILE_CREATE)] = _handle_file_create


class SysmonEventAdapter:
    """Converts normalized Sysmon/Security event dicts into shared-schema Edges."""

    def supports(self, channel: str, event_id: int) -> bool:
        return (channel, event_id) in _HANDLERS

    def parse(self, raw_event: dict[str, Any]) -> Optional[Edge]:
        """Parse one normalized event dict into an Edge, or None if the
        event is a recognized type but is missing required fields.

        Raises UnsupportedEventError if (Channel, EventID) has no mapping.
        """
        channel = raw_event.get("Channel")
        event_id = raw_event.get("EventID")
        handler = _HANDLERS.get((channel, event_id))
        if handler is None:
            raise UnsupportedEventError(f"no mapping for channel={channel!r} event_id={event_id!r}")
        return handler(raw_event)
