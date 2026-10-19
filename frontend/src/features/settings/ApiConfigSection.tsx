import { env } from '@/config/env'

// F15.3: read-only. `env.apiBaseUrl` is resolved once at build/start time
// from `VITE_API_BASE_URL` (`src/config/env.ts`) -- making it editable
// from this page would mean the running app reconnecting to an entirely
// different backend process at runtime, not just flipping a client-side
// preference like F15.1/F15.2/F15.4 do, so (per this line's own
// Complexity: S scope) this stays a display, not a control. Pointing at a
// different backend is a local-dev/`.env.local` change (`.env.example`),
// not a Settings-page action.
export function ApiConfigSection() {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-muted-foreground">API base URL</span>
        <code className="rounded bg-muted px-2 py-1 text-xs">{env.apiBaseUrl}</code>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Environment</span>
        <code className="rounded bg-muted px-2 py-1 text-xs">{import.meta.env.MODE}</code>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="text-muted-foreground">Configured by</span>
        <code className="rounded bg-muted px-2 py-1 text-xs">
          {env.apiBaseUrlSource === 'runtime'
            ? 'runtime /config.js'
            : 'build-time VITE_API_BASE_URL'}
        </code>
      </div>
      <p className="text-xs text-muted-foreground">
        Set per deployment via <code>/config.js</code> (the container&apos;s{' '}
        <code>API_BASE_URL</code>), or at build time via <code>VITE_API_BASE_URL</code> (see{' '}
        <code>frontend/.env.example</code>) -- not editable here.
      </p>
    </div>
  )
}
