import { beforeEach, describe, expect, it } from 'vitest'
import { isSessionValid, useAuthStore } from './authStore'

beforeEach(() => {
  useAuthStore.setState({ session: null })
})

describe('useAuthStore', () => {
  it('starts with no session', () => {
    expect(useAuthStore.getState().session).toBeNull()
  })

  it('login sets a session for the given analyst with a future expiry', () => {
    useAuthStore.getState().login('alice')

    const session = useAuthStore.getState().session
    expect(session?.analyst).toBe('alice')
    expect(session?.expiresAt).toBeGreaterThan(Date.now())
  })

  it('logout clears the session', () => {
    useAuthStore.getState().login('alice')
    useAuthStore.getState().logout()

    expect(useAuthStore.getState().session).toBeNull()
  })
})

describe('isSessionValid', () => {
  it('is false for a null session', () => {
    expect(isSessionValid(null)).toBe(false)
  })

  it('is true for a session that has not expired', () => {
    expect(isSessionValid({ analyst: 'alice', expiresAt: Date.now() + 1000 })).toBe(true)
  })

  it('is false for a session past its expiresAt', () => {
    expect(isSessionValid({ analyst: 'alice', expiresAt: Date.now() - 1000 })).toBe(false)
  })
})
