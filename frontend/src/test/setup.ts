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
configure({ asyncUtilTimeout: 5000 })

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
