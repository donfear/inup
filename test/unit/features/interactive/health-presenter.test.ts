import { describe, expect, it } from 'vitest'
import { getHealthBadge } from '../../../../src/features/interactive/presenters/health'

describe('getHealthBadge', () => {
  it('flags a deprecated package with [DEPR] (highest priority)', () => {
    const badge = getHealthBadge({ deprecated: 'no longer maintained', enginesNode: '>=999' })
    expect(badge).toContain('[DEPR]')
    expect(badge).not.toContain('[ENG]')
  })

  it('flags an engines-incompatible package with [ENG]', () => {
    // >=999 can never be satisfied by the running Node.
    const badge = getHealthBadge({ enginesNode: '>=999' })
    expect(badge).toContain('[ENG]')
  })

  it('returns empty for a healthy package', () => {
    expect(getHealthBadge({ enginesNode: '>=10' })).toBe('')
    expect(getHealthBadge({})).toBe('')
  })

  const hold = {
    version: '2.1.0',
    publishedAt: '2024-06-01T00:00:00.000Z',
    ageMinutes: 30,
    count: 1,
  }

  it('flags a cooldown-withheld version with [HELD]', () => {
    expect(getHealthBadge({ heldByCooldown: hold })).toContain('[HELD]')
  })

  it('ranks [HELD] below the problem signals', () => {
    // A deliberate, benign hold must not mask a deprecation or engines mismatch.
    expect(getHealthBadge({ deprecated: 'gone', heldByCooldown: hold })).toContain('[DEPR]')
    expect(getHealthBadge({ enginesNode: '>=999', heldByCooldown: hold })).toContain('[ENG]')
  })
})
