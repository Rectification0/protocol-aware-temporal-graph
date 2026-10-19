import { render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DependencyDot, StatusPill } from '@/features/dashboard/status-pill'
import { createQueryWrapper } from '@/test/query'
import type { HealthOut, MotifCompletionOut } from '@/types/api'

// F16.4: the three F6 tiles (and the pill they share) that only had
// indirect coverage through HomePage.test.tsx's happy path -- this pins
// each tile's other states.

vi.mock('@/api/endpoints', () => ({
  getHealth: vi.fn(),
  listMotifCompletions: vi.fn(),
}))

const { getHealth, listMotifCompletions } = await import('@/api/endpoints')
const { LastAnalysisTile } = await import('@/features/dashboard/LastAnalysisTile')
const { MonitoringStatusTile } = await import('@/features/dashboard/MonitoringStatusTile')
const { ThreatStatusTile } = await import('@/features/dashboard/ThreatStatusTile')

function health(ageSeconds: number | null): HealthOut {
  return {
    status: 'ok',
    postgres: true,
    neo4j: true,
    redis: true,
    last_metrics_snapshot_age_seconds: ageSeconds,
  }
}

function completion(id: number, completedAt: number): MotifCompletionOut {
  return {
    id,
    motif_name: 'lateral_pivot',
    chain_key: 'User:alice',
    matched_edges: [],
    completed_at: completedAt,
    confidence: 1,
  }
}

function renderTile(ui: ReactElement) {
  const { wrapper } = createQueryWrapper()
  return render(ui, { wrapper })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MonitoringStatusTile (F6.5)', () => {
  it.each([
    [5, 'Active'],
    [120, 'Stale'],
    [600, 'Inactive'],
  ])('a %ss-old snapshot reads as %s', async (age, label) => {
    vi.mocked(getHealth).mockResolvedValue(health(age))
    renderTile(<MonitoringStatusTile />)

    expect(await screen.findByText(label)).toBeInTheDocument()
  })

  it('shows the fetch error instead of a status when health fails', async () => {
    vi.mocked(getHealth).mockRejectedValue(new Error('API unreachable'))
    renderTile(<MonitoringStatusTile />)

    expect(await screen.findByText('API unreachable')).toBeInTheDocument()
  })
})

describe('LastAnalysisTile (F6.6)', () => {
  it('shows how long ago the last metrics snapshot was written', async () => {
    vi.mocked(getHealth).mockResolvedValue(health(120))
    renderTile(<LastAnalysisTile />)

    expect(await screen.findByText('2 minutes ago')).toBeInTheDocument()
  })

  it('says so when the pipeline has never written a snapshot', async () => {
    vi.mocked(getHealth).mockResolvedValue(health(null))
    renderTile(<LastAnalysisTile />)

    expect(await screen.findByText('No pipeline activity recorded yet')).toBeInTheDocument()
  })
})

describe('ThreatStatusTile (F6.3)', () => {
  it('escalates to "Under active attack" past two recent completions, ignoring old ones', async () => {
    const now = Date.now() / 1000
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [
        completion(1, now),
        completion(2, now - 60),
        completion(3, now - 120),
        completion(4, now - 3600),
      ],
      limit: 20,
      offset: 0,
      total: null,
    })
    renderTile(<ThreatStatusTile />)

    expect(await screen.findByText('Under active attack')).toBeInTheDocument()
    expect(screen.getByText('3 in last 15m')).toBeInTheDocument()
  })

  it('reads Quiet with no recent completions', async () => {
    vi.mocked(listMotifCompletions).mockResolvedValue({
      items: [],
      limit: 20,
      offset: 0,
      total: null,
    })
    renderTile(<ThreatStatusTile />)

    expect(await screen.findByText('Quiet')).toBeInTheDocument()
    expect(screen.getByText('0 in last 15m')).toBeInTheDocument()
  })
})

describe('StatusPill / DependencyDot', () => {
  it('colors the pill by tone', () => {
    render(<StatusPill tone="error" label="Down" />)
    expect(screen.getByText('Down')).toHaveClass('text-status-error')
  })

  it('colors the dependency dot by health', () => {
    const { container } = render(
      <>
        <DependencyDot label="Postgres" ok />
        <DependencyDot label="Neo4j" ok={false} />
      </>,
    )
    const dots = container.querySelectorAll('[aria-hidden="true"]')
    expect(dots[0]).toHaveClass('bg-status-success')
    expect(dots[1]).toHaveClass('bg-status-error')
  })
})
