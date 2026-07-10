# Specification: Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs

## 1. Overview

A real-time threat-detection system for enterprise networks built on Temporal Graph Neural
Networks (T-GNNs) operating over Continuous-Time Dynamic Graphs (CTDGs). The system must
detect low-and-slow, multi-stage attacks (e.g., APT lateral movement) hidden inside billions
of daily benign log events, while keeping inference latency and memory bounded at enterprise
scale.

### 1.1 Origin & Reference Scenario

This system generalizes an originating research concept: detecting APT lateral movement by
building a CTDG from Windows Event Logs/Sysmon telemetry, where nodes are **users and
machines** and edges are **authentication events, file transfers, and remote code
executions**. The canonical example attack pattern is a two-hop timed motif — *Machine A
authenticates to Machine B, and hours later Machine B's admin account authenticates to/queries
Machine C* — which a naive point-in-time detector would miss because each hop looks like
normal IT activity in isolation.

That reference scenario anchors this spec in two ways:
- The generalized protocol set (RDP, SMB, Kerberos, DNS) is the decomposition of the original
  idea's three edge types (authentication, file transfer, remote code execution) into the
  underlying wire protocols that actually determine decay behavior.
- The **LANL Comprehensive Cybersecurity dataset** and Sysmon/Windows Event Logs serve as the
  reference data sources for calibration and validation (see FR5).

## 2. Problem Statement

| # | Problem | Impact |
|---|---------|--------|
| P1 | CTDGs grow unbounded as enterprise logs stream in (billions of events/day). | Memory exhaustion; inference latency degrades as the active graph grows. |
| P2 | Standard T-GNNs apply uniform time-decay to all historical edges. | Protocols behave differently over time (a dangling Kerberos ticket is suspicious after ~10h; an open SMB share can be normal for 48h). Uniform decay produces false positives/negatives. |
| P3 | Recomputing embeddings over the full graph on every new edge is expensive. | High-risk attack patterns ("motifs") are not detected fast enough for real-time response. |

## 3. Goals

- **G1**: Assign protocol-specific temporal decay to every edge so "importance" reflects real protocol behavior, not wall-clock age alone.
- **G2**: Bound the active in-memory graph size via continuous, threshold-based pruning without losing forensic data.
- **G3**: Detect known high-risk topological attack patterns (motifs) via incremental, localized updates rather than full-graph recomputation.
- **G4**: Keep T-GNN inference latency in the sub-millisecond range under enterprise log volume.
- **G5**: Preserve pruned/cold data for post-incident forensic reconstruction.

## 4. Non-Goals

- Replacing the T-GNN model architecture itself (embedding generation, attention mechanism) — this spec addresses the data/graph management layer around it.
- Real-time alert triage/response automation (SOAR integration) — out of scope for this phase.
- Multi-tenant / multi-cluster federation of graphs — assumed single logical enterprise graph per deployment.

## 5. Functional Requirements

### FR1 — Protocol-Aware Asymmetric Time-Decay
- FR1.1: The system SHALL compute edge weight as `w(e, t) = w_0 · e^(-λ_p · (t - t_e))` for every active edge `e`.
- FR1.2: The system SHALL maintain a distinct decay constant `λ_p` per protocol type (minimum supported set: RDP, SMB, Kerberos, DNS).
- FR1.3: Decay constants SHALL be configurable/tunable without redeploying the ingestion pipeline.
- FR1.4: The system SHALL learn and maintain a baseline distribution of `w(e, t)` per user/entity, per protocol, over a rolling window.
- FR1.5: The system SHALL flag statistical deviation of a user/entity's aggregated edge weights from its protocol-decay baseline as an anomaly signal fed into the T-GNN.

### FR2 — Dynamic Graph Pruning
- FR2.1: The system SHALL continuously recompute `w(e, t)` for all active edges as a background process.
- FR2.2: The system SHALL sever any edge from active memory when `w(e, t) < ε`, where `ε` is a dynamically adjustable threshold.
- FR2.3: `ε` SHALL be tunable based on available system memory (i.e., memory-pressure-aware).
- FR2.4: Severed edges SHALL be serialized to cold storage before removal from active memory (no data loss).
- FR2.5: The pruning process SHALL not block or stall T-GNN inference (asynchronous/non-blocking).

### FR3 — Stateful Motif Caching
- FR3.1: The system SHALL maintain a cache of predefined high-risk subgraph patterns ("motifs"). The mechanism SHALL generalize to any operator-defined motif — it is not limited to a fixed pair of patterns. Seed examples used for initial calibration (see FR3.5) include:
  - `User → Service Account → Admin Share`
  - the canonical timed two-hop pattern `Machine A → Machine B (auth), then Machine B's admin account → Machine C (auth/RCE)` within a bounded time window (e.g., ~4 hours)
- FR3.2: On ingestion of a new edge, the system SHALL perform a localized delta-update to check whether the edge advances or completes a cached motif, without traversing the full graph.
- FR3.3: If an edge required to complete a motif is pruned (per FR2) before the motif completes, the corresponding partial-motif state SHALL reset.
- FR3.4: Motif completion SHALL emit a high-confidence alert/signal distinct from the statistical anomaly signal (FR1.5).
- FR3.5: The motif definition set SHALL be extensible and operator-configurable — new motifs addable without code redeploy where feasible. The seed motifs in FR3.1 are starting examples for calibration, not an exhaustive or fixed catalog; the system SHALL be capable of covering arbitrary attacker topologies expressible in the motif definition schema (§7).

### FR4 — Cold Storage & Forensics
- FR4.1: Pruned edges SHALL be queryable from cold storage for post-incident investigation.
- FR4.2: Cold storage records SHALL retain original timestamp, protocol, weight-at-prune-time, and source/destination entities.

### FR5 — Reference Data Model & Validation Dataset
- FR5.1: Node types SHALL include, at minimum, **User** and **Machine/Host** (per the originating reference scenario).
- FR5.2: Edge types SHALL include, at minimum, **Authentication**, **File Transfer**, and **Remote Code Execution**, each of which is tagged with an underlying protocol (RDP, SMB, Kerberos, DNS, ...) so that FR1's protocol-decay mechanism applies uniformly regardless of which edge-type taxonomy an ingestion adapter uses.
- FR5.3: The system SHALL support Windows Event Logs/Sysmon as a first-class production ingestion source, mapping Sysmon event IDs to the edge types in FR5.2.
- FR5.4: The system SHALL support offline replay of the LANL Comprehensive Cybersecurity dataset as a benchmark for initial calibration of `λ_p` values (FR1.7) and validation of motif detection (FR3) prior to production deployment.

## 6. Non-Functional Requirements

- NFR1 (Latency): End-to-end T-GNN inference latency SHALL remain sub-millisecond at target ingestion volume.
- NFR2 (Throughput): The ingestion pipeline SHALL sustain enterprise-scale streaming volume (billions of events/day) without unbounded queue growth.
- NFR3 (Memory Bound): Active in-memory graph size SHALL be bounded by a configurable ceiling, enforced via FR2.
- NFR4 (Availability): Pruning and motif-caching subsystems SHALL degrade gracefully (e.g., fall back to more aggressive pruning) under memory pressure rather than crash.
- NFR5 (Auditability): All prune and motif-reset events SHALL be logged for tuning and audit purposes.

## 7. Key Entities

- **Node**: `(id, type)` where `type ∈ {User, Machine/Host, ...}`.
- **Edge**: `(source, destination, edge_type, protocol, t_e, w_0, w(e,t))` where `edge_type ∈ {Authentication, File Transfer, Remote Code Execution, ...}` and `protocol` is the underlying wire protocol (RDP, SMB, Kerberos, DNS, ...) used to select `λ_p`.
- **Protocol Decay Config**: `(protocol, λ_p)`
- **Motif Definition**: ordered/typed sequence of edge patterns with a completion condition and optional time bound.
- **Motif State**: partial-match progress per candidate entity chain, with last-updated timestamp.
- **Baseline Distribution**: per-entity, per-protocol statistical model of historical `w(e,t)` aggregates.

## 8. Open Questions

- What is the initial motif library (beyond the example `User → Service Account → Admin Share`)?
- How are `λ_p` values initially derived — expert-defined, or learned from historical benign traffic?
- What is the SLA for cold-storage query latency during forensic investigations?
- Is per-protocol `ε` needed, or is a single global memory-driven `ε` sufficient?
