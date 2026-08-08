import { configure } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// `findBy*`/`waitFor`'s default 1000ms timeout is tight for anything
// depending on a route's dynamic `import()` (F2.3's per-page code
// splitting) -- fine in isolation, but under a full-suite run's shared
// transform/import load a lazy page's chunk can occasionally take longer
// than that to resolve, failing an otherwise-correct assertion. Raising
// the default here (rather than passing `{ timeout }` at every call site)
// only makes tests more patient; a passing assertion still resolves as
// soon as its condition is met.
//
// Milestone F8's `AnalyticsPage` route grew heavy enough (Recharts +
// `react-day-picker` + nine feature components, several other test files
// now transforming that same heavy dependency graph concurrently) that
// the original 5000ms bump started missing under a full-suite run --
// `router.test.tsx`'s unauthenticated `/analytics` case still has to
// resolve that route's `lazy` module during navigation matching even
// though `ProtectedRoute` ends up redirecting before rendering it.
// `vite.config.ts`'s `testTimeout` (a *different* knob -- the outer
// per-test safety net, not this library's own internal polling budget)
// was raised first and didn't help, which is what actually pinned this
// down: `asyncUtilTimeout` itself was the real bottleneck, not the outer
// timeout racing it as it was the first time this class of flake showed
// up (F7's fix). Raised well past observed worst-case import time.
configure({ asyncUtilTimeout: 20_000 })

// jsdom has no native `EventSource` (`api/liveStream.test.ts`'s own doc
// comment already notes this for its hand-injected fake). Milestone F7.4
// is the first component to call `useLiveStream()` for real -- without a
// stand-in, any test that renders it via a real route/page (rather than
// mocking `@/api/liveStream` outright) throws a `ReferenceError` the
// moment the connect effect runs. This no-op stub never opens or emits,
// so such tests just see the stream sit in "connecting" -- callers that
// need actual open/message/error behavior still inject their own fake via
// `useLiveStream`'s `eventSourceFactory` option, same as before.
if (typeof globalThis.EventSource === 'undefined') {
  class NoopEventSource {
    onopen: ((event: Event) => void) | null = null
    onerror: ((event: Event) => void) | null = null
    addEventListener(): void {}
    removeEventListener(): void {}
    close(): void {}
  }
  // @ts-expect-error -- minimal stand-in, not a full EventSource implementation
  globalThis.EventSource = NoopEventSource
}
