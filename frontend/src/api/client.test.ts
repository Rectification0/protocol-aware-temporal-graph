import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ApiNetworkError, apiRequest, getErrorMessage } from '@/api/client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('apiRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed JSON on success', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, { ok: true }))

    const result = await apiRequest<{ ok: boolean }>('/api/health')

    expect(result).toEqual({ ok: true })
  })

  it('sends query params, omitting null/undefined', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(200, {}))

    await apiRequest('/api/scores/entities', {
      query: { limit: 10, offset: undefined, motif_name: null },
    })

    const calledUrl = new URL(vi.mocked(fetch).mock.calls[0][0] as string)
    expect(calledUrl.searchParams.get('limit')).toBe('10')
    expect(calledUrl.searchParams.has('offset')).toBe(false)
    expect(calledUrl.searchParams.has('motif_name')).toBe(false)
  })

  it('throws ApiError with the F0.15 envelope message/code on a non-2xx response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(404, { error: { code: 404, message: 'edge not found' } }),
    )

    await expect(apiRequest('/api/forensics/edge/x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      code: 404,
      message: 'edge not found',
    })
  })

  it('throws ApiNetworkError when fetch itself rejects', async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(apiRequest('/api/health')).rejects.toBeInstanceOf(ApiNetworkError)
  })

  it('re-throws an AbortError as-is rather than wrapping it', async () => {
    const abortError = new DOMException('aborted', 'AbortError')
    vi.mocked(fetch).mockRejectedValue(abortError)

    await expect(apiRequest('/api/health')).rejects.toBe(abortError)
  })

  it('returns undefined for a 204 response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))

    await expect(apiRequest('/api/alerts/ack')).resolves.toBeUndefined()
  })
})

describe('getErrorMessage', () => {
  it('unwraps ApiError/ApiNetworkError messages', () => {
    expect(getErrorMessage(new ApiError(500, 500, 'boom'))).toBe('boom')
    expect(getErrorMessage(new ApiNetworkError(new Error('offline')))).toMatch(/unreachable/)
  })

  it('falls back to a generic message for non-Error values', () => {
    expect(getErrorMessage('not an error')).toBe('Something went wrong.')
  })
})
