import { describe, it, expect, afterEach } from 'vitest'
import chalk from 'chalk'
import { getTerminalBgColorCode, getTerminalResetCode } from '../../../../src/features/interactive/themes-colors'

describe('terminal background escapes respect color level', () => {
  const originalLevel = chalk.level

  afterEach(() => {
    chalk.level = originalLevel
  })

  it('emits no background/reset escapes when color is disabled', () => {
    chalk.level = 0
    expect(getTerminalBgColorCode()).toBe('')
    expect(getTerminalResetCode()).toBe('')
  })

  it('emits background/reset escapes when color is enabled', () => {
    chalk.level = 3
    expect(getTerminalBgColorCode()).toMatch(/^\x1b\[48;2;\d+;\d+;\d+m$/)
    expect(getTerminalResetCode()).toBe('\x1b[0m')
  })
})
