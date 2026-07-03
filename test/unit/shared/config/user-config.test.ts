import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PersistedFilters } from '../../../../src/shared/types'

// Redirect the env-paths config directory into a per-test temp dir so the
// singleton never touches the user's real ~/.config/inup.
const pathsMock = vi.hoisted(() => ({ configDir: '' }))

vi.mock('env-paths', () => ({
  default: () => ({ config: pathsMock.configDir }),
}))

type UserConfigModule = typeof import('../../../../src/shared/config/user-config')

let tempDir: string
let configManager: UserConfigModule['configManager']

const filters: PersistedFilters = {
  showDependencies: true,
  showDevDependencies: false,
  showPeerDependencies: true,
  showOptionalDependencies: false,
  showOnlyVulnerable: true,
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'inup-config-test-'))
  pathsMock.configDir = join(tempDir, 'config')
  vi.resetModules()
  ;({ configManager } = await import('../../../../src/shared/config/user-config'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('ConfigManager', () => {
  it('returns null theme and filters when no config exists', () => {
    expect(configManager.getTheme()).toBeNull()
    expect(configManager.getFilters()).toBeNull()
  })

  it('round-trips the theme through the config file', () => {
    configManager.setTheme('dracula')

    expect(configManager.getTheme()).toBe('dracula')
    const raw = JSON.parse(readFileSync(join(pathsMock.configDir, 'config.json'), 'utf8'))
    expect(raw).toEqual({ theme: 'dracula' })
  })

  it('round-trips filters through the config file', () => {
    configManager.setFilters(filters)

    expect(configManager.getFilters()).toEqual(filters)
  })

  it('preserves filters when the theme changes and vice versa', () => {
    configManager.setFilters(filters)
    configManager.setTheme('monokai')

    expect(configManager.getFilters()).toEqual(filters)
    expect(configManager.getTheme()).toBe('monokai')

    configManager.setFilters({ ...filters, showOnlyVulnerable: false })
    expect(configManager.getTheme()).toBe('monokai')
  })

  it('treats a corrupt config file as empty and reports the error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mkdirSync(pathsMock.configDir, { recursive: true })
    writeFileSync(join(pathsMock.configDir, 'config.json'), '{not json')

    expect(configManager.getTheme()).toBeNull()
    expect(error).toHaveBeenCalledWith('Error reading config:', expect.anything())
  })

  it('swallows write failures and reports them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Point the config dir through a regular file so mkdir/write must fail.
    // The singleton resolves its directory at import time, so re-import.
    const blocker = join(tempDir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    pathsMock.configDir = join(blocker, 'nested')
    vi.resetModules()
    const { configManager: blockedManager } =
      await import('../../../../src/shared/config/user-config')

    expect(() => blockedManager.setTheme('dracula')).not.toThrow()
    expect(error).toHaveBeenCalledWith('Error writing config:', expect.anything())
  })
})
