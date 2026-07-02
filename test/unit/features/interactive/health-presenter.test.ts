import { describe, it, expect } from 'vitest'
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
})
