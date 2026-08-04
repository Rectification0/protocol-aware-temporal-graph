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
