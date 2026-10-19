// F16.7: verifies F2.3's route-level code splitting is actually keeping the
// initial load small, rather than trusting that `lazy` routes split
// correctly. Reads Vite's build manifest (`build.manifest` in
// vite.config.ts), walks the entry's *static* import graph -- exactly what
// the browser fetches before first paint (index.html's script +
// modulepreloads) -- and fails if any of the following regresses:
//
//   1. no page module (src/pages/*) is in the initial graph -- a page
//      pulled in statically defeats its own `lazy` route;
//   2. no heavy page-only dependency (Recharts, react-day-picker) is in
//      it -- the classic way splitting silently breaks is a shared module
//      that statically imports one of these;
//   3. the initial JS stays under INITIAL_GZIP_BUDGET_KB, gzipped.
//
// Run via `npm run check:bundle` (builds first). Prints the initial set
// and every lazy page chunk's size, so the numbers are visible even when
// the check passes.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const INITIAL_GZIP_BUDGET_KB = 200
// Strings that survive minification inside each library's own code
// (CSS class names it emits), so their presence in a chunk reliably means
// the library itself was bundled into it.
const FORBIDDEN_IN_INITIAL = {
  recharts: 'recharts-wrapper',
  'react-day-picker': 'day_button',
}

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf-8'))

const fileContent = (file) => readFileSync(join(dist, file))
const gzipKb = (file) => gzipSync(fileContent(file)).length / 1024
const rawKb = (file) => fileContent(file).length / 1024

const entryKey = Object.keys(manifest).find((key) => manifest[key].isEntry)
if (!entryKey) throw new Error('No entry chunk in the Vite manifest')

const initial = new Set()
const visit = (key) => {
  if (initial.has(key)) return
  initial.add(key)
  for (const dep of manifest[key].imports ?? []) visit(dep)
}
visit(entryKey)

const failures = []
let initialGzip = 0
let initialRaw = 0

console.log('Initial load (entry + static imports):')
for (const key of initial) {
  const chunk = manifest[key]
  const gz = gzipKb(chunk.file)
  initialGzip += gz
  initialRaw += rawKb(chunk.file)
  console.log(`  ${chunk.file.padEnd(48)} ${gz.toFixed(1).padStart(7)} kB gz`)

  if (chunk.src?.startsWith('src/pages/')) {
    failures.push(`page module ${chunk.src} is statically reachable from the entry`)
  }
  const content = fileContent(chunk.file).toString('utf-8')
  for (const [lib, marker] of Object.entries(FORBIDDEN_IN_INITIAL)) {
    if (content.includes(marker))
      failures.push(`${lib} is bundled into initial chunk ${chunk.file}`)
  }
}
console.log(
  `  ${'TOTAL'.padEnd(48)} ${initialGzip.toFixed(1).padStart(7)} kB gz (${initialRaw.toFixed(0)} kB raw, budget ${INITIAL_GZIP_BUDGET_KB} kB gz)`,
)
if (initialGzip > INITIAL_GZIP_BUDGET_KB) {
  failures.push(
    `initial JS is ${initialGzip.toFixed(1)} kB gz, over the ${INITIAL_GZIP_BUDGET_KB} kB budget`,
  )
}

console.log('\nLazy page chunks (own chunk only, excluding shared deps):')
for (const [key, chunk] of Object.entries(manifest)) {
  if (!chunk.isDynamicEntry || initial.has(key)) continue
  console.log(
    `  ${(chunk.src ?? key).padEnd(48)} ${gzipKb(chunk.file).toFixed(1).padStart(7)} kB gz`,
  )
}

if (failures.length > 0) {
  console.error('\nBundle check FAILED:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('\nBundle check passed.')
