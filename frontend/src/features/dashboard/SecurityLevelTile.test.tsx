import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '@/test/query'
import { securityScoreFixture } from '@/test/securityScore'

vi.mock('@/api/endpoints', () => ({ getSecurityScore: vi.fn() }))

const { getSecurityScore } = await import('@/api/endpoints')
const { SecurityLevelTile } = await import('@/features/dashboard/SecurityLevelTile')

describe('SecurityLevelTile', () => {
  it.each([
    ['good', 'Good'],
    ['fair', 'Fair'],
    ['poor', 'Poor'],
    ['critical', 'Critical'],
  ] as const)('renders the %s band as %s', async (band, label) => {
    vi.mocked(getSecurityScore).mockResolvedValue(securityScoreFixture({ band }))

    render(<SecurityLevelTile />, { wrapper: createQueryWrapper().wrapper })

    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('shows the reason the backend gives when the score is withheld', async () => {
    vi.mocked(getSecurityScore).mockResolvedValue(
      securityScoreFixture({
        score: null,
        band: null,
        unavailable_reason: 'No metrics snapshot recorded yet: the pipeline has not reported.',
      }),
    )

    render(<SecurityLevelTile />, { wrapper: createQueryWrapper().wrapper })

    expect(await screen.findByText(/the pipeline has not reported/)).toBeInTheDocument()
  })
})
