import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '@/test/query'
import { securityScoreFixture } from '@/test/securityScore'

vi.mock('@/api/endpoints', () => ({ getSecurityScore: vi.fn() }))

const { getSecurityScore } = await import('@/api/endpoints')
const { SecurityScoreBreakdown } =
  await import('@/features/security-overview/SecurityScoreBreakdown')

describe('SecurityScoreBreakdown', () => {
  it('lists each penalty with its cap and detail, marking the provisional one', async () => {
    vi.mocked(getSecurityScore).mockResolvedValue(securityScoreFixture())

    render(<SecurityScoreBreakdown />, { wrapper: createQueryWrapper().wrapper })

    const list = await screen.findByRole('list', { name: 'Score penalties' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Motif detections')
    expect(rows[0]).toHaveTextContent('15.7 of 50')
    expect(rows[1]).toHaveTextContent('5 of 20')
    expect(within(rows[2]).getByText('Provisional')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('Provisional')).not.toBeInTheDocument()
    expect(screen.getByText(/last 24 hours\. Formula v1\./)).toBeInTheDocument()
  })

  it('notes a stale pipeline and truncated inputs', async () => {
    vi.mocked(getSecurityScore).mockResolvedValue(
      securityScoreFixture({
        pipeline_status: 'stale',
        snapshot_age_seconds: 95,
        inputs_truncated: true,
      }),
    )

    render(<SecurityScoreBreakdown />, { wrapper: createQueryWrapper().wrapper })

    expect(await screen.findByText(/last reported 95 s ago/)).toBeInTheDocument()
    expect(screen.getByText(/Only the most recent detections were counted/)).toBeInTheDocument()
  })

  it('names the failed source when the request fails', async () => {
    vi.mocked(getSecurityScore).mockRejectedValue(new Error('Postgres unavailable'))

    render(<SecurityScoreBreakdown />, { wrapper: createQueryWrapper().wrapper })

    expect(await screen.findByText(/Security score/)).toBeInTheDocument()
  })
})
