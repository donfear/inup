import { describe, it, expect, afterEach, vi } from 'vitest'
import chalk from 'chalk'
import {
  coloredInupLogo,
  getTerminalBgColorCode,
  getTerminalResetCode,
  getThemeBgColor,
  getThemeColor,
  themeColors,
  type ThemeColorKey,
} from '../../../../src/features/interactive/themes-colors'
import { ThemeManager } from '../../../../src/features/interactive/state/theme-manager'
import { themeNames } from '../../../../src/features/interactive/themes'
import { stripAnsi } from '../../../../src/shared/terminal/text'

// Switching themes goes through ThemeManager, which persists via the
// configManager singleton — mock it so tests never write the user's config.
vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: {
    getTheme: vi.fn(() => null),
    setTheme: vi.fn(),
    getFilters: vi.fn(() => null),
    setFilters: vi.fn(),
  },
}))

const COLOR_KEYS: ThemeColorKey[] = [
  'primary',
  'secondary',
  'success',
  'warning',
  'error',
  'border',
  'text',
  'textSecondary',
  'packageName',
  'packageAuthor',
  'versionRange',
  'versionLatest',
  'dot',
  'dotEmpty',
  'bg',
]

// Restore the module-global theme after each test.
afterEach(() => {
  new ThemeManager()
})

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

  it('translates the theme background hex into the RGB escape', () => {
    chalk.level = 3
    const manager = new ThemeManager()
    manager.setTheme('dracula') // bg #1e1f26 → 30;31;38

    expect(getThemeBgColor()).toBe('#1e1f26')
    expect(getTerminalBgColorCode()).toBe('\x1b[48;2;30;31;38m')
  })
})

describe('getThemeColor', () => {
  it('provides every color key for every registered theme', () => {
    const manager = new ThemeManager()

    for (const themeName of themeNames) {
      manager.setTheme(themeName)
      for (const key of COLOR_KEYS) {
        const colorFn = getThemeColor(key)
        expect(colorFn, `${themeName}.${key}`).toBeTypeOf('function')
        expect(stripAnsi(colorFn('sample'))).toBe('sample')
      }
    }
  })

  it('exposes lazy accessors that follow the active theme', () => {
    for (const accessor of Object.values(themeColors)) {
      expect(stripAnsi(accessor()('text'))).toBe('text')
    }
  })
})

describe('getThemeBgColor', () => {
  it('returns the background of each registered theme', () => {
    const manager = new ThemeManager()

    for (const themeName of themeNames) {
      manager.setTheme(themeName)
      expect(getThemeBgColor()).toMatch(/^#[0-9a-fA-F]{6}$/)
    }
  })
})

describe('coloredInupLogo', () => {
  it('spells the package name', () => {
    expect(stripAnsi(coloredInupLogo())).toBe('inup')
  })

  it('cycles the four brand colors when color is enabled', () => {
    const originalLevel = chalk.level
    chalk.level = 3
    try {
      const logo = coloredInupLogo()
      // red, yellow, blue, magenta bold — one per letter of "inup"
      expect(logo).toContain('\x1b[31m')
      expect(logo).toContain('\x1b[33m')
      expect(logo).toContain('\x1b[34m')
      expect(logo).toContain('\x1b[35m')
    } finally {
      chalk.level = originalLevel
    }
  })
})
