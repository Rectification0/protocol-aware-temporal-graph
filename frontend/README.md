# t-gnn SOC Dashboard — Frontend

React + TypeScript + Vite dashboard for the Protocol-Aware Asymmetric Decay
T-GNN threat-detection system. Tracked as Milestones F0-F17 in the root
repo's `tasks.md` ("Frontend Implementation — React SOC Dashboard" section,
`frontend_implementation` branch only). See the root `CLAUDE.md`'s frontend
addendum for architecture decisions and current milestone status.

## Stack (decided in Milestone F1)

- **Vite + React + TypeScript**
- **React Router** (`react-router-dom@7`, data router) — routing + app shell, Milestone F2
- **TanStack Query** — server-state layer (API data fetching/caching), consumed by Milestone F4's hooks
- **Zustand** — client-state store, for state that isn't server data (e.g. UI toggles)
- **Recharts** — charting library for Milestone F12's analytics/visualizations
- **ESLint + Prettier** — lint/format, enforced on commit via **Husky + lint-staged**
- **Vitest + React Testing Library** — unit/component tests

## Routing & app shell (Milestone F2)

Routes live in `src/config/routes.ts` (`ROUTES`) and `src/router.tsx`
(`routes`/`router`). Every page is code-split via React Router's `lazy`
route field. `src/components/AppShell.tsx` (Navbar + Sidebar + `<Outlet/>`)
wraps every route except `/login`.

## Authentication (Milestone F3)

Real backend auth (tasks.md F0.11) doesn't exist yet, so this is
mock-auth only: `src/store/authStore.ts`'s Zustand store holds a
`{analyst, expiresAt}` session in memory (no localStorage — a reload
returns you to `/login`). `src/pages/LoginPage.tsx` is a one-field form
(analyst name, no password — there is no real credential store to check
against) gated by `VITE_MOCK_AUTH_ENABLED` (default `true`).
`src/components/ProtectedRoute.tsx` redirects to `/login` when the
session is missing/expired, preserving the originally-requested path;
`src/components/Navbar.tsx` shows a "Log out" control once logged in.
Redirecting on a 401 from the API client (the other half of tasks.md
F3.2) is now wired via Milestone F4's `queryClient.ts` (see below) — no
endpoint actually returns 401 yet (F0.11's real auth is still undone), so
this path is tested but currently unexercised by the live app.

## API integration (Milestone F4)

`src/types/api.ts` hand-mirrors the backend's `schemas.py` response/request
shapes (OpenAPI codegen was considered and deferred — the surface is small
enough that an explicit, hand-kept-in-sync file beats a generated-client
build dependency for now). `src/api/client.ts`'s `apiRequest()` is the one
`fetch` wrapper every endpoint function in `src/api/endpoints.ts` goes
through — it parses the backend's `{"error": {code, message}}` envelope
into a typed `ApiError`, and distinguishes a real error response from
`ApiNetworkError` (fetch never reached a server at all).

`src/hooks/api/` has one TanStack Query hook per endpoint (`useMetricsSnapshot`,
`useEntityScores`, `useMotifCompletions`/`useMotifResets`/`useMotifFeedback`,
`useEntityForensics`/`usePrunedEdge`, `useAuditLog`, `useProtocolConfig`/
`useMotifConfig`, `useHealth`, `useAlertAck`), each tuned with a
`staleTime`/`refetchInterval` matching how often that data actually
changes — polling for live-ish data, near-static for config, `Infinity`
for immutable historical (forensics) records. `src/hooks/api/pagination.ts`
converts a `PaginationState` to the backend's `limit`/`offset` query params
and back into a result shape `src/components/data-table.tsx` (F5.4) can
render directly, including a fallback `pageCount` estimate for the
endpoints whose response envelope omits a `total`.

`src/api/queryClient.ts` is the configured `QueryClient` used by
`main.tsx`: a shared retry policy (retry 5xx/network failures up to 3
attempts with backoff, never retry a 4xx; mutations never auto-retry, to
avoid double-submitting a POST), and a global `onError` that toasts a
query's first failure (not every background refetch miss) and forces a
logout + redirect-to-`/login` on a 401.

`src/api/liveStream.ts`'s `LiveStreamManager`/`useLiveStream()` (backed by
`src/store/liveStreamStore.ts`, a Zustand store of recent events +
connection status) is a hand-rolled SSE client for the backend's
`GET /api/stream/events` — deliberately not relying on native `EventSource`
auto-reconnect, so it can back off exponentially (1s → 30s cap) and expose
connection status. Each event both lands in the live-event store and
invalidates the matching TanStack Query key. Not mounted anywhere yet —
Milestone F13 (Live Monitoring) is what wires it into a page — same
"installed, not yet consumed" posture Milestone F1 already established for
Recharts/Zustand.

## Executive Dashboard (Milestone F6)

`src/pages/HomePage.tsx` is the first real page: a responsive grid of six
`src/features/dashboard/` tiles, each an F5.3 `StatCard` fetching its own
data via an F4.2 hook. `src/features/dashboard/logic.ts` has each tile's
derivation as a pure, unit-tested function — the cybersecurity-score tile
has none (it stays behind an empty-state until tasks.md F0.12 exists);
security-level and active-monitoring both use documented-as-provisional
threshold constants (an interim proxy until F0.12 lands); threat-status
and last-analysis both anchor "now" to their query's own `dataUpdatedAt`
rather than a live `Date.now()` read during render, per the React
Compiler's purity rule. `src/features/dashboard/status-pill.tsx` is a
small tonal-dot component for infra/monitoring status, distinct from
F5.14's `SeverityBadge` (a different vocabulary — threat severity, not
system health).

## Threat Analytics (Milestone F7)

`src/pages/AnalyticsPage.tsx` (previously a Milestone-F12 placeholder) is
the second data-driven page, backed by a new `src/features/analytics/`
folder following F6's same pure-logic-plus-components split.
`logic.ts`'s score-magnitude tiers (`benign`/`suspicious`/`malicious`,
F7.1/F7.3) deliberately reuse F6.2's exact interim-proxy thresholds under
new names rather than a second set of unreviewed magic numbers — still
provisional pending F0.12, and the UI itself (`UserThreatCountsPanel`'s
caption), not just code comments, says so. F7.2's trend chart and F7.4's
live attack counter are documented in `logic.ts` as honest snapshot-in-
time proxies, not true histories, given `entity_scores`'s
upserted/latest-value-only shape. `LiveAttackCounter.tsx` is F4.6's SSE
stream's first real mount — ahead of Milestone F13's broader live-wiring
pass — which required two test-infra fixes: a no-op `EventSource` stub in
`src/test/setup.ts` (jsdom has none) and a `vite.config.ts` `testTimeout`
bump to clear a latent race with `setup.ts`'s own `asyncUtilTimeout`.

## Time-Based Analytics (Milestone F8)

Still `AnalyticsPage.tsx` — F8 adds a shared time-range filter and five
range-scoped metrics on top of F7's page, not a new route. `src/store/
timeRangeStore.ts` (Zustand) holds the selected `{start, end}` (unix
seconds); `src/components/time-range-filter.tsx` adapts it to F5.8's
`DateRangePicker`, which already implemented every preset this needed —
no changes to that component. This required a real backend change first:
`/api/scores/entities`/`/api/motifs/completions` gained optional
`start`/`end` query params plus an exact `COUNT(*)`-backed `total` when
either is supplied (unfiltered requests still get `total: null`, so F6/F7's
original call sites are unaffected). F7's own tiles were updated to read
the shared range too — `ThreatTrendsChart`'s bucket math was generalized
from a fixed "24 hourly buckets" to a fixed bucket _count_ spread evenly
across whatever range is selected. F8.4's "detection rate" needed a
second backend addition: `GET /api/pilot/latest-report`, reading whatever
file `pilot.py --output` was pointed at (`PILOT_REPORT_PATH`, default
`pilot-report.json`) rather than importing `pilot.py` itself, keeping the
API process decoupled from that batch tool's heavier import graph.

Landing F8.1 hit the same class of flake F6.7/F7 each already fixed a
different root cause of, made worse by `AnalyticsPage`'s now-heavier
dependency graph: raising `vite.config.ts`'s `testTimeout` alone (tried
first) didn't help, because the actual bottleneck was `src/test/
setup.ts`'s `asyncUtilTimeout` — a different knob (the outer per-test
timeout vs. `@testing-library/react`'s own internal polling budget) —
still at its old value. Both are now set with a comfortable margin
between them (`asyncUtilTimeout` 20000ms, `testTimeout` 25000ms).

## Detection Matrix (Milestone F9)

`src/pages/DetectionsPage.tsx` + `src/features/detections/` — a new page,
no backend changes needed (F0.3/F0.4/F9.5's feedback endpoint already
covered everything). `logic.ts` merges both detection paths into one
`DetectionRow` shape: motif completions (F9.2, direct field mapping) and
`trigger === "scheduled"` entity scores past the same non-benign bar F7.1
already uses (F9.3) — a `motif_completion`-triggered rescoring is
excluded since it's a side effect of a completion already listed, not a
second detection. Severity (F5.14's 5-tier vocabulary) floors motif-path
confidence at "medium" (a structural match is never low-severity) and
interpolates F6.2/F7.1's exact thresholds for the anomaly path, anchored
so the "worth listing at all" cutoff matches F7.1's "non-benign" bar
exactly. `columns.tsx`'s `DispositionCell` is F9.5's real writable
half — TP/FP buttons via F4's existing `useSubmitMotifFeedback()` — for
motif-path rows only, since `motif_feedback` has no schema concept for
the anomaly path (those rows show an explanatory "n/a" instead).
Investigation status is a static "New" badge everywhere: F5.14's own
comment already says no backend field for it exists, so this doesn't
fabricate interactivity. Filtering/sorting (F9.6) reuse F5.6's `FilterBar`
and F5.4's `DataTable`'s already-generic column sort, needing no new
table-level code.

## User Investigation (Milestone F10)

`src/pages/UserListPage.tsx` (F10.1, new route `/investigation`) +
`src/pages/InvestigationPage.tsx` (F10.2-F10.9, existing route
`/investigation/:entityId`), backed by `src/features/investigation/`.
This process never holds a live `ActiveGraphStore` (F0's decoupled-process
architecture), so the user list is sourced from Neo4j cold storage
instead — a new `GET /api/entities` endpoint reading distinct `Entity`
nodes — meaning an entity with only currently-active (not-yet-pruned)
edges hasn't reached cold storage yet and won't appear. F10.3/F10.5 each
needed a small real backend addition too: a point-lookup
`GET /api/scores/entities/{entity_id}` (an existing paginated, |score|-
ranked page could miss a specific entity entirely) and a `chain_key`
filter on `/api/motifs/completions` (so "triggered rules" finds _every_
motif this entity has triggered, not whatever an unfiltered sample
contains). `useMotifCompletions()`'s signature changed from positional
optional params to one options object once this added a third
independent filter — every existing call site was updated, no behavior
change. F10.4/F10.6 are deliberately the exact same panel ("Activity
Timeline / Log History"), not two, per tasks.md's own instruction not to
imply a second data source that doesn't exist. F10.7-F10.9 are
`BackendPendingState` panels naming F0.13 — F10.9 in particular declines
to fabricate any derived session-boundary heuristic, per that task's own
explicit instruction. `RelativeTimestamp` (`src/components/`) was
extracted here from a duplicate helper F9's Detection Matrix already had.

## Log Explorer (Milestone F11)

`src/pages/LogsPage.tsx`, backed by `src/features/logs/`, is F0.8's
prune/motif-reset audit trail — explicitly the audit trail, not raw
ingested Sysmon/Windows events (no raw-event store exists anywhere in
this repo). Search (`q`), an `until` bound (paired with the existing
`since`), and an `entity` filter are all real backend additions to
`audit.py`'s `read_records()`/`GET /api/audit/log`, not client-side-only
filtering — the endpoint already scans its whole file per request, so
extending that scan was cheap. Time-range filtering reuses Milestone F8's
shared `useTimeRangeStore`/`TimeRangeFilter` unchanged. Severity
highlighting (`features/logs/logic.ts`'s `classifyLogSeverity()`) floors
every motif-reset record at "medium" (a discarded partial detection chain
is never routine) and derives a prune record's severity from how much
weight (`w_at_prune`) it still carried at eviction — illustrative
thresholds, not calibrated. "View raw" opens `RawLogDialog`, showing the
literal record pretty-printed. CSV/JSON export covers the current fetched
page only (documented in the page's own caption), not every page of the
filtered result. Live updates deliberately do **not** silently reorder
the table: `useAuditLog` gained a `refetchInterval` override (this page
passes `false`) and `src/api/liveStream.ts`'s `prune` handler no longer
invalidates the audit-log query at all — instead, new prune/motif-reset
events stream in from `useLiveStreamStore`'s event feed, get filtered
against the page's active search/type/entity/range criteria, and render
prepended with a "New" pill plus a dismissible "N new events — Refresh"
banner that triggers an explicit refetch.

## Analytics Visualizations (Milestone F12)

Adds a "Visualizations" section to the bottom of the Analytics page
(`src/pages/AnalyticsPage.tsx`), backed by five new components in
`src/features/analytics/`. Three of the eight tasks needed no new
component at all: threat timeline, attacks-per-day, and severity pie
chart are each already `ThreatTrendsChart`/`ThreatSeverityChart` from
Milestone F7, already on this page — building a second, near-duplicate
chart over the same data would just disagree with or duplicate it, so
these are documented as reuse rather than rebuilt. The five real new
charts: `DetectionAccuracyChart` (a four-bar precision/recall breakdown
from `pilot.py`'s report, same "not live" caption as F8.4's
`DetectionRateTile`), `GeographicAttackMapCard` (a `BackendPendingState`
naming F0.14 — no fake map pins), `AttackFrequencyHeatmap` (a UTC
day-of-week × hour-of-day frequency grid combining motif completions and
non-benign scores), `TopTargetedResourcesChart` (tallies `Machine:*`
entities from completions' `chain_key`/scores' `entity_id` — a documented
proxy, since neither endpoint carries a literal `dst` field), and
`AttackPatternsChart` (motif-completion counts by `motif_name`, scaling
automatically as the motif library grows). No backend changes were needed
this milestone.

## Live Monitoring (Milestone F13)

No backend changes — every task consumes API surface F0/F4 already
exposed. The real fix: `useLiveStream()` (F4.6) used to only be mounted by
the Analytics page's live attack counter, so F6/F9's tiles never actually
received a live push despite reading the exact query keys the stream
already invalidates. `src/components/AppShell.tsx` now owns a single SSE
connection for the whole authenticated app; the live attack counter reads
the same shared store instead of opening a second connection. A new
`src/features/monitoring/` folder holds: `LiveEventFeed` (a raw,
scrollable feed of every stream event), `CriticalAlertsPanel` (the
`AlertBanner`-rendered critical-severity subset, reusing Milestone F9's
severity classification), `NotificationsPanel` (a bell icon + unread
badge in the Navbar, reachable from every page) with a paired
`useLiveNotifications()` effect hook that toasts new alerts, and
`AckButton` (F13.6's frontend half — the backend ack endpoint landed back
in Milestone F0). Acknowledgement state is honestly session-scoped: the
ack endpoint is POST-only with no way to read it back, so a
`alertAckStore` tracks it client-side, updated on each mutation's
success. `src/store/autoRefreshStore.ts` backs a shared polling toggle +
interval control on the Live Monitoring page for the two endpoints
(metrics snapshot, health) with no matching live-stream event type.

## Company Security Overview (Milestone F14)

A new `/security-overview` page ("Company Overview" in the sidebar) --
tasks.md's own line calls this "largely a second view over F6's data at a
different altitude," so two of its four tiles are literally F6's existing
`CybersecurityScoreTile`/`SecurityLevelTile`/`SystemHealthTile`/
`MonitoringStatusTile` re-rendered on a new page, not rebuilt. Real new
work: `MonitoredUsersTile` (F10.1's entity count), `ProcessedLogsTile`
(reads a genuinely new backend field -- `MetricsSnapshot.total_edges_processed`,
a lifetime counter added to `metrics.py` and persisted via this repo's
first `ALTER TABLE` migration, since the table already existed in
developers' databases), an `AnalyzedSessions` `BackendPendingState`
(same "no session concept" gap F10.9 already found), and
`AverageResponseTimeTile` (a new `GET /api/alerts/response-time` endpoint
computing analyst-ack latency from data F13.6's acknowledgements already
carry -- the definition tasks.md's own line asked to be decided before
building anything).

## Commands

```bash
npm install          # also wires up the pre-commit hook (see below)
npm run dev           # local dev server
npm run build          # type-check (tsc -b) + production build
npm run lint            # ESLint
npm run lint:fix         # ESLint --fix
npm run format           # Prettier --write
npm run format:check      # Prettier --check
npm run test              # Vitest (single run)
npm run test:watch         # Vitest (watch mode)
```

Copy `.env.example` to `.env.local` and point `VITE_API_BASE_URL` at a
running `python -m t_gnn.api` instance (see the root repo's Milestone F0).

## Pre-commit hooks

This is a nested `package.json` inside a Python-repo checkout — the git
root is one directory up. `npm install`'s `prepare` script re-points
`core.hooksPath` at `frontend/.husky` (relative to the repo root) and
`frontend/.husky/pre-commit` runs `lint-staged` (ESLint --fix + Prettier
--write on staged files) before each commit anywhere in the repo. Re-run
`npm install` here if hooks ever stop firing after a fresh clone.

## Folder structure (Milestone F1.6)

```
src/
  pages/       route-level page components (Milestone F2 routing)
  components/  shared/reusable UI components (Navbar/Sidebar/AppShell from Milestone F2, rest from F5)
  features/    feature-scoped components + logic (per dashboard section)
  api/         typed API client, TanStack Query client, SSE stream client (Milestone F4)
  hooks/api/   one TanStack Query hook per backend endpoint + pagination helpers (Milestone F4)
  store/       Zustand client-state stores (auth session, live-stream events)
  types/       shared TypeScript types (api.ts mirrors the backend's schemas.py)
  config/      cross-cutting config (env var access, etc.)
```
