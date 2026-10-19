import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/api/client'
import { useAuthStore } from '@/store/authStore'
import { createQueryWrapper } from '@/test/query'
import type { ConfigCapabilitiesOut } from '@/types/api'

vi.mock('@/api/endpoints', () => ({
  listProtocolConfig: vi.fn(),
  listMotifConfig: vi.fn(),
  getConfigCapabilities: vi.fn(),
  listConfigChanges: vi.fn(),
  updateProtocolLambda: vi.fn(),
  updateMotifWindow: vi.fn(),
}))

const endpoints = await import('@/api/endpoints')
const { AlertThresholdsSection } = await import('@/features/settings/AlertThresholdsSection')

const BOUNDS = {
  min_lambda_p: Math.log(2) / (365 * 24 * 3600),
  max_lambda_p: Math.log(2) / 60,
  min_window_seconds: 60,
  max_window_seconds: 30 * 24 * 3600,
}

function capabilities(writesEnabled: boolean): ConfigCapabilitiesOut {
  return { writes_enabled: writesEnabled, ...BOUNDS }
}

function renderSection() {
  return render(<AlertThresholdsSection />, { wrapper: createQueryWrapper().wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.getState().login('alice')
  vi.mocked(endpoints.listProtocolConfig).mockResolvedValue([
    { protocol: 'SMB', lambda_p: 0.000004, half_life_hours: 48, description: 'File shares' },
  ])
  vi.mocked(endpoints.listMotifConfig).mockResolvedValue([
    {
      name: 'lateral_pivot',
      description: 'Two-hop lateral movement',
      window_seconds: 14400,
      steps: [{}, {}] as never,
    },
  ])
  vi.mocked(endpoints.listConfigChanges).mockResolvedValue({
    items: [],
    limit: 10,
    offset: 0,
    total: null,
  })
})

describe('AlertThresholdsSection', () => {
  it('renders the protocol and motif tables from F0.9', async () => {
    vi.mocked(endpoints.getConfigCapabilities).mockResolvedValue(capabilities(false))
    renderSection()

    expect(await screen.findByText('SMB')).toBeInTheDocument()
    expect(screen.getByText('48.0h')).toBeInTheDocument()
    expect(screen.getByText('4.000e-6')).toBeInTheDocument()
    expect(screen.getByText('lateral_pivot')).toBeInTheDocument()
    expect(screen.getByText('240m')).toBeInTheDocument()
    expect(screen.getByText('2 steps')).toBeInTheDocument()
  })

  it('stays read-only, saying why, while the API has writes disabled (FB.1)', async () => {
    vi.mocked(endpoints.getConfigCapabilities).mockResolvedValue(capabilities(false))
    renderSection()

    expect(await screen.findByText(/edits are disabled on this API instance/)).toBeInTheDocument()
    await screen.findByText('SMB')
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument()
    expect(screen.queryByText('Recent changes')).not.toBeInTheDocument()
  })

  it('edits a half-life: validates, confirms, then saves lambda_p with the analyst (FB.1)', async () => {
    const user = userEvent.setup()
    vi.mocked(endpoints.getConfigCapabilities).mockResolvedValue(capabilities(true))
    vi.mocked(endpoints.updateProtocolLambda).mockResolvedValue({} as never)
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Edit SMB half-life' }))
    const input = screen.getByLabelText('SMB half-life (hours)')

    await user.clear(input)
    await user.type(input, '0.001')
    expect(screen.getByRole('alert')).toHaveTextContent(/between 1 minute and 365 days/)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    await user.clear(input)
    await user.type(input, '12')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    const dialog = await screen.findByRole('dialog', { name: 'Change SMB half-life?' })
    expect(dialog).toHaveTextContent('from 48.0h to 12.0h')
    expect(endpoints.updateProtocolLambda).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Apply change' }))

    await waitFor(() =>
      expect(endpoints.updateProtocolLambda).toHaveBeenCalledWith('SMB', {
        lambda_p: Math.log(2) / (12 * 3600),
        analyst: 'alice',
      }),
    )
    // Success refetches the config (and history) rather than trusting local state.
    await waitFor(() => expect(endpoints.listProtocolConfig).toHaveBeenCalledTimes(2))
  })

  it('edits a motif window in minutes and shows a server rejection inline', async () => {
    const user = userEvent.setup()
    vi.mocked(endpoints.getConfigCapabilities).mockResolvedValue(capabilities(true))
    vi.mocked(endpoints.updateMotifWindow).mockRejectedValue(
      new ApiError(409, 409, 'Config file not changed: unrecognized layout'),
    )
    renderSection()

    await user.click(await screen.findByRole('button', { name: 'Edit lateral_pivot window' }))
    const input = screen.getByLabelText('lateral_pivot window (minutes)')
    await user.clear(input)
    await user.type(input, '120')
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await user.click(await screen.findByRole('button', { name: 'Apply change' }))

    expect(endpoints.updateMotifWindow).toHaveBeenCalledWith('lateral_pivot', {
      window_seconds: 7200,
      analyst: 'alice',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('unrecognized layout')
    expect(screen.getByLabelText('lateral_pivot window (minutes)')).toBeInTheDocument()
  })

  it('lists recent audited changes when editing is enabled', async () => {
    vi.mocked(endpoints.getConfigCapabilities).mockResolvedValue(capabilities(true))
    vi.mocked(endpoints.listConfigChanges).mockResolvedValue({
      items: [
        {
          id: 1,
          kind: 'motif',
          target: 'lateral_pivot',
          field: 'window_seconds',
          old_value: 14400,
          new_value: 7200,
          changed_by: 'bob',
          changed_at: Date.now() / 1000 - 120,
        },
      ],
      limit: 10,
      offset: 0,
      total: null,
    })
    renderSection()

    expect(await screen.findByText('lateral_pivot window 240m -> 120m')).toBeInTheDocument()
    expect(screen.getByText(/by bob/)).toBeInTheDocument()
  })
})
