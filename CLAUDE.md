# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Protocol-Aware Asymmetric Decay and Stateful Motif Pruning in CTDGs: a real-time
threat-detection system design for enterprise networks, built on Temporal GNNs
over Continuous-Time Dynamic Graphs. The four planning docs at the repo root are
the source of truth and should be read before implementing any new phase:

- `functionality.txt` — narrative blueprint of the three core mechanisms (decay, pruning, motif caching).
- `specs.md` — functional/non-functional requirements (FR1–FR5, NFR1–NFR5).
- `design.md` — architecture, component responsibilities, failure modes.
- `tasks.md` — phased implementation plan with checkbox status; **check this first** to see what's already implemented before starting new work, and flip checkboxes as tasks complete.

Phase 0 (Foundations), Phase 1 (Protocol-Aware Asymmetric Time-Decay),
Phase 2 (Dynamic Graph Pruning), Phase 3 (Stateful Motif Caching), Phase 4
(Cold Storage & Forensics), Phase 5 (T-GNN Integration), Phase 6
(Observability & Hardening), Phase 7 (Documentation & Rollout), and Phase 8
(Tooling & Documentation Follow-ups) are implemented so far — this is
every phase in `tasks.md`. Phase 1 is
pure-Python/staging (see the Architecture section for what each module
stands in for and why). Phase 2 is a mix: the Active Graph Store and
Pruning Watcher are framework-agnostic Python (no live Flink job), but its
Neo4j cold-storage write path is real — it runs against the actual
`docker-compose.yml` Neo4j instance via the `neo4j` driver, not a
placeholder. Phase 3 is the same kind of mix: the motif definition
schema/registry and the engine's delta-update/reset logic are
framework-agnostic Python (no live Flink edge-ingest job driving
`MotifEngine.on_edge()` yet), but its Redis-backed motif-state store is
real — `RedisMotifStateStore` runs against the actual `docker-compose.yml`
Redis instance via the `redis` driver, with the reset-on-prune wiring
(`MotifEngine.on_prune`) connected live to Phase 2's `PruneEventBus`. Phase
4 is entirely real, no staging split — it's a read-only query layer over
the same live Neo4j data Phase 2 already writes, so there's no framework
(Flink/PyG) dependency to stand in for in the first place. Phase 5 uses a
genuinely real PyTorch Geometric forward pass over the live `ActiveGraphStore`
— nothing about the graph-sourcing/feature-wiring/trigger integration is
staged — but per specs.md §4's explicit non-goal, the model architecture
itself is a deliberately small, untrained reference network, not a
production-trained T-GNN; see the Architecture section. Phase 6 is
framework-agnostic in the same sense Phase 1's decay/baseline logic is —
`MetricsCollector`/`AuditLogger` are the in-process aggregators a real
dashboard/log-shipping pipeline would read from, since no such pipeline is
provisioned in docker-compose.yml — but its hardening changes to
`MotifEngine` (6.3) and its `BufferedColdStorageWriter` (6.4) are real,
load-bearing code paths, not staged. Phase 7's two docs (7.1/7.2) are real,
complete reference material; its pilot harness (7.3, `src/t_gnn/pilot.py`)
is a genuinely working, tested tool, but per that task's own nature the
*pilot itself* — running it against real labeled enterprise traffic and
using the result for a go/no-go rollout call — is an operational step no
phase in this repo can actually perform, the same acquisition gap task
0.4 documents for the underlying LANL dataset.
`docker-compose.yml`'s Flink/Redis/Neo4j stack is running locally (brought
up ahead of schedule, before Phase 2 started, at the developer's request)
— see "Local dev database" below. Phase 8 (Tooling & Documentation
Follow-ups) adds a small real CLI (`src/t_gnn/score_entities.py`) plus a
PowerShell doc fix, both discovered as gaps while using the CLIs Phase 7
shipped — see the Architecture section's Phase 8 bullet. tasks.md's
Backlog section (identified by cross-referencing the code against
functionality.txt/specs.md/design.md/the research proposal doc) has since
had B.3/B.4/B.5 implemented as real, tested extensions to earlier phases'
modules (adaptive lambda_p calibration, fuzzy motif matching, distributed
graph store/motif cache — see the Architecture section's "Backlog
B.3-B.6" bullet); B.1/B.2 (a real Flink job) are deliberately unattempted
due to a Python-version/missing-broker environment gap, and B.7 (real
enterprise-scale NFR validation) remains an operational gap the same way
task 0.4/7.3 are. B.8 (a Mordor/OTRF-Security-Datasets ingestion adapter)
is implemented and tested but deliberately kept off `main` on a separate
`feature/mordor-ingestion` branch — see that branch for its code/docs.
Every phase in `tasks.md` now has code (with 7.3's
operational caveat above); further work is enhancement/extension of what
exists (the remaining Backlog items and Open Questions), not a new phase.

**Separately, the `frontend_implementation` branch (not merged into
`main` — this repo's frontend work lives there, per the developer's
explicit instruction not to commit/merge frontend work to `main`) tracks a
new React SOC dashboard**, planned across Milestones F0-F17 in `tasks.md`'s
"Frontend Implementation — React SOC Dashboard" section (that section only
exists on this branch). Milestone F0 (the backend API layer the dashboard
needs — this repo previously exposed its functionality only as a Python
library plus CLIs, with no HTTP surface at all) is implemented: F0.1-F0.10,
F0.15 are real, tested code (F0.8's audit-log endpoint and F0.10's SSE
live-stream channel — the two tasks not marked `[BACKEND TODO]` — were
added in a later pass; see the Architecture section addendum below). A new
`GET /api/pilot/latest-report` endpoint and optional `start`/`end`
query-param support on `/api/scores/entities`/`/api/motifs/completions`
were added in a still-later pass while building Milestone F8's F8.1/F8.4
— see that milestone's own status paragraph below and its Architecture
addendum for detail; not re-described here. A new `GET /api/entities`
endpoint, a point-lookup `GET /api/scores/entities/{entity_id}`, and an
optional `chain_key` filter on `/api/motifs/completions` were added in a
yet-later pass while building Milestone F10 — see that milestone's own
status paragraph and Architecture addendum.
F0.11 (real login) is deliberately deferred in favor of the frontend's
mock-auth bypass (tasks.md F3.4) — that one, unlike F0.8/F0.10, *is*
marked `[BACKEND TODO]` in tasks.md, since it needs a real product
decision (who are "users," what do they authenticate against) before
code can follow. F0.12-F0.14 remain unstarted for the same
`[BACKEND TODO]` reason — they're backend-data-model gaps with no
existing concept to build against at all (a company-security-score
formula, IP/device/session-history fields, geographic data) and are
flagged rather than fabricated, per this task's own "don't invent
endpoints that don't exist" instruction. See this branch's Architecture
section addendum below for the technical detail, and `tasks.md`'s F0
entries for the per-task status/reasoning in full.

Milestone F1 (Project Setup — the actual `frontend/` app, scaffolded on top
of F0's API) is fully implemented: F1.1-F1.7 are all real, verified code
(builds, lints, formats, and tests clean; see the Architecture section
addendum below). Stack decisions made in this pass: Recharts (charting,
F1.4/F12) and Zustand (client state, F1.4) installed but not yet wired
into any component, since no real feature needs them before F5/F12 land —
building example usage now would just be thrown away later. TanStack
Query (F1.5), by contrast, *is* wired (a `QueryClientProvider` already
wraps the app in `main.tsx`), since F4's hooks need that provider to
already exist, not just the dependency installed.

Milestone F2 (Routing & App Shell) is fully implemented: F2.1-F2.5 are all
real, verified code, and F5.1/F5.2 (Navbar/Sidebar) were pulled forward
into this pass since F2.2 has a hard dependency on both and neither had
any unmet dependency of its own (F1.4 only). See the Architecture section
addendum below for the routing/shell structure and the react-router
`npm audit` finding (an RSC-mode-only advisory that doesn't apply to this
app's plain client-side data router — kept the current version rather
than downgrading for an inapplicable vulnerability class).

Milestone F3 (Authentication) is implemented to the extent F0.11's absence
allows: F3.1/F3.3/F3.4 are real, verified code. F3.2 was initially marked
`[~]` (partial) — its route-guarding half was real, but its "redirect on a
401 from the API client" half was genuinely blocked on Milestone F4 (the
API client didn't exist yet to attach an interceptor to). F4 landing (see
below) closed that gap, so F3.2 is now `[x]` too — the interceptor exists
and is tested, though still practically unexercised, since no endpoint
returns 401 until F0.11 defines real auth. Per this milestone's own
instruction ("do not build a real credential store client-side"), there is
no password field or credential store anywhere in the frontend — login is
a free-text analyst name only, mirroring the backend's existing mock-auth
convention. See the Architecture section addendum below for the auth
store/session shape and what's explicitly left for F0.11 to finalize.

Milestone F4 (API Integration Layer) is fully implemented: F4.1-F4.6 are
all real, verified code (typecheck/lint/format/test/build all pass clean).
Decided: a hand-written typed client (`frontend/src/types/api.ts` +
`src/api/client.ts` + `src/api/endpoints.ts`) rather than OpenAPI codegen
from F0.15's schema — the backend surface is 9 small routers that change
rarely, so a generated client would add a build-time dependency without
buying much over a small, explicit, hand-kept-in-sync mirror (the same
tradeoff `schemas.py` itself already makes relative to the dataclasses it
mirrors); revisit if the surface grows enough that drift becomes a real
risk. `src/hooks/api/` has one TanStack Query hook per F0 endpoint (the
seven tasks.md names plus five more covering the rest of F0's surface),
each with a `staleTime`/`refetchInterval` matched to that data's real
update cadence. `src/api/queryClient.ts` centralizes retry policy (5xx/
network-only, capped at 3 attempts; mutations never auto-retry) and error
handling (toast on a query's first failure; force logout + redirect on
401 — the piece that closed out F3.2 above). `src/hooks/api/pagination.ts`
bridges F0.15's offset/limit envelope to F5.4's `DataTable`, including a
fallback page-count estimate for the several endpoints whose envelope
omits `total`. `src/api/liveStream.ts`'s `LiveStreamManager`/
`useLiveStream()` (backed by a new `src/store/liveStreamStore.ts` Zustand
store) is a hand-rolled reconnect-with-backoff SSE client for F0.10's
stream, deliberately not relying on native `EventSource` auto-reconnect;
each event both lands in the live-event store and invalidates the
matching query key. Like F1.4's Recharts/Zustand, F4.6 is built and
tested but not yet mounted in any page — Milestone F13 (Live Monitoring)
is what wires it in. See the Architecture section addendum below for
file-by-file detail.

While landing F4, Milestone F5 (Reusable UI Component Library) was found
already fully implemented in the working tree — F5.3-F5.14 (F5.1/F5.2 were
already `[x]`, pulled forward into F2) all existed as real, tested
components (`frontend/src/components/{stat-card,data-table,charts,
filter-bar,search-bar,date-range-picker,confirm-dialog,alert-banner,toast,
skeletons,empty-state,severity-badge}.tsx` plus the shadcn `ui/` primitives
they're built on), each already commented with its own `tasks.md` F5.x
reference and written anticipating F4's not-yet-built conventions (a
`loading` prop matching F4's fetch-in-flight state, pagination props
shaped for F4.5's hooks). This pass didn't author any of it — just
verified each file against its task description, confirmed the full
`npm run lint`/`format:check`/`test`/`build` chain still passes, and
flipped tasks.md's checkboxes, since leaving genuinely-done work unmarked
would contradict this file's own "flip checkboxes as tasks complete"
instruction. Whoever built F5 evidently used the same "pull forward a
dependency-satisfied task early" judgment call F2 already documented for
F5.1/F5.2, just for the rest of F5 at once, without updating tasks.md/
CLAUDE.md at the time — worth keeping in mind that the working tree can
race ahead of these docs.

Milestone F6 (Executive Dashboard) is fully implemented: F6.1-F6.7 are all
real, verified code. `frontend/src/pages/HomePage.tsx` is a responsive
grid of six independently-data-fetching tiles under a new
`frontend/src/features/dashboard/` folder (the "feature-scoped components"
directory F1.6 reserved for exactly this). F6.1 (cybersecurity score)
stays behind F5.13/F5.3's empty-state pattern since F0.12 doesn't exist.
F6.2 (security level) and F6.5 (active monitoring) both use the
"interim proxy" tasks.md itself allows in F6.2's line — thresholded real
metrics (`motif_hit_rate_per_second`, `last_metrics_snapshot_age_seconds`)
plus, for F6.2 only, the magnitude of the single highest-|score| entity —
with the threshold constants documented in `logic.ts` as illustrative, not
calibrated, pending F0.12. F6.6 (last analysis timestamp) turned out to
need a decision neither of tasks.md's two named options directly
supported: `MetricsSnapshotOut` carries no timestamp field at all, and
`InferenceResult.t` is only available sorted by score, not by time — so
it's derived from `/api/health`'s `last_metrics_snapshot_age_seconds`
instead (documented in tasks.md's F6.6 line). Landing F6.7 also surfaced
and fixed an unrelated router flake: a data router with `lazy` routes (F2.3)
renders nothing during initial hydration without a `HydrateFallback`,
which only became visible once `HomePage`'s chunk grew heavy enough to
occasionally miss a test's default 1s async timeout — fixed with a shared
`RouteHydrateFallback` component plus a suite-wide timeout bump, not
specific to F6's own tiles. See the Architecture section addendum below
for file-by-file detail.

Milestone F7 (Threat Analytics) is fully implemented: F7.1-F7.4 are all
real, verified code, assembled onto `frontend/src/pages/AnalyticsPage.tsx`
(previously a placeholder pointing at Milestone F12) under a new
`frontend/src/features/analytics/` folder -- the same
pure-logic-plus-components split F6 established for `features/dashboard/`.
F7.1 (user threat-tier counts) resolves tasks.md's own `[BACKEND TODO]`
-style backing gap the same way F6.2 did: bucket by score threshold,
reusing F6.2's exact interim-proxy magnitude constants under new tier
names rather than inventing a second set of unreviewed thresholds, and
documenting in the UI itself (not just code comments) that the buckets
are provisional -- tasks.md's F7.1 line is explicit that this must never
read as ground truth. F7.2 (threat trends) and F7.3 (severity
distribution) both sample from the same `useEntityScores` top-500-by-
`|score|` page F7.1 already fetches (`scores.py` caps `limit` at 500) --
not literally every entity ever seen, an honest sampling caveat documented
in `logic.ts` rather than glossed over. F7.4 (live attack counter) is
notable as F4.6's *first* real mount of `useLiveStream()` -- ahead of
Milestone F13's broader "wire every F6/F7/F9 tile up to the live stream"
pass, because tasks.md's own F7.4 line names F4.6 as this one tile's
direct dependency rather than a polling fallback. Landing F7.4 surfaced
two test-infra gaps once a real page could actually mount the SSE client
outside of `liveStream.test.ts`'s own hand-injected fake: jsdom has no
`EventSource` at all (fixed with a no-op global stub in
`frontend/src/test/setup.ts`), and Vitest's default per-test timeout
(5000ms) exactly matched `setup.ts`'s `asyncUtilTimeout` (also 5000ms),
a latent race that more test files landing (this milestone's) made
visible more often -- fixed by raising `vite.config.ts`'s `testTimeout`
comfortably above it, the same "found and fixed an unrelated flake while
landing this milestone" situation F6.7 documented above. See the
Architecture section addendum below for file-by-file detail.

Milestone F8 (Time-Based Analytics) is fully implemented: F8.1-F8.5 are
all real, verified code, still on `AnalyticsPage.tsx` (F7's page --
Time-Based Analytics doesn't get its own route). F8.1 (the shared
time-range filter) required a genuine backend change, not just frontend
plumbing: `/api/scores/entities` and `/api/motifs/completions` gained
optional `start`/`end` query params (`src/t_gnn/api_state.py`'s
`list_entity_scores`/`list_motif_completions` plus new
`count_entity_scores`/`count_motif_completions` companions), with the
response envelope's `total` computed via an exact `COUNT(*)` whenever
either bound is supplied -- still `null` for an unfiltered request, so
F6/F7's original unfiltered call sites are unaffected. `frontend/src/store/
timeRangeStore.ts` (Zustand, like `authStore`/`liveStreamStore`) holds the
selected range; F7.1-F7.3's tiles were updated to read it (F7.2's trend
chart in particular was generalized from a fixed 24-hourly-bucket window
to a fixed *bucket count* spread evenly across whatever range is
selected -- tasks.md's own F8.1 line names F7's hooks as in-scope, not
just F9/F11's not-yet-built ones). F8.4's "detection rate" needed a
second real backend addition: tasks.md's own line allowed either reusing
F0.9 or adding a new endpoint, and a new one was the right call since
F0.9's registries have nothing to do with pilot evaluation results --
`GET /api/pilot/latest-report` reads whatever file `pilot.py --output`
was pointed at and returns it plus the file's mtime as `evaluated_at`, so
the frontend can honestly label the metric "as of last pilot evaluation,"
not live, per that task's explicit instruction. Landing F8.1 surfaced one
more instance of this branch's recurring test-infra flake (F6.7 and F7
each already fixed one root cause of the same symptom): `router.test.tsx`'s
unauthenticated `/analytics` case still has to resolve that route's
`lazy` module during navigation matching even though `ProtectedRoute`
redirects before rendering it, and `AnalyticsPage`'s dependency graph
(Recharts + `react-day-picker` + nine feature components) grew heavy
enough that the *previous* fix's 10000ms `testTimeout` bump stopped being
enough. This time the actual bottleneck was correctly identified as
`setup.ts`'s `asyncUtilTimeout` itself (a different knob than
`testTimeout` -- the outer per-test safety net was never the binding
constraint, which is why raising it alone didn't help): raised from
5000ms to 20000ms, with `testTimeout` raised again to 25000ms just to
stay comfortably above it. See the Architecture section addendum below
for file-by-file detail.

Milestone F9 (Detection Matrix) is fully implemented: F9.1-F9.6 are all
real, verified code, on a new `frontend/src/pages/DetectionsPage.tsx`
(previously a placeholder) backed by a new `src/features/detections/`
folder. Both detection paths tasks.md's F9.3 line asks for are real: F0.4
motif completions and F0.3 entity scores filtered to `trigger ===
"scheduled"` (excluding the `motif_completion`-triggered rescoring a
completion already accounts for) past the same non-benign magnitude bar
F7.1/F8.2 already use. Severity (F9.1/F5.14's 5-tier vocabulary) is a new
provisional derivation -- motif-path confidence maps to a severity floor
of "medium" (a structural pattern match is never treated as low-severity,
even a low-confidence fuzzy one), and anomaly-path magnitude reuses F6.2/
F7.1's exact `elevated`/`critical` anchors interpolated into 4 steps, with
the "worth listing at all" cutoff deliberately lined up with F7.1's
existing "non-benign" bar so the two pages' notions of severity don't
silently disagree. F9.5's false-positive marker turned out to be
unblocked already, not still gated on F0.11: the backend's own note
already allows the mock-auth `analyst` identity as the attribution, so
this shipped as a real, working feature (TP/FP buttons calling F4's
existing `useSubmitMotifFeedback()`) rather than staying `[~]` partial --
scoped honestly to motif-path rows only, since `motif_feedback` has no
equivalent shape for the anomaly path. Investigation status has no
backing concept anywhere in this repo (F5.14's own note already says so),
so it's a static, honestly-non-persisted badge, not a fabricated one.
F9.6's filtering reuses F5.6's generic `FilterBar` chip display; sorting
is F5.4's already-generic `DataTable` column sort, needing no new code.
See the Architecture section addendum below for file-by-file detail.

Milestone F10 (User Investigation) is fully implemented: F10.1-F10.9 are
all real, verified code, across a new `frontend/src/pages/UserListPage.tsx`
(F10.1) and a rebuilt `frontend/src/pages/InvestigationPage.tsx` (F10.2-
F10.9), backed by a new `src/features/investigation/` folder. F10.1
needed a real backend addition, since this process never holds a live
`ActiveGraphStore` (F0's decoupled-process architecture) -- the only
option tasks.md's own line actually leaves available is the Neo4j one,
implemented as a new `GET /api/entities` endpoint. That same "only Neo4j,
not the live graph" constraint means the user list is honestly a
cold-storage view (an entity with only currently-active edges hasn't been
pruned yet and won't appear), documented in both the router and the
page's own copy. F10.2 required extending F2.1's route table -- `/investigation`
(no `:entityId`) is a new sibling route for the list page, added to
`NAV_ROUTES` as a real static nav destination alongside the existing
`:entityId` detail route (which stays deliberately excluded, per F2.1's
own reasoning). F10.3 and F10.5 each needed a small, real backend
addition of their own (a point-lookup score endpoint and a `chain_key`
filter) rather than searching within an existing paginated sample that
could miss the entity in question. F10.4/F10.6 are deliberately the exact
same panel, not two -- tasks.md's own F10.6 line forbids implying a
second data source that doesn't exist. F10.5 is deliberately motif
completions only, not a second "deviation signals" list, since
`entity_scores`'s upserted/latest-value-only shape (this file's F0 notes)
means there is no historical list of past deviation events to show, only
the single latest score F10.3 already displays. F10.7-F10.9 are
`BackendPendingState` panels naming F0.13 -- F10.9 in particular declines
to build any derived-session heuristic, since that line explicitly
forbids fabricating session boundaries without a real product decision.
See the Architecture section addendum below for file-by-file detail.

Milestone F11 (Log Explorer) is fully implemented: F11.1-F11.7 are all
real, verified code, on a rebuilt `frontend/src/pages/LogsPage.tsx`
(previously a placeholder) backed by a new `src/features/logs/` folder.
F11.1 and F11.2 both needed real backend additions to `src/t_gnn/audit.py`'s
`read_records()` (and the matching `/api/audit/log` query params): `q`
(a case-insensitive freetext substring scan across every field on a
record, via a new `_record_matches_query()`) for search, and `until`/
`entity` (paired with the existing `since`, matching F8.1's bound-naming
convention and F10.5's chain_key-filter precedent) for filtering --
`read_records()` already did a full file scan per request (its own
docstring), so extending that same scan cost nothing new. F11.2's
time-range half deliberately reuses F8.1's shared `useTimeRangeStore`/
`TimeRangeFilter` unchanged rather than a second store, since F8.1's own
line already named F11 as a future consumer. F11.3's `RawLogDialog`
renders the literal record via `JSON.stringify`, not a re-derived view.
F11.4's severity derivation (`features/logs/logic.ts`'s
`classifyLogSeverity()`) floors every motif-reset record at "medium" (a
discarded partial detection chain is never routine housekeeping, the same
floor-logic shape F9 uses for motif completions) and derives a prune
record's severity from `w_at_prune` (illustrative thresholds, undocumented
as calibrated, same posture as every other provisional severity scheme in
this repo) -- pruned while still highly weighted implies a memory-pressure
eviction cutting off still-relevant history, not an edge that simply
finished decaying naturally. F11.5's CSV/JSON export is deliberately
scoped to the current fetched page, not every page of the filtered
result -- exporting the full filtered set would require re-fetching every
page just for a download, and the page's own caption says so rather than
silently under-exporting. F11.6 needed no new work: `audit.py`'s envelope
already returns an exact `total`, so `useAuditLog` (F4.2) already produced
an exact `pageCount` for F5.4's `DataTable`. F11.7 is the milestone's one
genuine architectural wrinkle: its "no silent reordering" requirement is
incompatible with two pieces of already-existing default behavior, both
changed for this page specifically rather than globally -- `useAuditLog`
gained a `refetchInterval` override (`LogsPage.tsx` passes `false`, opting
out of F4.2's normal 10s polling refresh) and `liveStream.ts`'s `prune`
SSE handler no longer invalidates the `['audit','log']` query key at all
(that key has no other consumer, so the auto-refetch-on-invalidate
convention every other F4.6 event type uses was actively wrong for this
one page's acceptance criteria). Instead, `LogsPage.tsx` reads new
prune/motif-reset events directly from `useLiveStreamStore`'s event feed
-- a stream `motif_reset` event carries `MotifResetOut` (Postgres-sourced),
not the audit log's own `AuditRecordOut` shape (file-sourced), so
`logic.ts`'s `motifResetEventToAuditRecord()` adapts one into the other --
filters them against the page's currently active search/type/entity/range
criteria (`matchesLogFilters()`), and renders any not already on the
fetched page prepended with a per-row "New" pill plus a dismissible
"N new events -- Refresh" banner that triggers an explicit page-0 refetch,
rather than ever silently invalidating the visible page out from under the
analyst. See the Architecture section addendum below for file-by-file
detail.

Milestone F12 (Analytics Visualizations) is fully implemented: F12.1-F12.8
are all done, though only five of the eight needed new code. F12.1
(threat timeline), F12.2 (attacks-per-day), and F12.4 (severity pie
chart) needed no new component at all -- each one's own tasks.md line
names an F7 dependency (`ThreatTrendsChart`/F7.2, `ThreatSeverityChart`/
F7.3) that already *is* the chart being asked for, already live on this
same `AnalyticsPage.tsx`. Building a second, near-duplicate chart over
the same underlying data would contradict this repo's established "reuse
and document, don't duplicate" posture (the same judgment call F9.6/
F11.6 already made for filter/pagination reuse) -- so these three are
marked done via a documentation note in `tasks.md` and `AnalyticsPage.tsx`'s
own comment, not new files. The remaining five (F12.3/F12.5/F12.6/F12.7/
F12.8) are real, verified new components in `frontend/src/features/analytics/`,
assembled into a new "Visualizations" section at the bottom of
`AnalyticsPage.tsx`. No backend changes were needed this milestone -- F0.3/
F0.4/F8.4's endpoints already carried everything these five charts needed.
See the Architecture section addendum below for file-by-file detail.

## End-of-phase / end-of-milestone checklist

When every checkbox in a `tasks.md` phase (Phase 0-8, Backlog items) **or
a frontend Milestone (F0-F17, on the `frontend_implementation` branch)** is
flipped to done, before moving on:

1. **Update this file.** Revise the "only Phase N is implemented" line (or,
   on `frontend_implementation`, the frontend-status paragraph above) to
   reflect what's newly done and why anything adjacent was deliberately
   skipped, extend the Architecture section with whatever new load-bearing
   abstractions/conventions that phase/milestone introduced, and add any
   new commands. Keep it a living doc, not a snapshot of whichever phase
   was current when it was last touched.
2. **Update `README.md` and any other non-planning docs** that describe
   current implementation status, layout, or setup/dev-environment
   instructions (e.g. a `docs/` folder, if one shows up later). These drift
   stale independently of this file — updating CLAUDE.md does not cover
   them. This explicitly excludes `functionality.txt`, `specs.md`,
   `design.md`, and `tasks.md`: the first three are the fixed
   planning/source-of-truth docs (requirements/architecture as designed,
   not implementation snapshots to rewrite as phases land), and `tasks.md`
   already has its own status-tracking mechanism (flip its checkboxes as
   tasks complete, per the Project section above) rather than needing prose
   updates here.
3. **Re-check `.gitignore`.** Scan for anything the phase's/milestone's
   work generates that isn't already covered — new build/cache artifacts
   (e.g. a new toolchain's equivalent of `*.egg-info/`; a frontend
   milestone landing `frontend/` will eventually need its own
   `node_modules/`/`dist/`/build-cache entries), new local data/output
   directories, new env/credential files — and add entries before
   committing. Do this even when the diff looks small; it's cheap and the
   failure mode (a secret or a multi-hundred-MB directory landing in a
   commit) isn't.
4. **Include all of the above in the phase's/milestone's commit(s).** These
   doc/config updates land in the same commit(s) as the phase's/milestone's
   code, not a follow-up commit — so `git log` never shows a phase or
   milestone "done" with its docs still pointing at the previous state.
5. **Ask the developer before committing or pushing.** Finishing a phase's/
   milestone's code and docs (1-3 above) does not itself mean "create the
   commit(s)" or "push branch" — those are separate, explicit asks. Once the
   work described above is ready, stop and summarize what would be
   committed (files changed, proposed commit message(s), target branch) and
   wait for the developer's go-ahead before running `git commit`/`git push`.
   This applies even though step 4 says the doc/config updates belong in
   the same commit as the code — that's guidance for *what* to bundle
   together whenever a commit does happen, not a standing authorization to
   commit automatically at the end of a phase/milestone.

## Commands

```bash
pip install -e ".[dev]"                 # install package + pytest
pytest                                   # run full test suite
pytest tests/test_schema.py              # run one test file
pytest tests/test_schema.py::test_round_trip_json   # run one test
python scripts/init_postgres.py          # idempotent: create the t_gnn_dev database
python -m t_gnn.data.stage_lanl --input <auth.txt.gz> --output <dir>   # stage LANL dataset
python -m t_gnn.data.calibrate_decay --staged-dir <dir> [--output report.json]   # suggest lambda_p per protocol from staged edges
python -m t_gnn.data.simulate_traffic --output-dir <dir> [--num-users 200] [--num-machines 50] [--days 7] [--seed 42]   # generate synthetic labeled traffic for pilot.py
python -m t_gnn.pilot --staged-dir <dir> --redteam <redteam.txt> [--z-threshold 3.0] [--output report.json]   # false-positive/negative rates vs. labeled ground truth
python -m t_gnn.score_entities --staged-dir <dir> [--top 20] [--output scores.json]   # replay staged edges and print live T-GNN per-entity scores
docker compose up -d                     # bring up Flink/Redis/Neo4j (needed for the Neo4j and Redis integration tests)
```

There is no lint/format/build step configured for the Python backend.
`frontend_implementation` branch only: the `frontend/` app has its own
lint/format/build/test commands (`npm run lint`/`format`/`build`/`test`)
-- see `frontend/README.md`'s Commands section, not this one.

`python -m t_gnn.data.stage_mordor` (Backlog B.8, stages an OTRF/Security-Datasets
"Mordor" capture) lives on the separate `feature/mordor-ingestion` branch, not on
`main` — see that branch's `CLAUDE.md`/`docs/cli-reference.md` for its command
and flags. Kept off `main` at the developer's request rather than merged in.

## Local dev database — read before adding any persistence code

`docker-compose.yml`'s Flink/Redis/Neo4j stack (`docker compose up -d`) is
now running for local dev: Flink UI on `localhost:8081`, Neo4j on
`localhost:7474`/`7687`, Redis on `localhost:6379` — verified reachable.
It was brought up ahead of its originally-planned trigger point (Phase 3's
Redis TTL semantics / Phase 4's Neo4j) at the developer's explicit request,
so it's available from the start of Phase 2. New persistence work that maps
to one of these systems' actual role in `design.md` — cold-storage edge
writes to Neo4j (2.4), motif state in Redis (3.3) — should target that
system directly now, not Postgres.

Separately, a Postgres instance the developer runs locally (`localhost:5432`,
database `t_gnn_dev`) is still reachable via `src/t_gnn/db.py`
(`get_connection()`). It was the temporary redirect for persistence work
before this stack existed; nothing has ever actually been written through it
(`scripts/init_postgres.py` only creates the empty database — no tables
exist yet), so nothing needs migrating. Keep using it only for persistence
needs that *don't* map to Flink/Redis/Neo4j's roles in `design.md`; create
tables only when a task actually needs them.

Tests that need the live Neo4j instance (`tests/test_cold_storage.py`'s
`Neo4jColdStorageWriter` tests, `tests/test_forensics.py`'s
`Neo4jForensicQueryAPI` tests) or the live Redis instance
(`tests/test_motif_engine.py`'s `RedisMotifStateStore` tests) check
connectivity at collection time and `skip` (not fail) if
`docker compose up -d` hasn't been run — the rest of the suite doesn't
depend on the stack being up.

Connection settings load from `.env` (auto-loaded by `t_gnn/db.py`, gitignored,
holds real credentials) with `.env.example` as the committed placeholder
template — never put real credentials in `.env.example` or any tracked file.

## Architecture

**The shared edge contract is the load-bearing abstraction.** Every
component described in `design.md` (Flink ingestion, the PyG Active Graph
Store, the Redis motif cache, Neo4j cold storage) is meant to operate on the
same edge shape. That contract has two synchronized representations that
must be kept in lockstep when changed:

- `config/schema/edge.schema.json` — the language-agnostic JSON Schema definition (authoritative for the field set/types/enums).
- `src/t_gnn/schema.py` (`Edge` dataclass) — the Python implementation, with `.validate()` checking an instance against the JSON Schema, `to_json`/`from_json` for round-tripping, and `make_edge_id()` for the deterministic id used as the Redis/Neo4j/graph-store key.

Node ids are strings of the form `"<Type>:<name>"` (e.g. `"User:alice"`,
`"Machine:C1042"`); `Edge.__post_init__` infers `src_type`/`dst_type` from
that prefix. Edge type is one of `Authentication` / `FileTransfer` /
`RemoteCodeExecution` (specs.md FR5.2); protocol is one of `RDP` / `SMB` /
`Kerberos` / `DNS` (specs.md FR1.2) and selects the decay constant.

**Protocol decay constants** live in `config/protocols.yaml` and are loaded
through `src/t_gnn/protocol_registry.py` (`ProtocolDecayRegistry`). This is
explicitly a placeholder/staging-era loader — `design.md` §2.2 calls for
these values to eventually live in Flink broadcast state for true hot-reload
without redeploy (tasks.md 1.1/1.2); don't conflate the two until that phase
is implemented.

**Phase 1's decay/baseline/deviation logic is framework-agnostic Python,
staged the same way** — each module below is the business logic a real
Flink job's operators will call once one exists; none of it depends on a
running Flink cluster today:

- `src/t_gnn/decay.py` (`compute_weight()`, `DecayEngine`) — FR1.1/1.3: `w(e,t) = w_0 · e^(-λ_p·(t-t_e))`, with elapsed time clamped to zero rather than letting `t < t_e` amplify weight above `w_0`. `DecayEngine.refresh(edge, t)` returns a *new* `Edge` (via `dataclasses.replace`) with `w`/`w_evaluated_at` set — it never mutates the input edge.
- `src/t_gnn/baseline.py` (`EWMABaseline`, `BaselineStore`, `DeviationSignal`) — FR1.4/1.5: an exponentially-weighted mean/variance profile keyed by `(entity, protocol)`, where `entity` is taken as `edge.src` (the acting principal, per `functionality.txt`'s "aggregated edge weights for a specific user"). `BaselineStore` is an in-memory dict standing in for Flink keyed state (design.md §2.3). `z_score` is computed against the baseline *before* the new observation is folded in (so an outlier is scored against unpolluted history), and is `None` until at least 2 prior samples with nonzero variance exist — avoids a misleading always-zero/divide-by-zero score early in a key's life.
- `src/t_gnn/streaming.py` (`DecayStreamProcessor`) — ties `DecayEngine` + `BaselineStore` into the single per-edge step described in design.md §3 ("Data Flow") steps 2–4: refresh `w(e,t)`, then feed it to the entity/protocol baseline to get a `DeviationSignal`. This is the shape a Flink `ProcessFunction` will wrap per edge.
- `src/t_gnn/data/calibrate_decay.py` (`calibrate()`) — tasks.md 1.7: derives a suggested `λ_p` per protocol from the median same-entity consecutive-edge time gap in staged LANL edges (`stage_lanl.py` output), but only *reports* a suggestion when a protocol clears `min_samples`; below that it flags `sufficient_data=False` and defers to the protocol's current registry value, per tasks.md 1.7's explicit "expert defaults if neither [dataset nor telemetry] is available" allowance. Only the tiny synthetic fixture is vendored — running this against it is a smoke test of the mechanism, not a real calibration.

**Phase 2's dynamic graph pruning is a mix of framework-agnostic Python and
one real infra integration** — the Active Graph Store and Pruning Watcher
don't depend on a live Flink job, but the cold-storage write path is genuine
(Neo4j is up):

- `src/t_gnn/graph_store.py` (`ActiveGraphStore`) — FR2/NFR3: a hash map of `edge_id -> Edge` plus per-node outgoing/incoming adjacency sets (design.md 2.4's `TemporalEdgeStore`), guarded by a single `RLock` held only for the duration of each dict/set mutation. `to_pyg_edge_index()` materializes the *current* live state fresh on every call into a `torch.LongTensor` edge_index (shape `[2, E]`) plus the column-aligned edge id list and node-id-to-index map — Phase 5's customized T-GNN forward pass is the intended caller; Phase 2 itself does no message-passing.
- `src/t_gnn/pruning.py` (`EpsilonController`, `PruneEventBus`/`PrunedEdgeEvent`, `PruningWatcher`) — FR2.2/2.3/2.5: `EpsilonController.compute_epsilon()` takes the *max* of real system-memory pressure (via `psutil`, `default_memory_probe()`) and graph-size pressure vs. a configurable `max_edges` ceiling, then interpolates between `epsilon_min`/`epsilon_max` — memory-aware per FR2.3 while still guaranteeing NFR3's size ceiling even if per-edge memory footprint isn't constant. `PruningWatcher.run_once(t)` is the synchronous, testable scan-and-prune pass; `start()`/`stop()` wrap it in a daemon background thread (FR2.1/2.5). Per FR2.4's "before removal" ordering, a candidate edge is written to cold storage *first* — only removed from the store on write success, left active for retry on failure (a full buffered/async write path is deliberately deferred to tasks.md 6.4, per that task split). `PruneEventBus` is a plain in-process pub/sub standing in for whatever bus a production deployment wires this to; Phase 3's `MotifEngine.on_prune()` (motif_engine.py) was its first real subscriber, and Phase 6 added two more (`audit.py`'s `AuditLogger.log_prune`, `metrics.py`'s `MetricsCollector`) -- still no Redis/Kafka-backed bus justified, since in-process pub/sub keeps serving every subscriber added so far just fine.
- `src/t_gnn/cold_storage.py` (`ColdStorageWriter` protocol, `Neo4jColdStorageWriter`, `InMemoryColdStorageWriter`, `BufferedColdStorageWriter`) — FR2.4/FR4.2: writes each pruned edge as `(Entity {id})-[:PRUNED_EDGE {...}]->(Entity {id})` via the real `neo4j` Bolt driver against `docker-compose.yml`'s Neo4j instance (connection config from `.env`'s `NEO4J_*` vars, defaulting to the compose stack's dev credentials), creating `Entity.id` and `PRUNED_EDGE.pruned_at` indexes on first use. This is genuinely wired up, not staged — Phase 4's `forensics.py` builds the forensic query API on top of this same relationship shape. `InMemoryColdStorageWriter` is a recording fake used in `PruningWatcher` unit tests that don't need live Neo4j. `BufferedColdStorageWriter` (tasks.md 6.4) is a drop-in `ColdStorageWriter` wrapper added in Phase 6 -- see the Phase 6 Architecture section below.

**Two ingestion adapters both produce `Edge` instances**, and are meant to be
interchangeable inputs to the same downstream pipeline (design.md §2.9):

- `src/t_gnn/ingestion/sysmon_adapter.py` (`SysmonEventAdapter.parse()`) — takes a normalized Windows Security/Sysmon event dict (flat, already parsed from XML by whatever log shipper) and dispatches on `(Channel, EventID)` to a handler. Deliberately combines two event families to reconstruct the two hops of the canonical lateral-movement motif from specs.md §1.1: Sysmon EventID 3 (NetworkConnect) yields the `Machine -> Machine` first hop, while Security logon events and Sysmon EventID 1 (ProcessCreate) yield the `User -> Machine` second hop. Protocol inference per event type is a documented heuristic (port number for NetworkConnect, LogonType/AuthenticationPackageName for logons, parent-process name for RCE) expected to be refined once real telemetry/calibration data is available.
- `src/t_gnn/data/stage_lanl.py` (`stage()`) — converts the LANL Comprehensive Cybersecurity dataset's `auth.txt.gz` (relative-time CSV, documented in `data/lanl/README.md`) into sharded NDJSON of the same `Edge` shape, anchoring the dataset's relative timestamps to a real epoch via `--epoch-start`. The real multi-GB dataset isn't vendored; `data/lanl/raw/sample_auth.txt.gz` is a tiny synthetic fixture in the same column format for tests.

When adding a third ingestion source, follow this same pattern: parse into
`Edge` instances via `schema.py`, don't invent a parallel edge representation.

**Phase 3's motif definitions follow the same schema/Python-representation
split as the edge contract**, and its engine is a mix of framework-agnostic
Python and one real infra integration, the same shape Phase 2 took with
Neo4j:

- `config/schema/motif.schema.json` + `src/t_gnn/motifs.py` (`MotifStep`, `MotifDefinition`, `MotifRegistry`) — FR3.1/3.5/tasks.md 3.1/3.9: a motif is an ordered sequence of `MotifStep`s (structural filters on `edge_type`/`protocol`/`src_type`/`dst_type`) plus a `window_seconds` completion bound. Each step's `key_field`/`key_resolver` describe how it chains to the entity bound by the previous step — `key_resolver` is the config-vs-code extensibility seam (tasks.md 3.9): `"identity"` (the endpoint id must literally equal the chain key) is enough for motifs like `admin_share_escalation` where the same entity reappears across hops; `"host_admin"` is a documented naming-convention *heuristic* (same spirit as `sysmon_adapter.py`'s protocol inference) standing in for real directory/asset-inventory linkage between a Machine and the User account(s) that administer it, needed for the `lateral_pivot` seed motif's "Machine B's admin account" hop. New motifs expressible with existing resolvers are pure config (`config/motifs.yaml` + `MotifRegistry.reload()`); motifs needing new entity-linkage semantics require a new `KeyResolver` registered in `KEY_RESOLVERS`.
- `src/t_gnn/motif_engine.py` (`MotifEngine`, `MotifState`, `MotifStateStore` protocol, `RedisMotifStateStore`, `InMemoryMotifStateStore`, `MotifCompletionEvent`/`MotifAlertBus`, `MotifResetEvent`/`MotifResetBus`) — FR3.2/3.3/3.4/3.5: `MotifEngine.on_edge()` is the delta-update (design.md 2.6) — for every definition, it computes each step's candidate chain key directly from the incoming edge's endpoint (via that step's resolver), so advancing a partial match is a direct key lookup against `RedisMotifStateStore`, never a scan of existing states. `RedisMotifStateStore` is genuinely wired up against `docker-compose.yml`'s Redis (like `Neo4jColdStorageWriter` was for 2.4) — a hash per `(motif_name, chain_key)` plus a reverse-index set per edge id — with `EXPIRE` set to the motif's `window_seconds` on every write (tasks.md 3.7's TTL safety net). `InMemoryMotifStateStore` is the unit-test fake, tracking the same TTL semantics against an injectable clock instead of wall-clock sleeps. Reaching a definition's final stage emits a `MotifCompletionEvent` via `MotifAlertBus` (FR3.4) and clears the state.
- Motif-reset-on-prune (FR3.3/tasks.md 3.6) is `MotifEngine.on_prune()`, auto-subscribed to a `pruning.py` `PruneEventBus` when one is passed to `MotifEngine`'s constructor — it uses the state store's reverse edge-id index to find and delete any partial match that depended on the just-pruned edge, live-wired to Phase 2's existing prune event publication (2.5), not a stub. Each reset also publishes a `MotifResetEvent` on `MotifResetBus` (added in Phase 6, tasks.md 6.1/6.2) -- introduced once there were two real subscribers (the audit logger and the metrics collector) needing to observe resets, not speculatively.
- Graceful degradation on Redis outage (tasks.md 6.3, NFR4, design.md §5) — every `state_store` call inside `MotifEngine` goes through `_state_get`/`_state_set`/`_state_delete`/`_state_containing_edge`, which catch `redis.exceptions.RedisError` instead of propagating it. On failure, `self.available` flips to `False` (logged once, not per edge) and the call site treats it as "no match," so `on_edge()`/`on_prune()` simply stop finding/creating state until Redis returns, at which point the next successful call flips `self.available` back and detection silently resumes. `BaselineStore`/`DecayEngine`/`TGNNInferenceEngine` have zero Redis dependency already, so FR1.5 anomaly detection is unaffected by construction.

**Phase 4 is a read-only query layer over the schema Phase 2 already wrote**,
not a second cold-storage implementation:

- `src/t_gnn/forensics.py` (`Neo4jForensicQueryAPI`, `PrunedEdgeRecord`) — FR4.1/4.2/4.3: reads the exact `(Entity)-[:PRUNED_EDGE]->(Entity)` relationship shape `cold_storage.py`'s `Neo4jColdStorageWriter` writes; there is deliberately no second schema. `reconstruct_activity(entity_id, start, end)` implements design.md 2.7's example query verbatim — matches `entity_id` as either endpoint and filters/orders by `PRUNED_EDGE.t_e` (the *original event* time), which is a different index than the `pruned_at` (eviction time) one 2.4 already created for its own audit use case — both are real indexes, not redundant. `get_edge(edge_id)` is the point-lookup complement, e.g. for resolving a `MotifCompletionEvent.matched_edges` id (motif_engine.py) back to full metadata. Every field FR4.2 requires round-trips through `PrunedEdgeRecord`; there's no `InMemory*` fake here since nothing else in the codebase consumes this API programmatically yet (it's an investigator-facing leaf, not a dependency other unit tests need to swap out).

**Phase 5 wires the earlier phases' live state and signals into an actual
PyTorch Geometric forward pass**, not a placeholder — but per specs.md §4's
explicit non-goal ("replacing the T-GNN model architecture itself"), the
*model* is deliberately minimal; only the integration seams are meant to
be production-shaped:

- `src/t_gnn/tgnn.py` (`DynamicTGNN`, `EntityFeatureTable`, `TGNNInferenceEngine`, `InferenceResult`/`InferenceResultBus`) — 5.1/5.2/5.3, design.md 2.4/2.8: `DynamicTGNN.score_entities()` is the customized forward pass (5.1) — it calls `ActiveGraphStore.to_pyg_edge_index()` (2.1) fresh on every invocation rather than caching it, so an edge pruned since the last call is simply absent from the next pass ("dynamic dropping of edges during the forward pass," verbatim from the tech-stack note). `EntityFeatureTable` is the missing piece `to_pyg_edge_index()` alone doesn't provide: a *stable* node_id -> embedding-row registry, since that method's own `node_index` is recomputed fresh (and non-stable) on every call. `TGNNInferenceEngine.observe_deviation()` caches each entity's latest FR1.5 z-score, concatenated onto its embedding as an extra feature column before every forward pass (5.2) — a real input, not a side-channel annotation (see `test_deviation_feature_changes_the_score` in tests/test_tgnn.py). `TGNNInferenceEngine.on_motif_completion()` auto-subscribes to a `MotifAlertBus` (3.5) and scores only the completed motif's `chain_key` plus its live neighbors immediately (5.3's fast path), rather than waiting for the next scheduled `run_once()` — `run_once()`/`start()`/`stop()` follow the same synchronous-pass-plus-daemon-thread shape as `PruningWatcher` (2.2). The two-`SAGEConv`-layer model itself is untrained/randomly initialized on purpose — swapping in a production-trained architecture later replaces this class, not the engine wired around it.
- The two Phase 5 end-to-end tests (tasks.md 5.4/5.5, in tests/test_tgnn_e2e.py) exercise this wiring against the earlier phases for real: 5.4 stages the sample LANL fixture (0.4) through `DecayStreamProcessor` as background traffic, layers a synthetic "low and slow" tail onto one entity, and confirms FR1.5's z-score flags the tail's anomalous edge; 5.5 replays the canonical two-hop lateral-pivot sequence through a real `MotifEngine` and confirms its completion alert drives `TGNNInferenceEngine`'s fast path with no wiring beyond construction.

**Phase 6 hardens the pipeline rather than adding a new stage** — its two
observability modules are framework-agnostic aggregators (no
Prometheus/Grafana/log-shipping pipeline exists to wire them into yet), but
its two resilience changes are load-bearing code paths already exercised
by the rest of the suite:

- `src/t_gnn/audit.py` (`AuditLogger`, `AuditSink` protocol, `FileAuditSink`, `InMemoryAuditSink`) — tasks.md 6.1, NFR5: subscribes to `pruning.py`'s `PruneEventBus` and `motif_engine.py`'s `MotifResetBus` and writes one newline-delimited JSON record per event via `log_prune()`/`log_motif_reset()`. `FileAuditSink` opens/closes the file per write (durability over throughput — audit records are low-frequency, the opposite tradeoff `BufferedColdStorageWriter` below makes for its much higher-volume path); `InMemoryAuditSink` is the unit-test fake.
- `src/t_gnn/metrics.py` (`MetricsCollector`, `RollingRateCounter`, `EpsilonReading`, `InferenceLatencyReading`, `MetricsSnapshot`) — tasks.md 6.2: active graph size is read live from `ActiveGraphStore.__len__` (not tracked as a series); prune rate / motif hit rate / motif reset rate are `RollingRateCounter`s fed by subscribing to `PruneEventBus` / `MotifAlertBus` / `MotifResetBus` respectively — "hit" is defined as a `MotifCompletionEvent` (a full match, i.e. a detection) rather than every intermediate-stage advance, the more externally meaningful of the two readings design.md's own "cache hit" language could map to. Epsilon-history and inference-latency series come from `observe_pruning_pass()`/`observe_inference_pass()`, which the caller invokes explicitly alongside `PruningWatcher.run_once()`/`TGNNInferenceEngine` passes — no hook was added to either of those classes, since both already return everything `MetricsCollector` needs. `snapshot()` is the single dashboard-ready read of all five quantities.
- `src/t_gnn/motif_engine.py`'s Redis-outage graceful degradation (tasks.md 6.3) and `src/t_gnn/cold_storage.py`'s `BufferedColdStorageWriter` (tasks.md 6.4) are described in their own bullets above (Phase 3's and Phase 2's sections respectively) — both are Phase 6 additions to earlier-phase modules, not new modules of their own, so they're documented alongside the code they modify rather than repeated here.
- `tests/test_chaos.py` (tasks.md 6.5) is one test per row of design.md §5's Failure Modes table: a 1000-edge ingest spike forcing epsilon toward `epsilon_max` under size pressure then relaxing once calm (Flink backpressure's proxy, since no real Flink job exists to generate literal backpressure); a simulated Redis outage (`redis.exceptions.ConnectionError`) showing `MotifEngine` disables cleanly while `BaselineStore`/`DecayEngine` proceed unaffected on the same edges; intermittent Neo4j latency spikes showing `PruningWatcher.run_once()` never stalls and every write eventually lands via `BufferedColdStorageWriter`; and a misconfigured `λ_p` producing a prune-rate spike fully visible in `AuditLogger`'s records, corrected via `ProtocolDecayRegistry.reload()` with no redeploy.

**Phase 7 is documentation plus one tool, not a new pipeline stage:**

- `docs/configuration-reference.md` (tasks.md 7.1) and `docs/operational-runbook.md` (tasks.md 7.2) are real, complete reference/procedure docs covering every config surface and operational workflow introduced across Phases 0-6 — not placeholders. Per the End-of-phase checklist above, keep both current whenever a future phase adds or changes a config surface or operational procedure; they're "non-planning docs" in the same sense `README.md` is, just organized by topic instead of by project overview. `docs/cli-reference.md` (added post-Phase-8, ad hoc — not a `tasks.md` item) is the dedicated CLI reference: every `python -m t_gnn...` tool plus `scripts/run_pipeline.py`/`scripts/init_postgres.py`, with a "which tool do I need?" table, a diagram of how the staging tools (`stage_lanl`/`simulate_traffic` on `main`; `stage_mordor` too on `feature/mordor-ingestion`) feed the consumer tools (`pilot`/`score_entities`/`run_pipeline`), and a task-oriented "Common tasks" cookbook of full copy-pasteable command sequences per goal (e.g. "simulate traffic then replay it live"), repeating steps across tasks rather than making the reader assemble flags from separate sections. Keep it current alongside the other two whenever a CLI's flags change or a new one is added.
- `src/t_gnn/pilot.py` (`RedTeamLabel`, `load_redteam_labels()`, `evaluate_anomaly_detection()`, `evaluate_motif_detection()`, `run_pilot()`, plus a `python -m t_gnn.pilot` CLI mirroring `calibrate_decay.py`'s) — tasks.md 7.3: a real, tested harness computing true/false positive/negative rates for both detection paths (FR1.5 deviation signals vs. FR3.4 motif completions) against LANL `redteam.txt`-format ground truth. `evaluate_motif_detection()`'s candidate match is `{Machine:source_computer, Machine:destination_computer, User:user}` against a completion's `chain_key`, covering both seed motifs' chain-key shapes (`lateral_pivot`'s is a Machine, `admin_share_escalation`'s is a service-account User) rather than assuming one. `data/lanl/raw/sample_redteam.txt` is the matching tiny synthetic label fixture for `data/lanl/raw/sample_auth.txt.gz` (same relationship task 0.4's sample fixture already has to the real dataset); `tests/test_pilot.py`'s end-to-end smoke test asserts the *correct* miss (a false negative, not a fabricated detection) given that fixture's tiny size — same honesty standard `calibrate_decay.py`'s own smoke test holds itself to. Running an actual pilot against real labeled enterprise traffic, and using the result for a rollout decision, is the operational step this module's own docstring says the repo can't perform.
- `src/t_gnn/data/simulate_traffic.py` (`generate_background_traffic()`, `inject_lateral_pivot()`, `inject_admin_share_escalation()`, `inject_low_and_slow_anomaly()`, `simulate()`, `write_staged_shards()`, `write_redteam_labels()`, plus a `python -m t_gnn.data.simulate_traffic` CLI) — extends 7.3: generates synthetic labeled traffic at a configurable scale for exercising `pilot.py`/the detection pipeline locally, beyond what the tiny committed fixture can. Background traffic only ever produces `User`->`Machine` `Authentication` edges, so it can structurally never collide with either seed motif's shape (`lateral_pivot` needs `Machine`->`Machine`; `admin_share_escalation` needs `User`->`User` then `FileTransfer`) — every motif completion in a simulated run is therefore provably one of the injected attacks, not a false positive, which is what makes `tests/test_simulate_traffic.py`'s end-to-end assertions exact rather than approximate. Background w_0 is jittered (not a flat `1.0`) so `EWMABaseline` has nonzero variance per entity — without that, z-scores are `None` regardless of how extreme a later injected anomaly is (the same fix `tests/test_tgnn_e2e.py`'s 5.4 scenario needed). Operates on `Edge` objects directly rather than round-tripping through LANL's raw `auth.txt` text format, since that format's vocabulary can't express `FileTransfer`/`RemoteCodeExecution` edge types or a controllable `w_0` — both needed for two of the three injected scenarios. Still synthetic, not real enterprise traffic; see `docs/operational-runbook.md`'s "Running a pilot evaluation" for what this does and doesn't substitute for.

**Phase 8 is tooling/documentation follow-ups discovered while using the CLIs Phase 7 shipped, not a new pipeline stage or FR:**

- `src/t_gnn/score_entities.py` (`score_staged_edges()`, plus a `python -m t_gnn.score_entities` CLI mirroring `pilot.py`'s) — tasks.md 8.1: closes the gap that `pilot.py` (7.3) evaluates the FR1.5 deviation-signal and FR3.4 motif-completion paths against labeled ground truth but never actually invokes the PyTorch Geometric forward pass design.md §2.8 describes. `score_staged_edges()` replays staged edges through the same real `DecayStreamProcessor` (1.3-1.5) and `MotifEngine` (3.2-3.5) `pilot.py` already uses, upserting each into an `ActiveGraphStore` (2.1); `TGNNInferenceEngine` is wired to the same `MotifAlertBus` the `MotifEngine` publishes to, so a motif completion mid-replay drives its 5.3 fast path inline exactly as design.md §3's data flow (steps 5-7) describes, not just at the end. After replay, one final scheduled pass (5.1/5.2) scores every entity still in the graph, sorted by score magnitude (the untrained reference model's sign carries no fixed meaning per specs.md §4's non-goal — only relative magnitude does). No changes to `tgnn.py`'s engine or model; this is purely a new consumer of the existing Phase 5 integration.
- `docs/operational-runbook.md`'s `simulate_traffic`/`pilot` command blocks (tasks.md 8.2) gained PowerShell-safe forms alongside the existing bash ones — Windows PowerShell doesn't accept bash's `\` line continuation, which had produced a misleading "module not found"/argparse-looking error that was actually a shell-syntax problem, not a packaging one.

**Backlog B.3-B.6 add real, tested extensions to earlier phases' modules, not new pipeline stages** — B.1/B.2 (a real Flink job + backpressure-driven `ε`) are deliberately unattempted: PyFlink for this stack's Flink 1.18 only supports Python 3.8-3.10 against this dev environment's Python 3.12, and `docker-compose.yml` has no message broker for a job to consume from — see tasks.md's Backlog section for the full reasoning. B.7 (real enterprise-scale NFR1/NFR2 validation) is the same kind of operational gap task 0.4/7.3 already document — no amount of local benchmarking substitutes for real traffic at real scale, though `tests/test_load.py` gained two much-larger opt-in proxy benchmarks (`RUN_HEAVY_LOAD_TEST=1`) regardless. B.8 (a Mordor/OTRF-Security-Datasets ingestion adapter, `src/t_gnn/data/stage_mordor.py`) is implemented and verified but lives on the separate `feature/mordor-ingestion` branch rather than `main` — see that branch's CLAUDE.md for its Architecture entry:

- `src/t_gnn/adaptive_calibration.py` (`AdaptiveDecayCalibrator`, `RecalibrationEvent`) — B.3, proposal.docx §7: the online counterpart to `calibrate_decay.py`'s one-shot offline batch heuristic. `observe()` is fed one live edge at a time (the same "caller invokes explicitly" pattern `metrics.py`'s `observe_pruning_pass()` uses alongside `PruningWatcher.run_once()`), tracking a rolling per-protocol window of same-entity inter-arrival gaps and reapplying `calibrate_decay.py`'s exact `lambda_p = ln(2) / median_gap` heuristic every `update_interval_edges` edges once a protocol clears `min_samples`. A `max_relative_change` clamp bounds how far one recalibration can move `lambda_p` in one pass, since a noisy live window is a less trustworthy signal than a whole-dataset batch view — guards against design.md §5's "Incorrect lambda_p" failure mode. Writes go through a new `ProtocolDecayRegistry.update()` (protocol_registry.py) — in-memory only, preserves existing `half_life_hours`/`description` metadata; a human-driven correction via task 1.7 still hand-edits the YAML + `reload()`s, a separate path from this always-on one.
- `src/t_gnn/motifs.py`'s `MotifStep.match_score()` and `src/t_gnn/motif_engine.py`'s `MotifEngine(fuzzy=..., min_confidence=...)` — B.4, proposal.docx §7: probabilistic/fuzzy matching layered onto the exact-match-only engine. `match_score()` still hard-rejects on `src_type`/`dst_type` mismatch (those encode the pattern's structural *roles*, not a substitutable technique) but gives partial credit on `edge_type`/`protocol` (e.g. SMB substituted for the canonical RDP), returning a score in `(0, 1]` or `None`. `fuzzy=False` (the engine's default) is byte-for-byte the pre-B.4 exact-match behavior — every pre-existing motif test passes unchanged. `fuzzy=True` accumulates a chain's confidence as the running product of each matched step's score and only emits a completion once the final product clears `min_confidence`; below it, the state is dropped rather than reported (further steps can only decrease the product, never recover it). `MotifState`/`MotifCompletionEvent` both gained a `confidence` field (default 1.0), with `RedisMotifStateStore` reading a missing field as 1.0 for backward compatibility with pre-B.4 records.
- `src/t_gnn/sharding.py` (`stable_shard_index()`), `graph_store.py`'s `ShardedActiveGraphStore`, and `motif_engine.py`'s `ShardedMotifStateStore` — B.5, proposal.docx §7's "distributing the active graph and pattern cache across multiple nodes." `stable_shard_index()` is a SHA-256-based hash stable across processes (Python's built-in `hash()` is salted per-process via `PYTHONHASHSEED`, which would make shard routing disagree between processes — a real correctness bug this avoids). `ShardedActiveGraphStore` partitions N `ActiveGraphStore` shards by `edge_id` (already a stable hash, schema.py's `make_edge_id()`) — `upsert`/`remove`/`get` route to exactly one shard with no directory service needed, while `neighbors()`/`to_pyg_edge_index()` fan out across all shards and merge (a real scatter-gather tradeoff). `ShardedMotifStateStore` wraps N `MotifStateStore`s (N `RedisMotifStateStore`s pointed at different Redis hosts/dbs for genuine multi-node use, or `InMemoryMotifStateStore`s for tests), routing by `chain_key` and fanning `states_containing_edge()` out across all shards. Each shard is an ordinary, already-real store; in a genuine deployment they'd be separate processes/machines behind an RPC layer, but the partitioning/routing logic itself is real and directly tested here, not a fake standing in for one.
- `src/t_gnn/feedback.py` (`MotifFeedbackEvent`, `MotifFeedbackBus`, `MotifPriorityTracker`) — B.6, proposal.docx §7's "integrating feedback from analyst investigations to refine which patterns are considered high priority over time." A new bus (mirroring `PruneEventBus`/`MotifAlertBus`/`MotifResetBus`'s in-process pub/sub convention) plus a subscriber that tracks per-motif true/false-positive counts from analyst dispositions of past `MotifCompletionEvent`s. `priority_score()` is a Laplace-smoothed true-positive rate (`(tp+1)/(tp+fp+2)`) so a motif with no feedback yet reads as a neutral 0.5 rather than an undefined ratio; `ranked_motifs()` surfaces which patterns are currently trusted most, ready for triage/reprioritization. No changes to `motif_engine.py`'s detection logic — this is a downstream consumer, the same relationship `audit.py`/`metrics.py` already have to their buses.

**`scripts/run_pipeline.py`** is a separate, ad hoc addition (not a `tasks.md` item) requested to see the pipeline actually run continuously: it wires every real component above (decay/baseline, `ActiveGraphStore`/`ShardedActiveGraphStore`, `PruningWatcher` against real Neo4j, `MotifEngine` against real Redis with `--fuzzy`/`--shards` flags exercising B.4/B.5, `TGNNInferenceEngine`, `MetricsCollector`, `AuditLogger`, and optionally `AdaptiveDecayCalibrator` via `--adaptive-calibration`) into one long-running process. `--source synthetic` (default) feeds it a continuously-generated synthetic traffic stream since no live event source exists (B.1's gap); `--source replay --staged-dir <dir>` instead replays any staged directory (`stage_lanl.py`/`simulate_traffic.py` output, or — on the separate `feature/mordor-ingestion` branch — `stage_mordor.py` output, e.g. a real Mordor capture) through the same live components in timestamp order, finite rather than running until Ctrl+C. Both edge sources funnel into the same `_process_edge()`/periodic-metrics-pass logic. Verified running live against the real `docker compose up -d` stack in both modes, not just read — including, on the `feature/mordor-ingestion` branch, a real 229-edge Mordor capture replayed end-to-end with zero errors. Doesn't wire in `MotifPriorityTracker`/`MotifFeedbackBus` (B.6) since that loop is inherently human-driven. See README.md's "Running the full pipeline live" for usage.

**Frontend Implementation (`frontend_implementation` branch): Milestone F0 — Backend API Layer.** Decided with the developer (2026-07-30): the API service is a **decoupled, stateless reader** — it never constructs `ActiveGraphStore`/`MotifEngine`/`TGNNInferenceEngine` itself, only reads what a separately-running pipeline process already persisted. FastAPI + uvicorn, chosen because it imports `src/t_gnn`'s existing modules directly with no cross-language bridge. Real auth (F0.11) deliberately deferred in favor of the frontend's mock-auth bypass.

- `src/t_gnn/api_state.py` (`create_api_tables()`, `ApiStateWriter`, `ApiStateReader`) — the Postgres bridge between the two processes, reusing the previously-idle local `t_gnn_dev` database (see "Local dev database" above) rather than standing up a new one, per this repo's existing "use Postgres for persistence needs outside Neo4j/Redis's roles" guidance. New tables: `users` (created now, before real auth exists, so `motif_feedback`/`alert_acknowledgements` have a real foreign key to attribute to once login lands — `ApiStateWriter.get_or_create_user()` inserts a placeholder row keyed on whatever free-text analyst string the mock-auth frontend sends), `metrics_snapshots`, `entity_scores` (upserted, latest value per entity only — not a full history), `motif_completions`, `motif_resets`, `motif_feedback`, `alert_acknowledgements`. `ApiStateWriter` auto-subscribes to `MotifAlertBus`/`MotifResetBus`/`InferenceResultBus`/`MotifFeedbackBus` — the same auto-subscribe convention `audit.py`'s `AuditLogger` already uses — and degrades gracefully on a Postgres outage (`self.available` flips false, logged once, mirroring `motif_engine.py`'s Redis-outage handling, tasks.md 6.3) instead of crashing the pipeline process. `scripts/init_postgres.py` now calls `create_api_tables()` after ensuring the database exists (table creation was previously deferred here to "whichever future task first needs a table" — this is that task). `scripts/run_pipeline.py` constructs an `ApiStateWriter` by default (disable with `--no-api-persist`) and calls `record_metrics_snapshot()` alongside its existing `MetricsCollector.snapshot()` call.
- `src/t_gnn/api/` (`app.py`'s `create_app()`, `deps.py`, `schemas.py`, `routers/`) — the FastAPI service itself: `metrics.py` (`GET /api/metrics/snapshot`), `scores.py` (`GET /api/scores/entities`, paginated/sorted by `abs(score)`), `motifs.py` (`GET`/`POST /api/motifs/completions`, `/resets`, `/feedback` — the `POST` is F9.5's analyst-disposition groundwork), `forensics.py` (`GET /api/forensics/entity/{id}`, `/edge/{id}`, a direct wrapper over the already-real `Neo4jForensicQueryAPI` — `deps.get_forensics_api()` raises a clean 503 instead of crashing the service if Neo4j isn't reachable), `config.py` (`GET /api/config/protocols`, `/motifs`, reading the real hot-reloadable registries directly with no Postgres dependency), `alerts.py` (`POST /api/alerts/ack`, F13.6's groundwork — keyed on `detection_type`+`detection_ref` rather than one unified alert id, since motif completions and anomaly-path detections don't share an id space), `health.py` (`GET /api/health`, checking Postgres/Neo4j/Redis reachability + staleness of the last recorded metrics snapshot). `app.py`'s exception handlers give every error the same `{"error": {"code": ..., "message": ...}}` envelope; `schemas.py`'s `Paginated[T]` (`items`/`limit`/`offset`/`total`) is the pagination envelope every list endpoint uses (offset-based — cursor-based was considered and rejected as unneeded at this scale/write-concurrency). `python -m t_gnn.api` runs it, mirroring this repo's other `python -m t_gnn.*` CLI convention.
- `tests/test_api_state.py` (live-Postgres round-trips per table, skip-if-unreachable — same convention `test_cold_storage.py`/`test_forensics.py` use for Neo4j) and `tests/test_api.py` (HTTP-layer tests via FastAPI's `TestClient` + `app.dependency_overrides`, no live infra needed — an in-memory fake duck-typing both `ApiStateReader`'s and `ApiStateWriter`'s methods, the same relationship `InMemoryColdStorageWriter` has to `Neo4jColdStorageWriter`). Verified end-to-end against the real `docker compose up -d` stack and a real local Postgres: a live `scripts/run_pipeline.py` run (which detected a real `lateral_pivot` motif) followed by a separately-started `python -m t_gnn.api` process correctly serving that data back over HTTP, with zero shared memory between the two processes — confirming the decoupled architecture decision actually works, not just that its unit tests pass.
- `src/t_gnn/audit.py`'s `read_records()` and `src/t_gnn/api/routers/audit.py` (`GET /api/audit/log`) — F0.8, added in a later pass once F0.9's read-only-registry precedent made clear this endpoint didn't actually depend on the unresolved "what does 'raw logs' mean" product question (that question is F11.1's UI-copy concern, not a blocker on serving the audit trail that already exists). `read_records()` is a plain file scan/filter (`since`/`record_type`) over `FileAuditSink`'s NDJSON, newest-first, matching every other list endpoint's ordering convention; `deps.py`'s `audit_log_path()` reads `AUDIT_LOG_PATH` (default `logs/audit.log`, mirroring `scripts/run_pipeline.py --audit-log`'s default) so both processes agree on the file without sharing code. No Postgres/Neo4j/Redis dependency at all — same "no live-infra dependency" shape as F0.9's config endpoints.
- `src/t_gnn/api/routers/stream.py` (`GET /api/stream/events`) — F0.10, implemented as SSE rather than WebSocket (one-directional server→client is all F13's Live Monitoring needs; no extra dependency beyond FastAPI/Starlette). Honest architectural note: F0's decoupled-process decision means the API process has no live bus to relay from directly (that memory lives in whatever process is running `scripts/run_pipeline.py`) — so this is a polling implementation wearing a push interface. It polls `ApiStateReader`'s new cursor-based methods (`list_motif_completions_since(min_id)`, `list_motif_resets_since(min_id)`, `list_entity_scores_since(min_updated_at)` — ascending-order variants of F0.3-F0.5's DESC "recent page" methods, added alongside this task) plus `audit.py`'s `read_records(since=...)` for prune events, on a `STREAM_POLL_INTERVAL_SECONDS`-configurable interval (`deps.get_stream_config()`, default 1s), re-emitting new rows as SSE events (`motif_completion`/`motif_reset`/`inference_result`/`prune`) plus a periodic `heartbeat` so a client's reconnect-with-backoff logic (F4.6) can tell "quiet" from "stalled." A Postgres error mid-poll surfaces as an `error` SSE event and the loop keeps retrying rather than the connection dying — the same graceful-degradation posture `require_postgres` gives request/response endpoints, adapted for a long-lived connection.
- Not started (both still marked `[BACKEND TODO]` in tasks.md, unlike F0.8/F0.10 above): F0.12 (a "company cybersecurity score" formula/aggregation job), F0.13 (IP/device/session-history fields — would require a `config/schema/edge.schema.json` change, a cross-cutting change touching every ingestion adapter), F0.14 (geographic attack-map data, blocked on F0.13). F0.11 (real auth) also remains deferred per the developer's explicit choice to keep the mock-auth bypass for now. See the Project section's frontend-status paragraph above for why each was deliberately deferred rather than overlooked.

**Frontend Implementation: Milestone F1 — Project Setup.** The actual `frontend/` app, scaffolded via `npm create vite@latest frontend -- --template react-ts` (React 19 / Vite 8 / TypeScript 6, whatever `create-vite@latest` resolved to at scaffold time — nothing pinned deliberately). `frontend/` is a normal `package.json`-rooted npm project nested one directory below this repo's git root (the repo itself is primarily the Python backend) — every path below is relative to `frontend/`, not the repo root.

- Vite's own default template now ships `oxlint` instead of ESLint and has no Prettier/test setup at all — none of that fits F1.2's explicit "ESLint + Prettier" ask, so `oxlint`/`.oxlintrc.json` were removed and replaced: `eslint.config.js` (flat config) composing `@eslint/js`, `typescript-eslint`'s recommended rules, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, and `eslint-config-prettier` (to disable any ESLint formatting rules that would conflict with Prettier); `.prettierrc.json`/`.prettierignore` for formatting. `package.json` gained `lint`/`lint:fix`/`format`/`format:check`/`test`/`test:watch` scripts plus a `lint-staged` config (ESLint --fix + Prettier --write on staged files).
- Commit hooks (`husky` + `lint-staged`) needed one nonstandard step because of the nested-package layout: husky v9's own `.git`-detection fails when invoked with cwd inside a subdirectory (confirmed directly — `npx husky` from `frontend/` errors `.git can't be found` even though plain `git` commands resolve the parent `.git` fine from there), so `package.json`'s `prepare` script is `cd .. && npx --prefix frontend husky frontend/.husky` — it explicitly moves to the repo root first, then points `core.hooksPath` at `frontend/.husky` (a path relative to the repo root, which is where git actually looks it up). `frontend/.husky/pre-commit` itself is `cd frontend && npx lint-staged`, since git hook scripts always run with cwd at the repo root regardless of where `core.hooksPath` points. Verified end-to-end: fresh `npm install` inside `frontend/` correctly re-establishes `core.hooksPath`, and the hook runs `lint-staged` successfully.
- `vite.config.ts`'s `resolve.alias` (`@` → `./src`) and `tsconfig.app.json`'s `paths` (`@/*` → `./src/*`, no `baseUrl` — TypeScript 6.0 deprecates it, `paths` alone now resolves relative to the tsconfig file) are the F1.3 path-alias pair; both must stay in sync by hand since Vite and `tsc` each read their own config. `src/config/env.ts` reads `import.meta.env.VITE_API_BASE_URL` (typed via `src/vite-env.d.ts`'s `ImportMetaEnv` augmentation) and throws immediately if unset, rather than silently falling back to a possibly-wrong backend URL; `frontend/.env.example` documents it (default `http://127.0.0.1:8000`, F0's `python -m t_gnn.api` default), and real values live in the already-`.gitignore`d `.env.local` (Vite's own convention — no new gitignore entry needed).
- Recharts and Zustand (F1.4) are installed but deliberately not wired into any component — no real feature needs either yet (F5 builds shared components, F12 builds charts), and example/demo usage now would just be dead code those milestones delete. TanStack Query (F1.5) is different: its `QueryClientProvider` already wraps the app root in `src/main.tsx` with a module-level `QueryClient`, because F4's API hooks need that provider mounted, not merely the package installed. (F2 replaced what that provider wraps — see below — but the provider itself is unchanged from F1.)
- `frontend/src/{pages,components,features,api,hooks,store,types}/` (F1.6) each hold a `.gitkeep` placeholder (git doesn't track empty directories); `config/` was added alongside them for `env.ts` above — documented in `frontend/README.md`'s folder-structure table so the extra directory doesn't read as unexplained drift from tasks.md's seven.
- `.github/workflows/frontend-ci.yml` (F1.7) is this repo's first GitHub Actions workflow of any kind (the only prior CI-relevant command anywhere was `pytest`, run manually, no workflow file). Triggers on pushes to `frontend_implementation` and on any PR touching `frontend/**`; `defaults.run.working-directory: frontend` since the app isn't at the repo root. Runs `npm ci` → lint → format:check → test (Vitest + React Testing Library) → build, in that order, so a lint/format failure surfaces before spending time on a build.
- Vite's default marketing-template `App.tsx` (counter demo, hero/logo images, doc links) was replaced with a minimal placeholder heading in F1, then removed entirely in F2 once `src/router.tsx` took over as `main.tsx`'s render root (see below) — there was no longer anything for a standalone `App` component to do. `src/App.css` and the unused image assets were removed with the original F1 replacement; `src/index.css` was trimmed to a plain reset (the template's centered-marketing-page layout doesn't fit a dashboard).
- Verified directly, not just by reading the config: `npm run lint`, `npm run format:check`, `npm run test`, and `npm run build` all pass clean from a fresh `npm install`; `npm run dev` was also started and its served HTML/module output inspected (correct `<title>`, `QueryClientProvider` wiring present in the compiled `main.tsx` output) before being stopped.

**Frontend Implementation: Milestone F2 — Routing & App Shell.** Builds directly on F1's scaffold; F5.1/F5.2 (Navbar/Sidebar) were pulled forward into this pass since F2.2 has a hard dependency on both and neither had any dependency of its own beyond F1.4 (already satisfied) — building throwaway placeholder nav components in F2 only to redo them properly in F5 would have been pure waste.

- `react-router-dom@7` (data router APIs: `createBrowserRouter`/`RouterProvider`), installed fresh for F2.1. `npm audit` reports a high-severity advisory (GHSA-qwww-vcr4-c8h2) against the installed version, but it's specific to RSC-mode server actions — this app is a plain client-side SPA with no server actions/RSC mode, so that code path is never exercised; the only remediation `npm audit fix` offers is downgrading below 7.12.0, which would trade a real, current version for an older one over an inapplicable vulnerability class, so 7.18.2 was kept as-is. Revisit if a genuine patched release ships.
- `src/config/routes.ts` is F2.1's single source of truth for route paths (`ROUTES`) and the nav-relevant subset (`NAV_ROUTES` — excludes `/investigation/:entityId`, a drill-down detail route with no static nav entry, and `/login`, outside the authenticated shell) that F5.2's Sidebar renders from, so the two can't silently drift apart.
- `src/router.tsx` exports both `routes` (a plain `RouteObject[]`) and `router` (`createBrowserRouter(routes)`) — the split exists purely for testability: `src/router.test.tsx` feeds the same `routes` tree into `createMemoryRouter` (initial-entries-driven, no real browser history) rather than exercising the production browser router directly. F2.3's code splitting uses React Router v7's native `lazy` route field (each leaf route dynamically imports a module exporting `Component`) instead of a hand-rolled `React.lazy`/`Suspense` pair — the data router already awaits the import during navigation. Verified concretely: `npm run build`'s output lists each page as its own chunk (`HomePage-*.js`, `AnalyticsPage-*.js`, etc.), not folded into the main bundle.
- `src/components/AppShell.tsx` (F2.2) is the root layout route — `Navbar` (`src/components/Navbar.tsx`, F5.1, pulled forward) on top, `Sidebar` (`src/components/Sidebar.tsx`, F5.2, pulled forward: `NavLink`s generated from `NAV_ROUTES`) plus `<Outlet/>` below. `/login`'s route sits outside this layout entirely (a sibling in `router.tsx`'s top-level array, not a child), so it renders with no nav chrome. (Navbar gained F3.3's logout control in Milestone F3 — see below; still no user menu/branding beyond that.)
- `src/components/ProtectedRoute.tsx` (F2.4) was a bare `<Outlet/>` pass-through when first built in F2, by design — every page needing auth gating was already nested under it in `router.tsx`, so Milestone F3 (F3.2) only had to add the real check inside this one component rather than re-nest routes later. It now does that real check; see the Milestone F3 addendum below.
- `src/components/RouteErrorBoundary.tsx` (the root layout route's `errorElement`) and `src/pages/NotFoundPage.tsx` (the `path: '*'` leaf route) are F2.5's two distinct failure paths — a thrown render/loader/lazy-import error vs. a syntactically matched but nonexistent path — not one component covering both.
- `src/pages/*.tsx` are placeholder page components for all eight routes (Home/Analytics/Investigation/Detections/Logs/Monitoring/Settings), each just a heading plus a note naming the milestone that builds the real page out (F6/F12/F10/F9/F11/F13/F15 respectively) — consistent with F1's "don't build throwaway feature code ahead of the milestone that owns it" posture. `LoginPage` was a placeholder in F2; Milestone F3 (F3.1) gave it real (mock-auth) behavior — see below.
- `src/router.test.tsx` exercises the route tree via `createMemoryRouter`: `/analytics` (an unmatched path) renders `NotFoundPage`, `/login` renders without shell chrome. As of Milestone F3, every protected-route case is split into its own `describe` block that logs in via `useAuthStore.getState().login(...)` first (an unauthenticated `describe` block separately covers the redirect-to-`/login` case) — see the Milestone F3 addendum below for why this changed. Verified end-to-end, not just unit-tested: `npm run build`'s per-page chunking output and a running `npm run dev` instance (HTML shell served correctly for both `/` and a client-only route like `/analytics`) both checked directly.

**Frontend Implementation: Milestone F3 — Authentication.** Implemented to the extent F0.11's absence allows — this milestone's own header is explicit that anything beyond a stubbed/mocked login is blocked on that backend gap, and its instructions forbid building a real credential store client-side.

- `src/store/authStore.ts`'s Zustand `useAuthStore` (F3.1) holds `session: {analyst, expiresAt} | null` in memory only — no `persist` middleware, no localStorage/sessionStorage. That's a deliberate reading of tasks.md's own "token/session in memory" phrasing, not an oversight: a page reload loses the session and returns to `/login`. `analyst` is free text, not a verified credential, mirroring the backend's already-real mock-auth convention (`ApiStateWriter.get_or_create_user()`, this file's F0 addendum) rather than inventing a second one. `isSessionValid()` checks `expiresAt` (a 12h client-side-only TTL) — this has no server-side enforcement behind it and isn't meant to; it exists so F3.3 has something concrete to expire, and F0.11 replaces it with whatever real token expiry that backend design defines. "Refresh strategy" (tasks.md F3.1's own phrase) is explicitly not implemented for the same reason — there's no real token to refresh yet.
- `src/pages/LoginPage.tsx` (F3.1) branches on `env.mockAuthEnabled` (F3.4, `VITE_MOCK_AUTH_ENABLED`, defaults `true`): enabled, it's a one-field form (analyst name, no password) that calls `authStore.login()` and navigates to `location.state.from` (the path `ProtectedRoute` redirected from) or `ROUTES.home`; disabled, it shows a plain "authentication isn't available yet" message rather than a form with nothing real behind it. No separate `[BACKEND TODO]`-style empty-state component was pulled forward from F5.13 for this one case — it's a single paragraph, not worth pulling forward a whole shared component for.
- `src/components/ProtectedRoute.tsx` (F3.2) now actually checks `isSessionValid(session)` and renders `<Navigate to={ROUTES.login} state={{from: location.pathname}} replace />` instead of always rendering `<Outlet/>`. This covers route guarding; F3.2's other half — redirecting to `/login` when the *API client* gets a 401 — is `src/api/queryClient.ts`'s global error handler, added in Milestone F4 (see that addendum below).
- `src/components/Navbar.tsx` (F3.3) shows the logged-in analyst's name and a "Log out" button when a session exists (`useAuthStore`'s `logout()` then `navigate(ROUTES.login)`); renders neither when there's no session. Session-*expiry* itself is enforced by `ProtectedRoute` (above), not Navbar — an expired session behaves identically to no session at all.
- Tests: `src/store/authStore.test.ts` (login/logout/`isSessionValid` including the expired-timestamp case), `src/pages/LoginPage.test.tsx` (submits the form, confirms redirect-preservation via `location.state.from`, confirms an empty submission doesn't log in) plus `src/pages/LoginPage.mockAuthDisabled.test.tsx` (a separate file since it needs `vi.mock('@/config/env', ...)` to force the disabled branch — Vite env vars are static per test file), `src/components/Navbar.test.tsx` (logout control visibility + click behavior), and `src/router.test.tsx`'s rewrite (noted above) confirming the redirect-when-unauthenticated / render-when-authenticated split for every protected route.

**Frontend Implementation: Milestone F4 — API Integration Layer.** Every F0 endpoint now has a typed client function and a matching TanStack Query hook; this is the layer every later data-driven milestone (F6 onward) builds its pages on.

- `src/types/api.ts` hand-mirrors `src/t_gnn/api/schemas.py` field-for-field — codegen from F0.15's `/openapi.json` was considered and deferred (decided with the developer implicitly by precedent: the surface is 9 small routers that change rarely, so a generated client would add a build-time dependency without buying much over an explicit file kept in sync by hand, the same tradeoff `schemas.py` itself makes relative to the dataclasses it mirrors). Revisit if the surface grows enough that manual drift becomes a real risk.
- `src/api/client.ts`'s `apiRequest<T>()` is the single `fetch` wrapper every function in `src/api/endpoints.ts` (one per backend route, grouped by router 1:1) goes through. It parses F0.15's `{"error": {code, message}}` envelope into a typed `ApiError` (carrying both the HTTP `status` and the envelope's own `code`, which are the same value for every handler in `app.py` today but aren't guaranteed to stay that way), and wraps a `fetch` that never got a response at all (offline, DNS, CORS, connection refused) in a distinct `ApiNetworkError` rather than conflating the two failure modes. A caller-initiated `AbortError` (TanStack Query cancelling an in-flight request on unmount/refetch) passes through unwrapped so Query's own cancellation handling still recognizes it.
- `src/hooks/api/` has one hook per endpoint: `useMetricsSnapshot`, `useEntityScores`, `useMotifCompletions`/`useMotifResets`, `useMotifFeedback` (list) + `useSubmitMotifFeedback` (mutation), `useEntityForensics` + `usePrunedEdge`, `useAuditLog`, `useProtocolConfig`/`useMotifConfig`, `useHealth`, `useAlertAck` (mutation). Cadence is tuned in three tiers: live-ish data (metrics snapshot, scores, motif completions/resets, audit log) polls every 5-10s as a fallback until F13's live stream is mounted on that page; config (protocol/motif) is near-static (5-minute `staleTime`, no polling) since it only changes via a hand-edited YAML + `reload()`; forensics is historical Neo4j data that never changes once written, so it gets a long/`Infinity` `staleTime` instead. `src/api/queryKeys.ts` centralizes every hook's cache key so `liveStream.ts`'s cache invalidation (below) targets the exact same keys the hooks registered under.
- `src/api/queryClient.ts`'s configured `QueryClient` (wired into `main.tsx`, replacing F1.5's bare default instance) is F4.3/F4.4 together: a shared `shouldRetry()` (retry 5xx/network failures up to 3 attempts with TanStack's default exponential backoff, never retry a 4xx — one policy covers every endpoint including `usePrunedEdge`'s expected-404 case, so no per-hook override was needed) and a `QueryCache`/`MutationCache` `onError` that toasts (`src/components/toast.ts`, F5.11) any failure — but only a query's *first* one (`query.state.data === undefined`), so an already-successful polling query's transient miss during a later refetch doesn't interrupt the user every interval. A 401 additionally calls `useAuthStore.getState().logout()` and `router.navigate(ROUTES.login)` (imperative navigation on the data router instance, not a React component) — this is F3.2's other half, and it's real and tested even though no endpoint returns 401 in practice until F0.11 exists. Mutations opt out of retry entirely (`useSubmitMotifFeedback`, `useAlertAck`) since retrying a POST risks a duplicate submission.
- `src/hooks/api/pagination.ts`'s `toOffsetParams()`/`toPaginatedResult()` are F4.5 — every paginated hook above uses them to convert a `PaginationState` to/from F0.15's `limit`/`offset` envelope. The one real wrinkle: `total` is populated for `audit.log` (a full file scan per request, per `audit.py`'s own docstring) but `null` for scores/motif completions/resets/feedback (no `COUNT(*)` behind those) — `toPaginatedResult()` returns an exact `pageCount` when `total` is known, else a running floor (current page, +1 more once a full page proves another might exist), so `DataTable`'s manual-pagination `pageCount` prop (F5.4) always gets a real number either way.
- `src/api/liveStream.ts`'s `LiveStreamManager` + `useLiveStream()` (F4.6) is a hand-rolled SSE client for F0.10's `GET /api/stream/events`, backed by a new `src/store/liveStreamStore.ts` Zustand store (bounded to the 200 most recent events, for F13.2's raw feed). Deliberately doesn't rely on native `EventSource` auto-reconnect — its fixed ~3s retry with no backoff and no observable connection status doesn't fit a stream whose server side (`stream.py`) already has its own graceful-degradation posture around Postgres hiccups. Every `onerror` (a transport-level drop) closes the connection and schedules the class's own reconnect with exponential backoff (1s → 30s cap, reset to 1s on the next clean `onopen`). Each named SSE event (`motif_completion`/`motif_reset`/`inference_result`/`prune`) pushes into the live-event store *and* invalidates the matching `queryKeys` entry, so any already-mounted list picks up the change through a normal TanStack Query refetch rather than a hand-spliced cache write. `heartbeat` updates a timestamp with no feed entry; the server's own named `error` SSE event (a Postgres hiccup mid-poll, connection itself still alive) is recorded separately from a transport failure (`onerror`) since the two mean different things to a reconnect strategy. `EventSourceLike`/`eventSourceFactory` are a deliberately minimal duck-typed seam (not `Pick<EventSource, ...>`, whose DOM-lib overloads are more than this needs) so tests can inject a fake — jsdom has no native `EventSource`. Not mounted in any page yet, matching F1.4's already-established "installed, tested, not yet wired into a component" posture for a dependency whose consuming milestone (F13) hasn't landed.
- Verified concretely, not just by reading the code: `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run test` (95 tests across 21 files, up from 71/16 pre-F4), and `npm run build` all pass clean.

**Frontend Implementation: Milestone F6 — Executive Dashboard.** The first data-driven page — every earlier milestone either had no real page content (F2/F3's placeholders) or wasn't consumed by one yet (F4's hooks, F5's components). This is where they all come together for the first time.

- `src/features/dashboard/logic.ts` holds every tile's derivation as a pure, directly-tested function, kept separate from the components that render them: `computeSecurityLevel()` (F6.2), `computeThreatStatus()` (F6.3), `computeMonitoringStatus()` (F6.5), plus a shared `tileUnavailableMessage()` every tile uses to turn a failed/absent query into F5.3's `StatCard.unavailable` text (preferring the backend's own error message, e.g. `metrics.py`'s "no metrics snapshot recorded yet" 404 detail, over a generic one). `computeSecurityLevel()` takes the raw (possibly negative) top entity score and takes its own `Math.abs()` internally rather than trusting call sites to — this is deliberate after an actual bug during development: the first version required callers to pass an already-`abs()`'d value, and `SecurityLevelTile.tsx` didn't, silently treating every negative score as "normal" until `logic.test.ts`'s "takes the worse of the two signals" case (a large negative score) caught it.
- `src/features/dashboard/status-pill.tsx`'s `StatusPill`/`DependencyDot` are a small tonal-dot component for infra/monitoring status (F6.2-F6.5), deliberately *not* built on F5.14's `SeverityBadge` — that component's vocabulary (`critical`/`high`/`medium`/`low`/`info`) is specifically threat-detection severity (F9/F10/F11), and "is Postgres reachable" isn't a threat severity, so this reuses the same tonal-dot *visual* pattern without stretching F5.14's *semantic* one.
- Six tile components (`CybersecurityScoreTile`, `SecurityLevelTile`, `ThreatStatusTile`, `SystemHealthTile`, `MonitoringStatusTile`, `LastAnalysisTile`), each an F5.3 `StatCard` wired to its own F4.2 hook call(s) — co-located data-fetching (TanStack Query's usual pattern) rather than `HomePage.tsx` fetching once and threading props down, so one tile's slow or failed query can't block the other five from rendering. `CybersecurityScoreTile` has no hook at all (F0.12 doesn't exist); `SecurityLevelTile` combines `useMetricsSnapshot()` with `useEntityScores({pageIndex: 0, pageSize: 1})` (F0.3's `ORDER BY abs(score) DESC` means page 1 size 1 *is* "the single highest-magnitude entity"); `ThreatStatusTile` and `LastAnalysisTile` both anchor "now" to their query's own `dataUpdatedAt` timestamp rather than a live `Date.now()` call during render — not just a style choice: the React Compiler's purity lint (`react-hooks/purity`) hard-errors on an impure `Date.now()` call inside a component body, and anchoring to `dataUpdatedAt` is arguably more correct anyway (a cached, slightly-stale read shouldn't silently drift its own "recent window" math as wall-clock time passes underneath it).
- `src/pages/HomePage.tsx` (F6.7) assembles all six into a `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3` layout.
- Landing this milestone surfaced and fixed one unrelated flake: `router.test.tsx`'s `/login`-and-`/analytics` cases started intermittently timing out once `HomePage`'s lazy-loaded chunk grew heavier (more hooks/components to transform), because React Router v7's data routers render *nothing* for a route branch containing an unresolved `lazy()` import unless a `HydrateFallback` is defined — previously invisible since every page chunk was small enough to resolve well within `@testing-library`'s default 1000ms `findBy` timeout even under a full-suite run's shared transform load. Fixed at the root: `src/components/RouteHydrateFallback.tsx` (a `RouteErrorBoundary`-style sibling, wired onto `router.tsx`'s two top-level route entries) plus `src/test/setup.ts` raising the suite-wide async timeout to 5000ms via `@testing-library/react`'s `configure()` — a real fix for real (if usually sub-1000ms) dynamic-import latency, not a bug in F6's own code.
- Tests: `logic.test.ts` (every threshold boundary for all three derivations, plus the sign/magnitude bug above), `CybersecurityScoreTile.test.tsx`, `SecurityLevelTile.test.tsx` (all three severity tiers plus the error-message-passthrough case), `SystemHealthTile.test.tsx` (healthy and degraded), and `HomePage.test.tsx` (a smoke test asserting all six tiles render and resolve together). `router.test.tsx` and `queryClient.test.ts`'s existing suites needed no logic changes, only the timeout/fallback fix above. Verified concretely: `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test` (113 tests across 26 files, up from 95/21 pre-F6, stable across repeated full-suite runs) all pass clean. The dev server (`npm run dev`) was started and its served shell confirmed loading correctly; a full visual check of the dashboard's live-backend rendering was not done this pass (no browser-automation tool was available in this session) — the tile-level behavior (loading/success/error/unavailable states) is covered by the component tests above instead.

**Frontend Implementation: Milestone F7 — Threat Analytics.** The second data-driven page (`frontend/src/pages/AnalyticsPage.tsx`, previously a placeholder pointing at Milestone F12) and a new `src/features/analytics/` folder, following F6's exact pure-logic-plus-components split.

- `src/features/analytics/logic.ts`: `classifyEntityScore()` (F7.1/F7.3) reuses `features/dashboard/logic.ts`'s `SECURITY_LEVEL_THRESHOLDS.maxAbsScore` directly (aliased as `THREAT_TIER_SCORE_THRESHOLDS`) rather than a second set of illustrative magnitude constants for the same untrained-model interim proxy -- `elevated`/`critical` become `suspicious`/`malicious`, a distinct 3-tier vocabulary from F5.14's 5-tier `ThreatSeverity` (same "different vocabulary, don't stretch it" reasoning `status-pill.tsx`'s own comment already gives for F6.2-F6.5). `countUserThreatTiers()` (F7.1) filters to `entity_id`s with the `User:` prefix (schema.py's node-id shape) before tallying; `buildSeverityDistribution()` (F7.3) tallies the same tiers over every entity in the sample instead. `buildThreatTrendSeries()` (F7.2) buckets a fixed trailing 24h into hourly buckets -- two series, `attacks` (motif completions by `completed_at`) and `highRiskEntities` (non-benign entity scores by `t`) -- documented in-code as an honest snapshot-in-time proxy rather than a true history, since `entity_scores` is upserted/latest-value-only (this file's F0 addendum). `computeLiveAttackCount()` (F7.4) counts `motif_completion` events in `useLiveStreamStore`'s feed within a 5-minute window, taking the anchor timestamp as a parameter rather than reading `Date.now()` itself, so the calling component can supply a purity-safe anchor.
- `UserThreatCountsPanel.tsx` (F7.1) is an F5.3 `StatCard` rendering the three tier counts via `features/dashboard/status-pill.tsx`'s `StatusPill` (cross-feature reuse of that tone vocabulary, not a duplicate) plus an explicit "Provisional score-threshold buckets ... not a calibrated classification" caption -- tasks.md's F7.1 line requires this not read as ground truth, so the caveat is real UI copy, not just a code comment. Both this component and `ThreatSeverityChart.tsx`/`ThreatTrendsChart.tsx` below call `useEntityScores` with the same `{pageIndex: 0, pageSize: 500}` page (F0.3's `scores.py` caps `limit` at 500) -- TanStack Query's cache dedupes the identical query key, so this is one network request shared across all three, not three redundant ones.
- `ThreatSeverityChart.tsx` (F7.3) renders `buildSeverityDistribution()`'s slices via F5.5's `DonutChart`, colored with the `--status-success/warning/error` CSS custom properties directly (not `charts.tsx`'s default categorical `--chart-1..5` palette) -- this is genuinely severity data, so it earns the severity tokens. `ThreatTrendsChart.tsx` (F7.2) renders `buildThreatTrendSeries()` via F5.5's `TimeSeriesChart`. Both use F5.12's `ChartSkeleton` while loading and F5.13's `EmptyState` (distinguishing a genuine query error, via `features/dashboard/logic.ts`'s `tileUnavailableMessage()`, from a query that succeeded with nothing to show).
- `LiveAttackCounter.tsx` (F7.4) is F4.6's *first* real `useLiveStream()` mount, ahead of Milestone F13's broader "wire every F6/F7/F9 tile up to the live stream" pass (F13.1) -- tasks.md's own F7.4 line names F4.6 as this tile's direct dependency, not a polling fallback. It anchors `computeLiveAttackCount()`'s rolling window to the stream's own `lastHeartbeatAt` rather than a live `Date.now()` read during render (same purity reasoning as F6.3/F6.6's `dataUpdatedAt` anchoring) -- until the first heartbeat arrives there's no safe anchor, so the tile shows its loading/unavailable state instead of guessing with the wall clock.
- `src/pages/AnalyticsPage.tsx` assembles all four under a "Threat Analytics" heading: a two-column row for F7.1/F7.4's `StatCard`s, then a three-column row (F7.2's chart spanning two, F7.3's chart taking the third). Milestones F8 (time-range filtering) and F12 (this page's remaining charts) build further onto this same page/layout.
- Landing F7.4 surfaced two test-infra gaps once a real page/route could mount the SSE client outside of `liveStream.test.ts`'s own hand-injected fake `EventSourceFactory`: jsdom has no `EventSource` global at all, throwing a `ReferenceError` the moment `useLiveStream`'s connect effect ran in any test that didn't explicitly mock `@/api/liveStream` (e.g. `router.test.tsx`'s `/analytics` cases) -- fixed with a no-op `EventSource` stub installed globally in `frontend/src/test/setup.ts` (never opens or emits; tests needing real open/message/error behavior still inject their own fake via `useLiveStream`'s `eventSourceFactory` option, unchanged). Separately, Vitest's own default per-test timeout (5000ms) exactly matched `setup.ts`'s `asyncUtilTimeout` (also 5000ms) -- a latent race between the two that six new test files' added transform/import load made visible as an intermittent full-suite-only failure in `router.test.tsx`'s unrelated login-redirect case; fixed by raising `vite.config.ts`'s `testTimeout` to 10000ms, comfortably clear of the inner wait. Same "found and fixed an unrelated flake while landing this milestone" situation F6.7 documented above, just a different root cause. `router.test.tsx`'s `/analytics` case was also updated for the page's new real heading text ("Threat Analytics", not the old placeholder's "Analytics").
- Tests: `logic.test.ts` (every tier boundary, bucket-window edge, and event-window edge above), `UserThreatCountsPanel.test.tsx`, `ThreatSeverityChart.test.tsx`, `ThreatTrendsChart.test.tsx` (chart-rendering assertions wait on `ChartContainer`'s own `data-chart` wrapper via `waitFor`, not on Recharts-internal content like legend text -- `ResponsiveContainer` never resolves a nonzero size under jsdom, which has no `ResizeObserver`), `LiveAttackCounter.test.tsx` (mocks `@/api/liveStream`'s `useLiveStream` directly, the same API-boundary-mocking convention `SystemHealthTile.test.tsx` already uses for `getHealth`), and `AnalyticsPage.test.tsx` (a smoke test asserting all four panels render together). Verified concretely: `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test` (137 tests across 32 files, up from 113/26 pre-F7, stable across repeated full-suite runs) all pass clean. The dev server (`npm run dev`) was started and `/src/pages/AnalyticsPage.tsx` plus its new dependencies were confirmed to transform without error; a full visual check of the page's live-backend rendering was not done this pass (no browser-automation tool was available in this session), same caveat F6's addendum already notes.

**Frontend Implementation: Milestone F8 — Time-Based Analytics.** Backend-first, unlike F6/F7: F8.1 and F8.4 both needed a real change to `src/t_gnn/api/` before any frontend work could be honest rather than fabricated.

- `src/t_gnn/api_state.py`: a new module-level `_time_range_conditions()`/`_time_range_clause()` pair builds the shared `start`/`end` `WHERE` fragment (unix seconds, inclusive) so `list_entity_scores`/`list_motif_completions` and their new `count_entity_scores`/`count_motif_completions` companions don't each hand-roll it. `count_*` exists because `list_*`'s `limit`-bounded page can't answer "how many total" -- F8.3's exact attack count and F8.5's exact entity-score volume both need it. `src/t_gnn/api/routers/scores.py`/`motifs.py`'s `completions` endpoint both gained `start: float | None`/`end: float | None` query params, computing `Paginated.total` via the new `count_*` method only when either is supplied -- an unfiltered request (F6/F7's original call sites) still gets `total: null`, per F4.5's existing convention, so this is additive, not a breaking change to those.
- `src/t_gnn/api/routers/pilot.py`'s `GET /api/pilot/latest-report` (F8.4) reads `pilot.py --output`'s JSON dump directly (via `deps.py`'s new `pilot_report_path()`, env var `PILOT_REPORT_PATH`, default `pilot-report.json`) rather than importing `pilot.py`'s own classes -- this keeps the always-on API process decoupled from the batch tool's heavier import graph, consistent with F0's "decoupled, stateless reader" architecture decision. 404s cleanly (mirroring `metrics.py`'s "no snapshot recorded" convention) if no report file exists yet, which is the honest default state for this repo (no real pilot evaluation has been run against real labeled traffic, per task 0.4/7.3's existing operational-gap notes). `evaluated_at` is the file's own `stat().st_mtime`, not a field pilot.py's dataclass carries.
- `frontend/src/store/timeRangeStore.ts` (F8.1) is the shared selected-range state -- `{start, end}` in unix seconds, defaulting to the last 24h. `frontend/src/components/time-range-filter.tsx` is a thin `Date`-object adapter onto F5.8's `DateRangePicker`, which already implemented every preset tasks.md's F8.1 line asks for (last hour/24h/7d/30d/custom) -- no changes needed to that component at all. `useEntityScores`/`useMotifCompletions` (F4.2) both gained an optional trailing `range` parameter threading `start`/`end` into the query key and the request; every existing F6/F7 call site that omits it is unaffected (both params come through as `undefined`, dropped by `client.ts`'s `buildUrl()`).
- F7's tiles were updated to actually consume the shared range, closing the loop tasks.md's F8.1 line describes ("applied ... across F7/F9/F11's data hooks" -- F9/F11 don't exist yet, so today this only reaches F7): `UserThreatCountsPanel.tsx`/`ThreatSeverityChart.tsx` just pass `range` through to their existing `useEntityScores` call. `ThreatTrendsChart.tsx` needed a real logic change -- `features/analytics/logic.ts`'s `buildThreatTrendSeries()` was refactored from a fixed "last 24h in hourly buckets" signature to `(completions, scores, start, end, bucketCount = 24)`, deriving `bucketSeconds` as `(end - start) / bucketCount` so a wider selection (e.g. 30 days) still renders a fixed 24 bars instead of trying to draw 720 hourly ones. Bucket labels switch from `HH:mm` to `MMM d` once the selected range exceeds 2 days, since hourly-looking labels stop being meaningful once each bucket spans most of a day. `LiveAttackCounter.tsx` (F7.4) is deliberately untouched -- a rolling "now" window has no "selected range" to apply.
- Five new range-scoped tiles/components in `features/analytics/`, all colocated with F7's rather than a separate folder (still the same `AnalyticsPage.tsx`): `HackersDetectedTile.tsx` (F8.2, `countUserThreatTiers(...).malicious` over the range-filtered sample), `AttacksInRangeTile.tsx` (F8.3, the backend's exact `total` via a `pageSize: 1` request -- the same "just want the envelope's metadata" trick `SecurityLevelTile.tsx` already uses), `ThreatRateTile.tsx`/`AvgAnomaliesPerHourTile.tsx` (F8.4/F8.5, both call `logic.ts`'s new `computeRatePerHour(count, start, end)`, one new shared function rather than two near-duplicate ones), and `DetectionRateTile.tsx` (F8.4, a new `usePilotReport()` hook hitting the new endpoint -- deliberately not wired to the time-range store at all, per tasks.md's own "not live"/"last pilot evaluation" instruction: a pilot report is a whole-dataset batch result, not a per-range-recomputable one).
- `src/pages/AnalyticsPage.tsx` gained `TimeRangeFilter` at the top (next to the page heading) and a new five-column tile row below F7's existing content for F8.2-F8.5.
- Landing F8.1 hit the same class of flake F6.7 and F7 each already fixed a different root cause of: `router.test.tsx`'s unauthenticated `/analytics` case still has to resolve `AnalyticsPage`'s `lazy` module during route matching before `ProtectedRoute` can redirect it, and that module's dependency graph (Recharts + `react-day-picker` + nine feature components, several of which other test files now also transform concurrently) grew heavy enough that F7's 10000ms `testTimeout` bump stopped being sufficient under a full-suite run. Raising `testTimeout` alone (tried first, up to 45000ms) did not help, which is what correctly identified the real bottleneck: `src/test/setup.ts`'s `asyncUtilTimeout` (`@testing-library/react`'s own internal `findBy*`/`waitFor` polling budget) -- a *different* knob than `testTimeout` (the outer per-test safety net) -- was still 5000ms and is what actually governs how long `findByRole` etc. will keep polling. Raised to 20000ms, with `testTimeout` set to 25000ms (comfortably above it, preserving the "outer timeout never fires first" invariant F7's fix established).
- Tests: `logic.test.ts`'s `buildThreatTrendSeries` suite rewritten for the new `(start, end)` signature (bucket-count invariance across a 1-day vs. 1-week range, inclusive-`end`-boundary handling) plus a new `computeRatePerHour` suite; `timeRangeStore.test.ts`; `time-range-filter.test.tsx`; one test per new tile (`HackersDetectedTile`/`AttacksInRangeTile`/`ThreatRateTile`/`AvgAnomaliesPerHourTile`/`DetectionRateTile`); `UserThreatCountsPanel.test.tsx`/`ThreatSeverityChart.test.tsx`/`ThreatTrendsChart.test.tsx` each gained a case asserting the range is actually threaded through to the mocked endpoint call, not just that data renders; `AnalyticsPage.test.tsx` updated for the new heading/filter/tiles. Backend: `tests/test_api.py` gained `start`/`end`-filtering + exact-`total` cases for both endpoints plus `GET /api/pilot/latest-report` 404/200 cases (via `FakeApiState`'s new `count_*` methods and a `tmp_path`-overridden `pilot_report_path()`); `tests/test_api_state.py` gained live-Postgres round-trips for both new `count_*` methods. Verified concretely: the full backend `pytest` suite (284 passed, 2 skipped -- Neo4j/Redis-dependent tests, live Postgres was reachable and exercised), and on the frontend, `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test` (158 tests across 39 files, up from 137/32 pre-F8, stable across three repeated full-suite runs) all pass clean. The dev server (`npm run dev`) was started and `AnalyticsPage.tsx`/`time-range-filter.tsx`/`timeRangeStore.ts` were confirmed to transform without error; a full visual check of the page's live-backend rendering was not done this pass (no browser-automation tool was available in this session), same caveat F6/F7's addenda already note.

**Frontend Implementation: Milestone F9 — Detection Matrix.** No backend changes needed this time -- F0.3/F0.4 and F9.5's feedback endpoint (added ahead of schedule during F0) already carried everything this milestone needed; purely a frontend consumer of existing API surface.

- `src/features/detections/logic.ts` is the pure-derivation layer, same split every earlier milestone's `logic.ts` established. `DetectionRow` is the unified shape both detection paths map onto. `severityFromMotifConfidence()` floors at "medium" (never "low"/"info") since a motif completion is a confirmed structural match, not a raw statistical outlier -- even Backlog B.4's fuzzy, low-confidence matches still represent *a* pattern match. `severityFromAnomalyScore()`/`ANOMALY_SEVERITY_THRESHOLDS` interpolate F6.2/F7.1's exact `elevated`/`critical` anchors into 4 steps rather than a fourth set of unreviewed magic numbers, deliberately anchored so `low` equals `elevated` exactly -- the point at which `buildAnomalyDetectionRows()` starts including a score at all lines up exactly with F7.1/F8.2's existing "non-benign" cutoff, so the Detection Matrix and the Analytics page can't silently disagree about what counts as a detection worth surfacing.
- `buildMotifDetectionRows()` (F9.2) is the direct field mapping tasks.md's own line specifies. `buildAnomalyDetectionRows()` (F9.3) filters `EntityScoreOut[]` to `trigger === "scheduled"` -- a `motif_completion`-triggered rescoring (tgnn.py's fast path, 5.3) is a side effect of a completion `buildMotifDetectionRows` already lists, so including it too would double-count the same underlying event as two rows. `motifDetectionModel()`/`TGNN_DEVIATION_MODEL` (F9.4) are the only two detection-model values that exist in this repo, matching that task's explicit "don't invent additional model names."
- `buildDispositionsByKey()` (F9.5) keys on `(motif_name, chain_key)` -- `motif_feedback`'s actual key shape (`MotifFeedbackEvent`, feedback.py) -- taking the first (newest, given `list_motif_feedback`'s `ORDER BY noted_at DESC`) entry per key, so an analyst's later correction overrides an earlier disposition rather than the reverse. `buildDetectionRows()` merges both paths and sorts newest-first; `uniqueCategories()`/`filterDetectionRows()` back F9.6.
- `src/features/detections/columns.tsx`'s `detectionColumns` (F9.1, an F5.4 `ColumnDef[]`) renders `SeverityBadge`/`DispositionBadge`/`InvestigationStatusBadge` (F5.14) per row. Its `DispositionCell` is F9.5's real writable half: for a motif-path row it renders `DispositionBadge` plus "TP"/"FP" buttons calling F4's already-existing `useSubmitMotifFeedback()` (with `useAuthStore`'s mock-auth `analyst` as attribution) -- the mutation's existing `onSuccess` invalidation of the feedback query means the badge updates immediately with no extra wiring needed here. For an anomaly-path row (no `motifName`/`chainKey` on the row at all) it renders the badge alone plus an explanatory "n/a" instead of buttons that would have nowhere real to submit to -- `motif_feedback` has no schema concept for a non-motif detection. The Investigation column is a static "New" `InvestigationStatusBadge` for every row: F5.14's own comment already says no backend field for this exists anywhere, so this doesn't fabricate interactivity backed by nothing.
- `src/pages/DetectionsPage.tsx` fetches the top-500 (F0's max page size) most recent motif completions, entity scores, and feedback records -- same honest "sample, not exhaustive history" posture F7/F8 already established for the Analytics page, stated in the page's own caption, not just a code comment. Filtering (F9.6) is three `Select` controls (severity/status/category, the last populated dynamically from `uniqueCategories()`) feeding `filterDetectionRows()` over the client-side-merged sample, with active selections surfaced via F5.6's `FilterBar` chip display; sorting is F5.4's `DataTable`'s already-generic column sort, needing no Detection-Matrix-specific code at all.
- Tests: `logic.test.ts` (every severity boundary on both paths, the exact-anchor-alignment case for `ANOMALY_SEVERITY_THRESHOLDS.low`, disposition-lookup newest-wins, the `motif_completion`-trigger exclusion, merge/sort, and all three filter dimensions) and `DetectionsPage.test.tsx` (merged-row rendering, the anomaly-path "n/a" case, a real TP-button-click round-trip through the mocked `submitMotifFeedback` with the logged-in analyst's name attached, and the empty-filtered-state case). Verified concretely: `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test` (182 tests across 41 files, up from 158/39 pre-F9, stable across three repeated full-suite runs) all pass clean. The dev server (`npm run dev`) was started and `DetectionsPage.tsx`/`columns.tsx`/`logic.ts` were confirmed to transform without error; a full visual check of the page's live-backend rendering was not done this pass (no browser-automation tool was available in this session), same caveat every prior milestone's addendum already notes.

**Frontend Implementation: Milestone F10 — User Investigation.** Backend-first again, like F8: F10.1/F10.3/F10.5 each needed a real addition to `src/t_gnn/api/` before the frontend could be honest about what data actually exists per entity.

- `src/t_gnn/forensics.py`'s `Neo4jForensicQueryAPI.list_entities()`/`count_entities()` (F10.1) are new Cypher queries over the same `Entity` nodes `cold_storage.py`'s write path already creates -- `MATCH (e:Entity) WHERE $type_prefix IS NULL OR e.id STARTS WITH $type_prefix ...`, sorted, `SKIP`/`LIMIT`-paginated. This is the only one of tasks.md's own two named F10.1 options actually available to this process (it never holds a live `ActiveGraphStore`, per F0's decoupled-process decision) -- so an entity with only currently-active (not-yet-pruned) edges has no `Entity` node yet and won't appear until at least one of its edges is pruned. `src/t_gnn/api/routers/entities.py`'s `GET /api/entities?type=<Type>` wraps this, converting `type=User` to the `"User:"` prefix Cypher's `STARTS WITH` actually matches on.
- `ApiStateReader.get_entity_score()` (F10.3) is a plain primary-key `SELECT ... WHERE entity_id = %s` -- `entity_scores.entity_id` already is the primary key, so this is a real point lookup, not a linear scan. `GET /api/scores/entities/{entity_id}` (`routers/scores.py`) 404s cleanly if the entity has never been scored, mirroring `metrics.py`'s "no snapshot" convention. Added because `list_entity_scores`'s |score|-ranked, `limit`-bounded page can genuinely omit a real entity (e.g. one with a small-magnitude score) that a specific investigation still needs to show.
- `list_motif_completions`/`count_motif_completions` (`api_state.py`) and `/api/motifs/completions` (F10.5) gained an optional `chain_key` filter, the same additive-not-breaking shape F8.1's `start`/`end` params already established (existing unfiltered call sites are unaffected; `total` is now also computed whenever `chain_key` is set, not just `start`/`end`). This is how the Investigation page finds *every* motif a specific entity has ever triggered, not whatever a `pageSize`-bounded unfiltered sample happens to contain.
- `frontend/src/hooks/api/useMotifCompletions.ts`'s signature changed from three positional optional params to one options object (`{motifName?, chainKey?, range?}`) -- positional args stopped scaling once this milestone added a third independent filter; every F7/F8/F9 call site was updated to match (`{ range }` instead of `undefined, range`), no behavior change. `useEntities()` (F10.1) and `useEntityScore()` (F10.3, added alongside `useEntityScores.ts`'s existing list hook) are new.
- `frontend/src/config/routes.ts`'s `ROUTES.users` (`/investigation`, F10.2) extends F2.1's own `/investigation` path family rather than inventing a new top-level route that milestone never reserved -- unlike the sibling `:entityId` detail route, this one has no dynamic segment and is a legitimate static `NAV_ROUTES` destination (a new "Users" entry, `router.tsx` gained a matching sibling child route).
- `frontend/src/pages/UserListPage.tsx` (F10.1) fetches up to 500 `User:*` entities and filters them client-side via F5.7's `SearchBar` (debounced) -- the backend has no text-search query param, and a few hundred entity ids is small enough that this is simpler than adding one. Each row links to `investigationPath()`.
- `frontend/src/pages/InvestigationPage.tsx` assembles F10.3 (a `StatCard` reusing `features/analytics/logic.ts`'s existing `classifyEntityScore()`/`THREAT_TIER_LABEL` -- the same provisional 3-tier classification F7.1 established, not a second one), F10.4/F10.6 (one `DataTable` titled "Activity Timeline / Log History," not two panels -- tasks.md's own F10.6 line forbids implying a second data source), F10.5 (a `DataTable` of `chain_key`-filtered motif completions -- deliberately not a second "deviation signals" panel, since `entity_scores`'s upserted/latest-value-only shape means there's no historical list of past deviation events to show beyond the single latest score F10.3 already displays), and F10.7-F10.9 (three `BackendPendingState` panels naming F0.13; F10.9's description explains *why* it's pending -- no product decision on deriving-vs-backing a session concept, not just "blocked" -- since that line explicitly forbids fabricating session boundaries in the meantime). `features/investigation/logic.ts`'s `FULL_HISTORY_WINDOW` is a fixed `{start: 0, end: 9_999_999_999}` constant (not a `Date.now()`-anchored one) so the timeline query has a well-defined default with no page-level time-range control to source one from, while keeping the module free of a render-time clock read.
- `frontend/src/components/relative-timestamp.tsx`'s `RelativeTimestamp` was extracted from a component-local helper F9's `columns.tsx` already had, once F10's `columns.tsx` needed the identical "X ago, with the absolute time on hover" rendering a second time -- both files now import the shared one. F9's Detection Matrix `source` column and F10's timeline "Activity" column both gained real `investigationPath()` links, the first working "reached from elsewhere" traffic to the drill-down route `config/routes.ts`'s own comment already described but nothing had linked to yet.
- Tests: `features/investigation/logic.test.ts` (`entityType()`'s prefix parsing, `FULL_HISTORY_WINDOW`'s shape), `components/relative-timestamp.test.tsx`, `pages/UserListPage.test.tsx` (link rendering, debounced client-side search, the error-state message), `pages/InvestigationPage.test.tsx` (all three panels rendering together for a real entity, plus the never-scored 404 case), and a `router.test.tsx` addition covering the new `/investigation` list route and `NAV_ROUTES` entry. Backend: `tests/test_api.py`/`test_api_state.py` gained cases for the point-lookup score endpoint, the `chain_key` filter, and `/api/entities`; `tests/test_forensics.py` gained live-Neo4j cases for `list_entities()`/`count_entities()` (using a per-test-unique type-prefix string, since the shared dev Neo4j instance already has other `User:*` entities from earlier tests/pipeline runs, and there's no per-test cleanup fixture in that file to isolate against). Verified concretely: the full backend `pytest` suite (294 passed, 2 skipped -- Neo4j/Redis-dependent tests unrelated to this milestone, live Postgres and Neo4j were both reachable and exercised), and on the frontend, `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test` (192 tests across 45 files, up from 182/41 pre-F10, stable across three repeated full-suite runs) all pass clean. The dev server (`npm run dev`) was started and `UserListPage.tsx`/`InvestigationPage.tsx`/`useEntities.ts` were confirmed to transform without error; a full visual check of the pages' live-backend rendering was not done this pass (no browser-automation tool was available in this session), same caveat every prior milestone's addendum already notes.

**Frontend Implementation: Milestone F11 — Log Explorer.** Backend-first again for its search/filter half (F11.1/F11.2), the same shape F8/F10 already took, since `audit.py`'s `read_records()` had no text-search or `until`/`entity` filtering to build on top of.

- `src/t_gnn/audit.py`'s `read_records()` gained three params: `q` (a new `_record_matches_query()` helper -- case-insensitive substring match against every string field on a record, including each entry of `matched_edges`), `until` (paired with the existing `since`, same inclusive-both-bounds shape `api_state.py`'s F8.1 `_time_range_clause` already established), and `entity` (exact match against a prune record's `src`/`dst` or a motif-reset's `chain_key`, the same shape F10.5's `chain_key` filter took). All three compose with the existing `since`/`record_type` filters via plain `and`-chained `continue`s in the same scan -- `read_records()` already read the whole file into memory per request (its own docstring's "full scan is cheap at this volume" posture), so none of this added a second pass. `src/t_gnn/api/routers/audit.py`'s `GET /api/audit/log` gained the matching `until`/`entity`/`q` query params, additive to F0.8's existing `since`/`type`/`limit`/`offset` -- every pre-F11 call site is unaffected.
- `frontend/src/features/logs/logic.ts` is the pure-derivation layer, same split every earlier milestone's `logic.ts` established. `classifyLogSeverity()` (F11.4) floors every `motif_reset` record at `MOTIF_RESET_SEVERITY = 'medium'` (a discarded partial detection chain is never routine housekeeping -- the same "a structural match is never low-severity" floor F9's `severityFromMotifConfidence()` uses) and derives a `prune` record's severity from `w_at_prune` via `classifyPruneSeverity()`/`PRUNE_SEVERITY_THRESHOLDS` (illustrative, not calibrated, same posture as every other provisional threshold in this repo -- pruned while still highly weighted implies a memory-pressure eviction cutting off still-relevant history, not an edge that simply finished decaying). `summarizeLogRecord()`/`logRecordEntity()`/`logRowKey()` build a `LogRow` (`toLogRow()`) from either record type; `motifResetEventToAuditRecord()` adapts F0.10's live-stream `MotifResetOut` payload (Postgres-sourced, from `ApiStateReader.list_motif_resets_since()`) into the audit log's own `AuditRecordOut` shape (file-sourced, from `FileAuditSink`) so both a fetched page and a live event render through the same `LogRow`/`SeverityBadge`/summary path. `matchesQuery()`/`matchesEntity()`/`matchesLogFilters()` mirror the backend's own `q`/`entity`/time-range filtering client-side, used only for judging whether a not-yet-fetched live event belongs in F11.7's preview under the page's current filters -- the fetched page itself is always filtered server-side. `logsToCsv()`/`logsToJson()` (F11.5) are plain string builders with no DOM dependency, kept testable; the actual `Blob`/`URL.createObjectURL` download trigger is a small `downloadFile()` helper local to `LogsPage.tsx` (the one DOM-touching piece, deliberately not in the pure `logic.ts` module).
- `frontend/src/features/logs/columns.tsx`'s `createLogColumns()` (F11.1/F11.4) takes an `onViewRaw` callback rather than owning dialog state itself -- the same composed-stateful-cell-but-not-page-state split F9's `DispositionCell`/`DetectionsPage.tsx` already established. A leading "New" pill column (F11.7) renders only for rows flagged `isNew`; severity renders via F5.14's existing `SeverityBadge` (no new badge vocabulary needed since `ThreatSeverity` already covers "medium"/"low"/"info"); the entity column links to `investigationPath()`, F9/F10's established drill-down convention. `frontend/src/features/logs/raw-log-dialog.tsx`'s `RawLogDialog` (F11.3) is a shadcn `Dialog` (F5.9) rendering `JSON.stringify(row.record, null, 2)` in a `<pre>` -- the literal raw record, not a second, re-derived view of it, per this task's own instruction.
- `frontend/src/hooks/api/useAuditLog.ts` gained `until`/`entity`/`q` on its filters object (mirroring the backend/`endpoints.ts` additions) and a new `UseAuditLogOptions.refetchInterval` override (default `10_000`, unchanged for every other consumer -- there are none yet, but the option exists for exactly this milestone's need) -- F11.7's page passes `false` to opt out of F4.2's normal polling refresh, since that refresh would otherwise silently reorder the visible page every 10s independent of the live stream. `frontend/src/api/liveStream.ts`'s `prune` SSE handler had its `invalidateQueries({queryKey: ['audit', 'log']})` call removed entirely (the only place in `liveStream.ts` that queries a key with zero live consumers other than this page) -- a comment at the call site explains why, and `liveStream.test.ts` gained a case asserting a `prune` event pushes into the store without triggering that invalidation.
- `frontend/src/pages/LogsPage.tsx` assembles all of the above: F5.7's `SearchBar` (query), a plain `Input` (entity), a `Select` (type), and F8.1's existing `TimeRangeFilter`/`useTimeRangeStore` (time range, reused unchanged, not a second store) behind F5.6's `FilterBar` chips; a `DataTable` (F5.4) in server-driven-pagination mode (F11.6) with `createLogColumns()`; F11.5's two export buttons, captioned as covering only the current fetched page; and F11.7's "N new events -- Refresh" banner plus prepended `isNew` rows, computed by intersecting `useLiveStreamStore`'s event feed against the currently active filters and the already-fetched page's own row keys (so an event already visible via a normal fetch is never double-counted as "new"). No route changes needed -- `/logs` and its `NAV_ROUTES` entry already existed from F2.
- Tests: `features/logs/logic.test.ts` (every severity threshold boundary on both record types, summary/entity/key derivation for both record types, the stream-event-to-audit-record adapter, query/entity/combined-filter matching, and CSV quoting/list-joining plus JSON round-tripping), `api/liveStream.test.ts`'s new no-invalidation case, and `pages/LogsPage.test.tsx` (rendering both record types with correct severity, the empty state, opening the raw-log dialog, search/entity filters re-querying the mocked endpoint with the right params, and the live "new event" banner/prepended-row/no-extra-fetch behavior together). Backend: `tests/test_audit.py` gained `until`/`entity`/`q` cases for `read_records()` (including matching inside `matched_edges` list entries) and `tests/test_api.py` gained the matching HTTP-layer cases for `/api/audit/log`. Verified concretely: the full backend `pytest` suite (291 passed, 13 skipped -- Neo4j/Redis-dependent tests across the suite, unrelated to this milestone; the local `docker compose` stack was paused when this pass started, briefly unpaused to let those tests exercise real Postgres/Neo4j/Redis, then re-paused afterward to leave the developer's environment as found), and on the frontend, `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test` (227 tests across 47 files, up from 192/45 pre-F11) all pass clean. The dev server was not separately started this pass beyond the build/test verification above -- same "no browser-automation tool available" caveat every prior milestone's addendum already notes, so a full visual check of the page's live-backend rendering was not done.

**Frontend Implementation: Milestone F12 — Analytics Visualizations.** Purely a frontend consumer of existing API surface, like F9 -- F0.3/F0.4/F8.4's endpoints already carried everything the five new charts needed, no backend changes at all.

- Three of the eight tasks needed no new component: F12.1 (threat timeline), F12.2 (attacks-per-day), and F12.4 (severity pie chart) each name an F7 dependency in their own tasks.md line (`ThreatTrendsChart`/F7.2, `ThreatSeverityChart`/F7.3) that already *is* the chart being asked for, already rendered on this same `AnalyticsPage.tsx`. `AnalyticsPage.tsx`'s own comment documents this reasoning inline, not just in tasks.md, so a future reader of the component doesn't wonder where three of eight charts went.
- `frontend/src/features/analytics/logic.ts` gained five new pure functions, same split every earlier milestone's `logic.ts` established. `buildDetectionAccuracyRows()` (F12.3) reshapes `pilot.py`'s `PilotReportOut` into percentage rows, dropping a `null` precision/recall (a zero-denominator case) rather than charting it as a misleading 0%. `buildAttackFrequencyGrid()` (F12.6) combines F0.4 motif completions and F0.3's non-benign entity scores -- the same "attacks" definition `buildThreatTrendSeries` already uses for its own two series -- into a 7x24 UTC day-of-week x hour-of-day frequency grid; UTC (via `getUTCDay()`/`getUTCHours()`) rather than the browser's local timezone, so the grid doesn't silently disagree between two analysts in different timezones. `buildTopTargetedResources()` (F12.7) is documented as a deliberate deviation from tasks.md's own literal "`dst`" wording: neither `MotifCompletionOut` nor `EntityScoreOut` -- the two endpoints this task's own line scopes the chart to -- carries a `dst` field (it only exists on `Edge`/`PrunedEdgeRecord`, reachable only via a per-matched-edge forensics lookup that would mean N+1 requests on every chart render); it tallies `Machine:*` `chain_key`s from completions (the pivot/target machine for seed motifs like `lateral_pivot`) plus `Machine:*` `entity_id`s from non-benign scores instead. `buildAttackPatternCounts()` (F12.8) is a plain tally by whatever `motif_name` values appear in the fetched completions -- no hardcoded motif list, so it scales automatically as `config/motifs.yaml`'s library grows, per that task's own instruction. `TargetedResourceCount`/`AttackPatternCount` are `type` aliases rather than `interface`s for the same reason `SeverityDistributionSlice`/`ThreatTrendPoint` already are (`CategoryBarChart`'s `T extends Record<string, unknown>` constraint needs the implicit index signature only an object-literal type alias gets).
- Five new components in `features/analytics/`, each following F7/F8's established `Card` + loading-skeleton + chart-or-empty-state shape: `DetectionAccuracyChart.tsx` (F5.5's `CategoryBarChart`, reusing F8.4's existing `usePilotReport()` hook -- same report `DetectionRateTile` already summarizes as one line, same "as of last pilot evaluation ... -- not live" caption, not a second disagreeing source; its error branch is the one that actually fires for "no pilot run yet" in practice, since a point-fetch endpoint has no "succeeded but empty" state the way a list endpoint does -- a separate, rarer empty state covers the case where a report exists but neither path had a computable precision/recall), `GeographicAttackMapCard.tsx` (a `Card` wrapping F5.13's `BackendPendingState` naming F0.14, the same pattern F10.7-F10.9 already use), `AttackFrequencyHeatmap.tsx` (F5.5's `HeatmapChart`, built with this exact chart in mind per that component's own comment), `TopTargetedResourcesChart.tsx` and `AttackPatternsChart.tsx` (both F5.5's `CategoryBarChart` in `layout="horizontal"` mode, better suited to their longer category labels than the default vertical-column layout). All four data-driven charts read `useTimeRangeStore`'s shared range (F8.1) and sample the same backend max page size (500) `ThreatTrendsChart`/`ThreatSeverityChart` already do, with the same honest "sample, not exhaustive" posture.
- `frontend/src/pages/AnalyticsPage.tsx` gained a new "Visualizations" heading and grid at the bottom of the page for the five new components; its leading comment was extended to explain the F12.1/F12.2/F12.4 reuse decisions inline.
- Tests: `features/analytics/logic.test.ts` gained suites for all five new pure functions (percentage conversion and null-dropping for detection accuracy; grid dimensions, UTC bucketing, and benign-score exclusion for the heatmap; Machine-prefix filtering, non-Machine/benign exclusion, and sort+limit for targeted resources; tally-and-sort plus the no-hardcoded-list guarantee for attack patterns). One test file per new component (rendering + empty-state cases, mocking `@/api/endpoints` the same way every earlier `features/analytics/*.test.tsx` file does) plus a `AnalyticsPage.test.tsx` update asserting all five new panels render alongside F7/F8's existing ones. Verified concretely: `npx tsc -b --noEmit`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm run test` (249 tests across 52 files, up from 227/47 pre-F12) all pass clean. No backend changes this milestone, so the backend `pytest` suite wasn't re-run beyond what F11's pass already confirmed. The dev server was not separately started this pass -- same "no browser-automation tool available" caveat every prior milestone's addendum already notes, so a full visual check of the new charts' live-backend rendering was not done.
