import { describe, expect, it } from 'vitest'
import { resolveEnv } from '@/config/env'

const ORIGIN = 'https://soc.example.com'

describe('resolveEnv (F17.1)', () => {
  it('uses the build-time URL when no runtime config is present', () => {
    expect(resolveEnv(undefined, { VITE_API_BASE_URL: 'http://127.0.0.1:8000' }, ORIGIN)).toEqual({
      apiBaseUrl: 'http://127.0.0.1:8000',
      apiBaseUrlSource: 'build',
      mockAuthEnabled: true,
    })
  })

  it('lets runtime config override the build-time URL (one image, many environments)', () => {
    const env = resolveEnv(
      { apiBaseUrl: 'https://api.staging.example.com/' },
      { VITE_API_BASE_URL: 'http://127.0.0.1:8000' },
      ORIGIN,
    )
    expect(env.apiBaseUrl).toBe('https://api.staging.example.com')
    expect(env.apiBaseUrlSource).toBe('runtime')
  })

  it('treats an empty runtime URL as same-origin (the reverse-proxy topology)', () => {
    expect(resolveEnv({ apiBaseUrl: '' }, {}, ORIGIN).apiBaseUrl).toBe(ORIGIN)
  })

  it('an empty runtime config object falls through to build-time values', () => {
    expect(resolveEnv({}, { VITE_API_BASE_URL: 'http://x:1' }, ORIGIN).apiBaseUrl).toBe(
      'http://x:1',
    )
  })

  it('throws rather than guessing when no source sets a URL', () => {
    expect(() => resolveEnv(undefined, {}, ORIGIN)).toThrow(/VITE_API_BASE_URL is not set/)
    expect(() => resolveEnv({}, { VITE_API_BASE_URL: '' }, ORIGIN)).toThrow()
  })

  it('reads mock-auth from runtime config first, accepting a string or boolean', () => {
    const build = { VITE_API_BASE_URL: 'http://x', VITE_MOCK_AUTH_ENABLED: 'true' }
    expect(resolveEnv({ mockAuthEnabled: false }, build, ORIGIN).mockAuthEnabled).toBe(false)
    expect(resolveEnv({ mockAuthEnabled: 'false' }, build, ORIGIN).mockAuthEnabled).toBe(false)
    expect(
      resolveEnv(undefined, { ...build, VITE_MOCK_AUTH_ENABLED: 'false' }, ORIGIN),
    ).toMatchObject({ mockAuthEnabled: false })
  })
})
