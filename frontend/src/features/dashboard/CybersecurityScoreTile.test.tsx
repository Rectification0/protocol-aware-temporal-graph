import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createQueryWrapper } from '@/test/query'
import { securityScoreFixture } from '@/test/securityScore'

vi.mock('@/api/endpoints', () => ({ getSecurityScore: vi.fn() }))

const { getSecurityScore } = await import('@/api/endpoints')
const { CybersecurityScoreTile } = await import('@/features/dashboard/CybersecurityScoreTile')

describe('CybersecurityScoreTile', () => {
  it('renders the backend score, rounded, out of 100', async () => {
    vi.mocked(getSecurityScore).mockResolvedValue(securityScoreFixture({ score: 72.4 }))

    render(<CybersecurityScoreTile />, { wrapper: createQueryWrapper().wrapper })

    expect(await screen.findByText('72')).toBeInTheDocument()
    expect(screen.getByText('/ 100')).toBeInTheDocument()
  })

  it('shows the reason the backend gives when it withholds the score', async () => {
    vi.mocked(getSecurityScore).mockResolvedValue(
      securityScoreFixture({
        score: null,
        band: null,
        pipeline_status: 'inactive',
        unavailable_reason: 'The pipeline last reported 12 min ago',
      }),
    )

    render(<CybersecurityScoreTile />, { wrapper: createQueryWrapper().wrapper })

    expect(await screen.findByText('The pipeline last reported 12 min ago')).toBeInTheDocument()
  })

  it('shows the fetch error when the request fails', async () => {
    vi.mocked(getSecurityScore).mockRejectedValue(new Error('Postgres unavailable'))

    render(<CybersecurityScoreTile />, { wrapper: createQueryWrapper().wrapper })

    expect(await screen.findByText('Postgres unavailable')).toBeInTheDocument()
  })
})
