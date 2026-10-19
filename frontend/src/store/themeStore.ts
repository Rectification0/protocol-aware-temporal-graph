import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// F15.1: theme preference, persisted client-side (localStorage, F15.6) so
// it survives a reload -- unlike F3's session (deliberately in-memory,
// since there's no real token to persist), a display preference has
// nothing sensitive about it.
//
// F16.2: `src/index.css` gives `:root` a real, contrast-checked light
// palette and `.dark` the original dark one, so `setTheme('light')` is a
// genuine visual switch. index.html's inline pre-paint script reads this
// store's persisted shape (`{ state: { theme } }` under `t-gnn-theme`)
// directly, before React loads -- keep that key/shape in sync with it
// (`themeStore.test.ts` pins it).

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

/** Mounted once in `AppShell` -- keeps `<html>`'s `.dark` class in sync with
 * live preference changes. The initial class (on every page, `/login`
 * included) is set earlier still, by index.html's pre-paint script. */
export function useAppliedTheme() {
  const theme = useThemeStore((state) => state.theme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])
}
