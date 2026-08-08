import { describe, expect, it } from 'vitest'
import { entityType, FULL_HISTORY_WINDOW } from '@/features/investigation/logic'

describe('entityType', () => {
  it('extracts the type prefix from a node id', () => {
    expect(entityType('User:alice')).toBe('User')
    expect(entityType('Machine:C1042')).toBe('Machine')
  })

  it('returns null for an id with no type prefix', () => {
    expect(entityType('alice')).toBeNull()
  })
})

describe('FULL_HISTORY_WINDOW', () => {
  it('spans from the epoch to a far-future constant', () => {
    expect(FULL_HISTORY_WINDOW.start).toBe(0)
    expect(FULL_HISTORY_WINDOW.end).toBeGreaterThan(Date.now() / 1000)
  })
})
