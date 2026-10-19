# Deploying the SOC dashboard

`frontend_implementation` branch only (tasks.md Milestone F17). This covers
running the **dashboard** (`frontend/`) and its **API** (`python -m t_gnn.api`)
as containers. The detection pipeline itself (`scripts/run_pipeline.py`) is out
of scope here. It still runs as its own process and persists to Postgres/Neo4j,
which the API reads. The API never runs the pipeline (CLAUDE.md, F0).

> The compose stack is a **dev/demo** topology, like the rest of
> `docker-compose.yml`. It has no TLS and no real auth (F0.11 is still open,
> and login is the mock-auth bypass), and its Postgres is the developer's
> local instance. Treat it as the reference for how the pieces connect, not
> as a hardened production setup.

## Topology

```
browser ──► frontend (nginx :80, host :8080)
              ├─ /            built SPA (frontend/dist), SPA fallback to index.html
              ├─ /config.js   runtime config, written at container start (F17.1)
              └─ /api/*       reverse proxy ──► api (uvicorn :8000)   (F17.3)
                                                 ├─► Postgres  (host.docker.internal:5432)
                                                 ├─► Neo4j     (neo4j:7687)
                                                 ├─► Redis     (redis:6379)
                                                 └─► logs/audit.log (read-only mount)
```

The browser only ever talks to the dashboard's origin, so **no CORS is
involved**. nginx proxies `/api` on the same origin, with buffering disabled
for the SSE stream (`/api/stream/events`).

## Quick start (compose)

Prerequisites:
- The one-time setup from `docs/cli-reference.md`: a root `.env` with
  `PG*`/`NEO4J_*` credentials, and `python scripts/init_postgres.py` run once.
- A local Postgres running.

```bash
docker compose --profile dashboard up -d --build
# Dashboard: http://localhost:8080   (also starts redis/neo4j/flink as usual)

# In another terminal, feed it data (the pipeline runs on the host):
python scripts/run_pipeline.py
```

`docker compose up -d` without the profile behaves exactly as before. The
dashboard services are opt-in.

Compose interpolates the root `.env` for the API's database credentials.
Postgres is reached at `host.docker.internal`. To point somewhere else, set
`DASHBOARD_PGHOST` in `.env`. `localhost` won't work, because it would mean
the container itself.

## Images

| Image | Build | Port |
|---|---|---|
| dashboard | `docker build -t t-gnn-frontend frontend` | 80 |
| API | `docker build -f docker/api.Dockerfile -t t-gnn-api .` (repo root context) | 8000 |

CI (`.github/workflows/frontend-ci.yml`, F17.4) builds both on every
push/PR, smoke-tests the dashboard image, and on pushes to
`frontend_implementation` publishes them to
`ghcr.io/<owner>/t-gnn-frontend` and `ghcr.io/<owner>/t-gnn-api`, tagged
`<commit sha>` and `<branch>`.

The dashboard image contains nothing environment-specific, so **the same
image deploys anywhere**. All configuration is read when the container starts:

### Dashboard container environment

| Variable | Default | Meaning |
|---|---|---|
| `API_UPSTREAM` | `http://api:8000` | Where nginx proxies `/api`. |
| `API_BASE_URL` | *(empty)* | Empty means same origin (via the proxy above). Set an absolute URL only to bypass the proxy and call an API directly; that API must then list this origin in `API_CORS_ORIGINS`. |
| `MOCK_AUTH_ENABLED` | `true` | `false` shows the login page's honest "auth unavailable" state (F3.4). |

### API container environment

The API uses the same variables as local dev (`.env.example`): `PG*`,
`NEO4J_URI`/`NEO4J_USER`/`NEO4J_PASSWORD`, `REDIS_HOST`/`REDIS_PORT`,
`AUDIT_LOG_PATH`, `PILOT_REPORT_PATH` and `STREAM_POLL_INTERVAL_SECONDS`, plus
one variable for deployment:

| Variable | Default | Meaning |
|---|---|---|
| `API_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated exact origins allowed to call the API cross-origin. Empty disables cross-origin access (correct behind the dashboard's proxy). `*` is rejected, because the API accepts analyst-attributed writes. |
| `API_CONFIG_WRITES_ENABLED` | `false` | Lets the dashboard's Settings page edit detection thresholds (FB.1). Writes go to `config/*.yaml` and are audited in Postgres; when it's off, the edit endpoints answer 403 and Settings stays read-only. **Until real login exists (F0.11), this switch is the whole authorization model.** Enable it only where everyone who can reach the dashboard may retune detection. |

In compose, the API mounts the host's `./config` read-write, so its reads
show what the host pipeline actually runs, and an edit reaches the
pipeline's hot reload. To enable edits, set `API_CONFIG_WRITES_ENABLED=true`
in the root `.env` and recreate the service (`docker compose --profile
dashboard up -d api`). On a Linux host, the container's non-root user
(uid 10001) needs write permission on `config/`.

In compose, the pilot report is read from `logs/pilot-report.json`, since only
`logs/` is mounted. Write it with `python -m t_gnn.pilot ... --output
logs/pilot-report.json`.

## How the runtime config works (F17.1)

`index.html` loads `/config.js` before the app bundle. That file sets
`window.__T_GNN_CONFIG__`, and `src/config/env.ts` resolves the API URL with
this precedence:

1. `window.__T_GNN_CONFIG__.apiBaseUrl` (runtime). An empty string means the
   page's own origin.
2. `VITE_API_BASE_URL` (build time, from `.env.local` in dev or CI env vars).

The committed `frontend/public/config.js` is an empty object, so `npm run
dev` and plain static builds keep using `VITE_API_BASE_URL` as before. The
container overwrites it at start
(`frontend/docker/frontend-entrypoint.sh`). If neither source sets a URL, the
app throws at startup rather than guessing. Settings → API configuration shows
which source was used.

## Static hosting without the container

`npm run build` produces a plain static site in `frontend/dist/`. Any static
host works if it:
- falls back to `index.html` for unknown paths (client-side routing);
- never caches `index.html` or `config.js`; `assets/*` is content-hashed and
  can be cached forever (`frontend/docker/nginx.conf.template` shows all
  three rules);
- either proxies `/api` to the API, or serves an edited `config.js` with an
  absolute `apiBaseUrl` while the API allows that origin via
  `API_CORS_ORIGINS`.

For the SSE stream, a proxy must not buffer responses, and its read timeout
must be longer than the stream's heartbeat interval.
