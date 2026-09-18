import { describe, expect, it } from 'vitest'
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

  it('ignores an empty NO_COLOR, per the no-color.org spec (non-empty values only)', () => {
    expect(shouldDisableColor(undefined, { NO_COLOR: '' })).toBe(false)
  })

  it('treats any non-empty NO_COLOR value as disable, including "0"', () => {
    // The spec is presence-of-a-non-empty-value, not truthiness of the content.
    expect(shouldDisableColor(undefined, { NO_COLOR: '0' })).toBe(true)
    expect(shouldDisableColor(undefined, { NO_COLOR: 'false' })).toBe(true)
  })
})

describe('applyColorSetting', () => {
  it('sets chalk level to 0 when color should be disabled', async () => {
    const chalk = (await import('chalk')).default
    const { applyColorSetting } = await import('../../../../src/shared/terminal/color')
    const originalLevel = chalk.level
    try {
      chalk.level = 3
      applyColorSetting(false, {})
      expect(chalk.level).toBe(0)
    } finally {
      chalk.level = originalLevel
    }
  })

  it('leaves chalk alone when color stays enabled', async () => {
    const chalk = (await import('chalk')).default
    const { applyColorSetting } = await import('../../../../src/shared/terminal/color')
    const originalLevel = chalk.level
    try {
      chalk.level = 3
      applyColorSetting(undefined, { FORCE_COLOR: '1' })
      expect(chalk.level).toBe(3)
    } finally {
      chalk.level = originalLevel
    }
  })
})
