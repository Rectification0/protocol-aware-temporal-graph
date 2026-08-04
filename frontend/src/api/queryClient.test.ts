import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, ApiNetworkError } from '@/api/client'

const logout = vi.fn()
const navigate = vi.fn()
const toastError = vi.fn()

vi.mock('@/store/authStore', () => ({
  useAuthStore: { getState: () => ({ logout }) },
}))
vi.mock('@/router', () => ({
  router: { navigate },
}))
vi.mock('@/components/toast', () => ({
  toast: { error: toastError },
}))

const { shouldRetry, handleGlobalError } = await import('@/api/queryClient')

describe('shouldRetry (F4.4)', () => {
  it('does not retry a 4xx ApiError', () => {
    expect(shouldRetry(0, new ApiError(404, 404, 'not found'))).toBe(false)
    expect(shouldRetry(0, new ApiError(400, 400, 'bad request'))).toBe(false)
  })

  it('retries a 5xx ApiError up to the cap', () => {
    expect(shouldRetry(0, new ApiError(503, 503, 'unavailable'))).toBe(true)
    expect(shouldRetry(2, new ApiError(503, 503, 'unavailable'))).toBe(true)
    expect(shouldRetry(3, new ApiError(503, 503, 'unavailable'))).toBe(false)
  })

  it('retries a network error up to the cap', () => {
    expect(shouldRetry(0, new ApiNetworkError(new Error('offline')))).toBe(true)
    expect(shouldRetry(3, new ApiNetworkError(new Error('offline')))).toBe(false)
  })
})

describe('handleGlobalError (F4.3)', () => {
  beforeEach(() => {
    logout.mockClear()
    navigate.mockClear()
    toastError.mockClear()
  })

  it('logs out and redirects to /login on a 401', () => {
    handleGlobalError(new ApiError(401, 401, 'unauthorized'))

    expect(logout).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('/login')
    expect(toastError).toHaveBeenCalledOnce()
  })

  it('toasts any other error without logging out', () => {
    handleGlobalError(new ApiError(500, 500, 'server exploded'))

    expect(logout).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith('server exploded')
  })
})
