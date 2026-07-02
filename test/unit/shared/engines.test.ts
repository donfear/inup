import { describe, it, expect } from 'vitest'
import { checkNodeEngineCompatibility } from '../../../src/shared/engines'

describe('checkNodeEngineCompatibility', () => {
  it('returns null when the current Node satisfies the range', () => {
    expect(checkNodeEngineCompatibility('>=18', '20.11.0')).toBeNull()
    expect(checkNodeEngineCompatibility('>=20 <23', '22.0.0')).toBeNull()
  })

  it('warns when the current Node is below the required range', () => {
    const msg = checkNodeEngineCompatibility('>=22', '20.11.0')
    expect(msg).toContain('requires Node >=22')
    expect(msg).toContain("you're on 20.11.0")
  })

  it('returns null for missing or unparseable ranges (no false warnings)', () => {
    expect(checkNodeEngineCompatibility(undefined, '20.0.0')).toBeNull()
    expect(checkNodeEngineCompatibility('', '20.0.0')).toBeNull()
    expect(checkNodeEngineCompatibility('garbage', '20.0.0')).toBeNull()
  })
})
