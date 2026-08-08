import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// F15.1: theme preference, persisted client-side (localStorage, F15.6) so
// it survives a reload -- unlike F3's session (deliberately in-memory,
// since there's no real token to persist), a display preference has
// nothing sensitive about it.
//
// `src/index.css`'s own comment already anticipated this: today `:root`
// and `.dark` hold the *same* verified dark values (no real light palette
// exists -- shipping one without the same contrast verification the dark
// tokens got would violate the accessibility-first posture that file
// documents). So `setTheme('light')` is genuinely wired (`useAppliedTheme`
// below really does flip the class) but currently a visual no-op -- the
// honest state until Milestone F16.2 gives `:root` its own real light
// values. This is deliberately the same "real mechanism, pending a
// dependency" call F6.1's `CybersecurityScoreTile` already makes for a
// backend gap, just for a frontend-milestone one instead.

export type Theme = 'dark' | 'light'

interface ThemeStore {
  theme: Theme
  setTheme: (theme: Theme) => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 't-gnn-theme' },
  ),
)

/** Mounted once in `AppShell` -- keeps `<html>`'s `.dark` class (index.html's
 * static default) in sync with the stored preference. Scoped to the
 * authenticated app the same way F13.1's live-stream connection is; the
 * `/login` page keeps index.html's static default. */
export function useAppliedTheme() {
  const theme = useThemeStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
}
