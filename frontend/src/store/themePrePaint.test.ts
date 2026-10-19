import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useThemeStore } from '@/store/themeStore'
import html from '../../index.html?raw'

// F16.2: index.html's inline script applies the persisted theme before
// React loads. It reads `themeStore`'s persisted JSON directly, so this
// runs the real script text against what the real store writes -- if
// either side changes key or shape, this fails instead of the app
// silently flashing dark for light-theme users.
const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]

function runPrePaintScript() {
  new Function(script!)()
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.classList.add('dark')
})

afterEach(() => {
  localStorage.clear()
  document.documentElement.classList.add('dark')
})

describe('index.html pre-paint theme script (F16.2)', () => {
  it('exists', () => {
    expect(script).toBeTruthy()
  })

  it('removes .dark when the store has persisted light', () => {
    useThemeStore.getState().setTheme('light')
    runPrePaintScript()

    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('keeps .dark when the store has persisted dark', () => {
    useThemeStore.getState().setTheme('dark')
    runPrePaintScript()

    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('keeps .dark when nothing or garbage is stored', () => {
    runPrePaintScript()
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    localStorage.setItem('t-gnn-theme', '{not json')
    runPrePaintScript()
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
