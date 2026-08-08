import { describe, expect, it } from 'vitest'
import {
  classifyLogSeverity,
  classifyPruneSeverity,
  logRecordEntity,
  logRowKey,
  logsToCsv,
  logsToJson,
  matchesEntity,
  matchesLogFilters,
  matchesQuery,
  motifResetEventToAuditRecord,
  summarizeLogRecord,
  toLogRow,
} from '@/features/logs/logic'
import type { AuditRecordOut, MotifResetOut } from '@/types/api'

function pruneRecord(overrides: Partial<AuditRecordOut> = {}): AuditRecordOut {
  return {
    type: 'prune',
    logged_at: 100,
    edge_id: 'e1',
    src: 'User:alice',
    dst: 'Machine:C1',
    edge_type: 'Authentication',
    protocol: 'RDP',
    w_at_prune: 0.1,
    pruned_at: 100,
    ...overrides,
  }
}

function motifResetRecord(overrides: Partial<AuditRecordOut> = {}): AuditRecordOut {
  return {
    type: 'motif_reset',
    logged_at: 100,
    motif_name: 'lateral_pivot',
    chain_key: 'Machine:C1',
    triggering_edge_id: 'e1',
    matched_edges: ['e1', 'e2'],
    reset_at: 100,
    ...overrides,
  }
}

describe('classifyPruneSeverity', () => {
  it('is medium at or above the medium threshold', () => {
    expect(classifyPruneSeverity(0.5)).toBe('medium')
    expect(classifyPruneSeverity(0.9)).toBe('medium')
  })

  it('is low between the low and medium thresholds', () => {
    expect(classifyPruneSeverity(0.2)).toBe('low')
    expect(classifyPruneSeverity(0.49)).toBe('low')
  })

  it('is info below the low threshold, including null/undefined', () => {
    expect(classifyPruneSeverity(0.1)).toBe('info')
    expect(classifyPruneSeverity(null)).toBe('info')
    expect(classifyPruneSeverity(undefined)).toBe('info')
  })
})

describe('classifyLogSeverity', () => {
  it('floors motif_reset records at medium regardless of any field value', () => {
    expect(classifyLogSeverity(motifResetRecord())).toBe('medium')
  })

  it('delegates prune records to classifyPruneSeverity', () => {
    expect(classifyLogSeverity(pruneRecord({ w_at_prune: 0.6 }))).toBe('medium')
    expect(classifyLogSeverity(pruneRecord({ w_at_prune: 0.01 }))).toBe('info')
  })
})

describe('summarizeLogRecord', () => {
  it('summarizes a prune record with edge type/protocol/endpoints', () => {
    expect(summarizeLogRecord(pruneRecord())).toBe(
      'Pruned Authentication (RDP): User:alice -> Machine:C1',
    )
  })

  it('summarizes a motif_reset record with motif name and chain key', () => {
    expect(summarizeLogRecord(motifResetRecord())).toBe(
      'Motif reset: lateral_pivot (chain Machine:C1)',
    )
  })
})

describe('logRecordEntity', () => {
  it('prefers src for a prune record, falling back to dst', () => {
    expect(logRecordEntity(pruneRecord())).toBe('User:alice')
    expect(logRecordEntity(pruneRecord({ src: null }))).toBe('Machine:C1')
  })

  it('uses chain_key for a motif_reset record', () => {
    expect(logRecordEntity(motifResetRecord())).toBe('Machine:C1')
  })
})

describe('logRowKey', () => {
  it('is stable and distinct per record type/identity', () => {
    expect(logRowKey(pruneRecord())).toBe('prune:e1:100')
    expect(logRowKey(motifResetRecord())).toBe('motif_reset:Machine:C1:100')
    expect(logRowKey(pruneRecord({ edge_id: 'e2' }))).not.toBe(logRowKey(pruneRecord()))
  })
})

describe('toLogRow', () => {
  it('defaults isNew to false', () => {
    expect(toLogRow(pruneRecord()).isNew).toBe(false)
  })

  it('marks a row new when requested', () => {
    expect(toLogRow(pruneRecord(), true).isNew).toBe(true)
  })
})

describe('motifResetEventToAuditRecord', () => {
  it('adapts a stream MotifResetOut into the audit-log AuditRecordOut shape', () => {
    const reset: MotifResetOut = {
      id: 1,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      triggering_edge_id: 'e1',
      matched_edges: ['e1'],
      reset_at: 200,
    }

    const record = motifResetEventToAuditRecord(reset)

    expect(record).toEqual({
      type: 'motif_reset',
      logged_at: 200,
      motif_name: 'lateral_pivot',
      chain_key: 'Machine:C1',
      triggering_edge_id: 'e1',
      matched_edges: ['e1'],
      reset_at: 200,
    })
  })
})

describe('matchesQuery', () => {
  it('matches case-insensitively across every relevant field', () => {
    expect(matchesQuery(pruneRecord(), 'rdp')).toBe(true)
    expect(matchesQuery(pruneRecord(), 'SMB')).toBe(false)
  })

  it('matches inside matched_edges list entries', () => {
    expect(matchesQuery(motifResetRecord(), 'e2')).toBe(true)
  })

  it('treats an empty/whitespace query as matching everything', () => {
    expect(matchesQuery(pruneRecord(), '')).toBe(true)
    expect(matchesQuery(pruneRecord(), '   ')).toBe(true)
  })
})

describe('matchesEntity', () => {
  it('matches a prune record by src or dst', () => {
    expect(matchesEntity(pruneRecord(), 'User:alice')).toBe(true)
    expect(matchesEntity(pruneRecord(), 'Machine:C1')).toBe(true)
    expect(matchesEntity(pruneRecord(), 'User:bob')).toBe(false)
  })

  it('matches a motif_reset record by chain_key', () => {
    expect(matchesEntity(motifResetRecord(), 'Machine:C1')).toBe(true)
  })
})

describe('matchesLogFilters', () => {
  const baseCriteria = { type: null, entity: null, query: '', start: 0, end: 1000 }

  it('rejects a record outside the time range', () => {
    expect(matchesLogFilters(pruneRecord({ logged_at: 2000 }), baseCriteria)).toBe(false)
  })

  it('rejects a record of the wrong type', () => {
    expect(matchesLogFilters(pruneRecord(), { ...baseCriteria, type: 'motif_reset' })).toBe(false)
  })

  it('rejects a record that fails the entity filter', () => {
    expect(matchesLogFilters(pruneRecord(), { ...baseCriteria, entity: 'User:bob' })).toBe(false)
  })

  it('rejects a record that fails the freetext query', () => {
    expect(matchesLogFilters(pruneRecord(), { ...baseCriteria, query: 'smb' })).toBe(false)
  })

  it('accepts a record that clears every criterion', () => {
    expect(matchesLogFilters(pruneRecord(), baseCriteria)).toBe(true)
  })
})

describe('logsToCsv / logsToJson', () => {
  it('produces a header row plus one row per record', () => {
    const csv = logsToCsv([toLogRow(pruneRecord()), toLogRow(motifResetRecord())])
    const lines = csv.split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe(
      'type,logged_at,edge_id,src,dst,edge_type,protocol,w_at_prune,pruned_at,motif_name,chain_key,triggering_edge_id,matched_edges,reset_at',
    )
  })

  it('joins list fields with semicolons in a single CSV cell', () => {
    const csv = logsToCsv([toLogRow(motifResetRecord({ matched_edges: ['e1', 'e2'] }))])
    expect(csv).toContain('e1;e2')
  })

  it('quotes a field value containing a comma', () => {
    const csv = logsToCsv([toLogRow(pruneRecord({ dst: 'Machine:C1,C2' }))])
    expect(csv).toContain('"Machine:C1,C2"')
  })

  it('produces a JSON array of the underlying records', () => {
    const json = logsToJson([toLogRow(pruneRecord())])
    expect(JSON.parse(json)).toEqual([pruneRecord()])
  })
})
