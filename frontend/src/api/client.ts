import { env } from '@/config/env'
import type { ApiErrorEnvelope } from '@/types/api'

// F4.1: the typed API client's transport primitive. Every endpoint
// function in `endpoints.ts` funnels through `apiRequest()` so error
// parsing (F0.15's `{"error": {code, message}}` envelope) and base-URL
// handling live in exactly one place.

export class ApiError extends Error {
  readonly status: number
  readonly code: number

  constructor(status: number, code: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  query?: Record<string, string | number | boolean | undefined | null>
  body?: unknown
  signal?: AbortSignal
}

function buildUrl(path: string, query?: ApiRequestOptions['query']): string {
  const url = new URL(path, env.apiBaseUrl)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }
  }
  return url.toString()
}

/** Network failures (offline, DNS, CORS, connection refused) never reach
 * `fetch`'s resolved response -- this is what `apiRequest` throws for
 * those, distinct from `ApiError` (a response the server actually sent). */
export class ApiNetworkError extends Error {
  constructor(cause: unknown) {
    super('Network request failed -- the API server may be unreachable')
    this.name = 'ApiNetworkError'
    this.cause = cause
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { method = 'GET', query, body, signal } = options

  let response: Response
  try {
    response = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (cause) {
    // A caller-initiated abort (e.g. React Query unmounting/refetching)
    // isn't a network failure -- let it propagate as-is so TanStack
    // Query's own abort handling treats it as a cancellation, not an error.
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw cause
    }
    throw new ApiNetworkError(cause)
  }

  if (response.status === 204) {
    return undefined as T
  }

  const isJson = response.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await response.json() : undefined

  if (!response.ok) {
    const envelope = payload as ApiErrorEnvelope | undefined
    const message = envelope?.error?.message ?? response.statusText ?? 'Request failed'
    const code = envelope?.error?.code ?? response.status
    throw new ApiError(response.status, code, message)
  }

  return payload as T
}

/** Shared by the global error handler (F4.3) and any component that wants
 * to render an inline message instead of relying on the toast alone. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof ApiError || error instanceof ApiNetworkError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return 'Something went wrong.'
}
