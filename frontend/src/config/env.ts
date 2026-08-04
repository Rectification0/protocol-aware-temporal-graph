const apiBaseUrl = import.meta.env.VITE_API_BASE_URL

if (!apiBaseUrl) {
  throw new Error(
    'VITE_API_BASE_URL is not set -- copy frontend/.env.example to frontend/.env.local and fill it in',
  )
}

// F3.4: real backend auth (tasks.md F0.11) doesn't exist yet, so mock-auth
// is the only functional mode today -- defaults to enabled unless
// explicitly turned off (e.g. to see the app's honest "auth unavailable"
// state on the login page).
const mockAuthEnabled = import.meta.env.VITE_MOCK_AUTH_ENABLED !== 'false'

export const env = {
  apiBaseUrl,
  mockAuthEnabled,
}
