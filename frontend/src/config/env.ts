// App configuration, resolved once at startup.
//
// F17.1: two sources, highest precedence first:
//   1. Runtime config -- `window.__T_GNN_CONFIG__`, set by `/config.js`
//      (loaded by index.html before the bundle). The committed
//      `public/config.js` is an empty object, so dev and plain static
//      builds fall through to (2); the container image rewrites it from
//      environment variables at start (`docker/frontend-entrypoint.sh`), so
//      ONE built image deploys to any environment without a rebuild.
//   2. Build-time `VITE_*` variables (`.env.local` in dev, CI env vars).
//
// `apiBaseUrl: ""` (runtime config only) means "same origin" -- the
// F17.3 reverse-proxy topology, where nginx serves the app and proxies
// `/api` -- and resolves to `window.location.origin` so `new URL(path,
// base)` in the API client keeps working unchanged. Unset in *both*
// sources still throws: a backend URL is never silently guessed.

export interface RuntimeConfig {
  apiBaseUrl?: string
  mockAuthEnabled?: boolean | string
}

declare global {
  interface Window {
    __T_GNN_CONFIG__?: RuntimeConfig
  }
}

export type ConfigSource = 'runtime' | 'build'

export interface AppEnv {
  apiBaseUrl: string
  apiBaseUrlSource: ConfigSource
  mockAuthEnabled: boolean
}

export function resolveEnv(
  runtime: RuntimeConfig | undefined,
  build: { VITE_API_BASE_URL?: string; VITE_MOCK_AUTH_ENABLED?: string },
  origin: string,
): AppEnv {
  const runtimeUrl = runtime?.apiBaseUrl
  const buildUrl = build.VITE_API_BASE_URL

  let apiBaseUrl: string
  let apiBaseUrlSource: ConfigSource
  if (typeof runtimeUrl === 'string') {
    apiBaseUrl = runtimeUrl.trim() === '' ? origin : runtimeUrl.trim()
    apiBaseUrlSource = 'runtime'
  } else if (buildUrl) {
    apiBaseUrl = buildUrl
    apiBaseUrlSource = 'build'
  } else {
    throw new Error(
      'VITE_API_BASE_URL is not set -- copy frontend/.env.example to frontend/.env.local and fill it in (or set apiBaseUrl in /config.js)',
    )
  }

  // F3.4: real backend auth (tasks.md F0.11) doesn't exist yet, so mock-auth
  // is the only functional mode today -- defaults to enabled unless
  // explicitly turned off (e.g. to see the app's honest "auth unavailable"
  // state on the login page).
  const mockAuthRaw = runtime?.mockAuthEnabled ?? build.VITE_MOCK_AUTH_ENABLED
  const mockAuthEnabled = String(mockAuthRaw) !== 'false'

  return { apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''), apiBaseUrlSource, mockAuthEnabled }
}

export const env: AppEnv = resolveEnv(
  typeof window !== 'undefined' ? window.__T_GNN_CONFIG__ : undefined,
  import.meta.env,
  typeof window !== 'undefined' ? window.location.origin : '',
)
