import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DispositionBadge,
  InvestigationStatusBadge,
  SeverityBadge,
  type FeedbackDisposition,
  type InvestigationStatus,
  type ThreatSeverity,
} from './severity-badge'

describe('SeverityBadge', () => {
  const cases: Array<[ThreatSeverity, string]> = [
    ['critical', 'Critical'],
    ['high', 'High'],
    ['medium', 'Medium'],
    ['low', 'Low'],
    ['info', 'Info'],
  ]

  it.each(cases)('renders the %s severity label', (severity, label) => {
    render(<SeverityBadge severity={severity} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('DispositionBadge', () => {
  const cases: Array<[FeedbackDisposition, string]> = [
    ['true_positive', 'True positive'],
    ['false_positive', 'False positive'],
    ['unconfirmed', 'Unconfirmed'],
  ]

  it.each(cases)('renders the %s disposition label', (disposition, label) => {
    render(<DispositionBadge disposition={disposition} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})

describe('InvestigationStatusBadge', () => {
  const cases: Array<[InvestigationStatus, string]> = [
    ['new', 'New'],
    ['investigating', 'Investigating'],
    ['resolved', 'Resolved'],
    ['closed', 'Closed'],
  ]

  it.each(cases)('renders the %s status label', (status, label) => {
    render(<InvestigationStatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })
})
