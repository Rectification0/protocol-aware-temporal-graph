import { beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '@/store/themeStore'

describe('themeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    useThemeStore.setState({ theme: 'dark' })
  })

  it('defaults to dark', () => {
    expect(useThemeStore.getState().theme).toBe('dark')
  })

  it('setTheme updates the theme', () => {
    useThemeStore.getState().setTheme('light')
    expect(useThemeStore.getState().theme).toBe('light')
  })

  it('persists changes to localStorage (F15.6)', () => {
    useThemeStore.getState().setTheme('light')

    const raw = localStorage.getItem('t-gnn-theme')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw!).state.theme).toBe('light')
  })
})
