import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getCurrentThemeName,
  getThemeColors,
  ThemeManager,
} from '../../../../src/features/interactive/state/theme-manager'
import { defaultTheme, themeNames, themes } from '../../../../src/features/interactive/themes'
import { configManager } from '../../../../src/shared/config/user-config'

// ThemeManager persists through the configManager singleton, which writes the
// user's real config file — it must always be mocked in TUI tests.
vi.mock('../../../../src/shared/config/user-config', () => ({
  configManager: {
    getTheme: vi.fn(() => null),
    setTheme: vi.fn(),
    getFilters: vi.fn(() => null),
    setFilters: vi.fn(),
  },
}))

const getTheme = vi.mocked(configManager.getTheme)
const setTheme = vi.mocked(configManager.setTheme)

beforeEach(() => {
  getTheme.mockReturnValue(null)
  setTheme.mockClear()
  // Reset module-global theme state leaked by previous tests.
  new ThemeManager()
})

describe('ThemeManager initialization', () => {
  it('starts with the default theme when nothing is saved', () => {
    const manager = new ThemeManager()

    expect(manager.getCurrentTheme()).toBe(defaultTheme)
    expect(getCurrentThemeName()).toBe(defaultTheme)
  })

  it('restores a valid saved theme', () => {
    getTheme.mockReturnValue('monokai')

    const manager = new ThemeManager()

    expect(manager.getCurrentTheme()).toBe('monokai')
    expect(getCurrentThemeName()).toBe('monokai')
  })

  it('falls back to the default theme for unknown saved values', () => {
    getTheme.mockReturnValue('sepia-dreams')

    const manager = new ThemeManager()

    expect(manager.getCurrentTheme()).toBe(defaultTheme)
  })
})

describe('ThemeManager preview flow', () => {
  it('opens the modal with the preview set to the current theme', () => {
    const manager = new ThemeManager()

    manager.openThemeModal()

    expect(manager.isThemeModalOpen()).toBe(true)
    expect(manager.getPreviewTheme()).toBe(manager.getCurrentTheme())
  })

  it('applies previews globally without changing the confirmed theme', () => {
    const manager = new ThemeManager()
    manager.openThemeModal()

    manager.previewTheme('gruvbox')

    expect(manager.getPreviewTheme()).toBe('gruvbox')
    expect(getCurrentThemeName()).toBe('gruvbox')
    expect(manager.getCurrentTheme()).toBe(defaultTheme)
  })

  it('ignores previews of unknown themes', () => {
    const manager = new ThemeManager()
    manager.openThemeModal()

    manager.previewTheme('does-not-exist')

    expect(manager.getPreviewTheme()).toBe(defaultTheme)
    expect(getCurrentThemeName()).toBe(defaultTheme)
  })

  it('restores the confirmed theme when closing without confirmation', () => {
    const manager = new ThemeManager()
    manager.openThemeModal()
    manager.previewTheme('gruvbox')

    manager.closeThemeModal()

    expect(manager.isThemeModalOpen()).toBe(false)
    expect(manager.getPreviewTheme()).toBe(defaultTheme)
    expect(getCurrentThemeName()).toBe(defaultTheme)
    expect(setTheme).not.toHaveBeenCalled()
  })

  it('persists the previewed theme on confirmation and closes the modal', () => {
    const manager = new ThemeManager()
    manager.openThemeModal()
    manager.previewTheme('github')

    manager.confirmTheme()

    expect(manager.getCurrentTheme()).toBe('github')
    expect(getCurrentThemeName()).toBe('github')
    expect(manager.isThemeModalOpen()).toBe(false)
    expect(setTheme).toHaveBeenCalledWith('github')
  })

  it('toggles the modal open and closed', () => {
    const manager = new ThemeManager()

    manager.toggleThemeModal()
    expect(manager.isThemeModalOpen()).toBe(true)

    manager.toggleThemeModal()
    expect(manager.isThemeModalOpen()).toBe(false)
  })

  it('returns a defensive copy of its state', () => {
    const manager = new ThemeManager()

    const state = manager.getState()
    state.showThemeModal = true

    expect(manager.isThemeModalOpen()).toBe(false)
  })
})

describe('ThemeManager.setTheme', () => {
  it('sets and persists a known theme directly', () => {
    const manager = new ThemeManager()

    manager.setTheme('solarized')

    expect(manager.getCurrentTheme()).toBe('solarized')
    expect(manager.getPreviewTheme()).toBe('solarized')
    expect(getCurrentThemeName()).toBe('solarized')
    expect(setTheme).toHaveBeenCalledWith('solarized')
  })

  it('rejects unknown theme names without persisting', () => {
    const manager = new ThemeManager()

    manager.setTheme('does-not-exist')

    expect(manager.getCurrentTheme()).toBe(defaultTheme)
    expect(setTheme).not.toHaveBeenCalled()
  })
})

describe('theme global accessors', () => {
  it('exposes the colors of the active theme', () => {
    const manager = new ThemeManager()
    manager.setTheme('dracula')

    expect(getThemeColors()).toBe(themes.dracula.colors)
  })

  it('knows every registered theme name', () => {
    for (const name of themeNames) {
      expect(themes[name]).toBeDefined()
    }
  })
})
