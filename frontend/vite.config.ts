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
    testTimeout: 10_000,
  },
})
