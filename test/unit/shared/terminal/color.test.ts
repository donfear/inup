import { describe, it, expect } from 'vitest'
import { shouldDisableColor } from '../../../../src/shared/terminal/color'

describe('shouldDisableColor', () => {
  it('disables color when the --no-color flag is set, regardless of env', () => {
    expect(shouldDisableColor(false, {})).toBe(true)
    expect(shouldDisableColor(false, { FORCE_COLOR: '1' })).toBe(true)
  })

  it('keeps color when FORCE_COLOR is set', () => {
    expect(shouldDisableColor(undefined, { FORCE_COLOR: '1' })).toBe(false)
    // FORCE_COLOR wins over NO_COLOR.
    expect(shouldDisableColor(undefined, { FORCE_COLOR: '1', NO_COLOR: '1' })).toBe(false)
  })

  it('disables color when NO_COLOR is set', () => {
    expect(shouldDisableColor(undefined, { NO_COLOR: '1' })).toBe(true)
  })

  it('keeps color by default', () => {
    expect(shouldDisableColor(undefined, {})).toBe(false)
    expect(shouldDisableColor(true, {})).toBe(false)
  })
})
