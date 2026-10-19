/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's own default test-level timeout (5000ms) exactly matches
    // `setup.ts`'s `asyncUtilTimeout` -- the two raced under a
    // full-suite run's shared transform/import load (more test files
    // landing with each milestone only adds to that load), occasionally
    // failing an otherwise-correct `findBy*`/`waitFor` a few ms before
    // its own timeout fired. Raised well above `asyncUtilTimeout` so the
    // inner wait always loses the race first.
    // Milestone F8 needed `src/test/setup.ts`'s `asyncUtilTimeout` (a
    // *different* knob -- `findBy*`/`waitFor`'s own internal polling
    // budget, not this outer per-test safety net) raised to 20000ms --
    // see that file's comment for why. Kept comfortably above it here so
    // the inner wait always loses the race and reports the real failure,
    // rather than this outer timeout firing first with a less specific
    // "Test timed out" message.
    testTimeout: 25_000,
    // F16.4: `npm run test:coverage`. Report-only, no thresholds -- a
    // number to watch, not a gate (gating would mostly reward testing
    // shadcn's generated `ui/` primitives). Excludes code with nothing to
    // execute (types, barrels, the entry point) so the % means something.
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/types/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/hooks/api/index.ts',
      ],
      reporter: ['text-summary', 'html'],
    },
  },
})
