import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ThemeSection } from '@/features/settings/ThemeSection'
import { useThemeStore } from '@/store/themeStore'

// Radix `Select`'s open/pick interaction isn't exercised here -- jsdom has
// no `scrollIntoView`/pointer-capture support and no test in this codebase
// exercises that particular interaction yet (`AutoRefreshControl.test.tsx`
// only asserts its rendered/disabled state, same reasoning). Store-level
// behavior (`themeStore.test.ts`) already covers `setTheme` directly.
describe('ThemeSection', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'dark' })
  })

  it('shows the current theme', () => {
    render(<ThemeSection />)

    expect(screen.getByText('Dark')).toBeInTheDocument()
  })

  it('no longer captions light as a visual no-op (F16.2 shipped its palette)', () => {
    useThemeStore.setState({ theme: 'light' })
    render(<ThemeSection />)

    expect(screen.getByText('Light')).toBeInTheDocument()
    expect(screen.queryByText(/no visual effect/)).not.toBeInTheDocument()
  })
})
