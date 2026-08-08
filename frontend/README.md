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
