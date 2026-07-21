import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile, PersistedFilters } from '../../../../src/shared/types'

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

  describe('network profile', () => {
    const validProfile = (overrides: Partial<NetworkProfile> = {}): NetworkProfile => ({
      schemaVersion: 1,
      learnedLimit: 6,
      baselineLatencyMs: 350,
      baselineGoodputRps: 8.5,
      sampleCount: 120,
      updatedAt: new Date().toISOString(),
      ...overrides,
    })

    it('returns null when no profile is stored', () => {
      expect(configManager.getNetworkProfile()).toBeNull()
    })

    it('round-trips a profile through the config file', () => {
      const profile = validProfile()
      configManager.setNetworkProfile(profile)
      expect(configManager.getNetworkProfile()).toEqual(profile)
    })

    it('coexists with the theme in the same file', () => {
      configManager.setTheme('dracula')
      configManager.setNetworkProfile(validProfile())
      expect(configManager.getTheme()).toBe('dracula')
      expect(configManager.getNetworkProfile()).not.toBeNull()
    })

    it('expires profiles older than 7 days (networks move; stale hints mislead)', () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString()
      configManager.setNetworkProfile(validProfile({ updatedAt: eightDaysAgo }))
      expect(configManager.getNetworkProfile()).toBeNull()
    })

    it('rejects a profile with an unknown schema version', () => {
      configManager.setNetworkProfile(validProfile({ schemaVersion: 2 as unknown as 1 }))
      expect(configManager.getNetworkProfile()).toBeNull()
    })

    it('rejects out-of-range or non-integer learned limits', () => {
      for (const learnedLimit of [0, -1, 99, 7.5, Number.NaN]) {
        configManager.setNetworkProfile(validProfile({ learnedLimit }))
        expect(configManager.getNetworkProfile()).toBeNull()
      }
    })

    it('rejects a non-finite baseline latency', () => {
      configManager.setNetworkProfile(validProfile({ baselineLatencyMs: Number.POSITIVE_INFINITY }))
      expect(configManager.getNetworkProfile()).toBeNull()
    })

    it('rejects an unparsable timestamp', () => {
      configManager.setNetworkProfile(validProfile({ updatedAt: 'not a date' }))
      expect(configManager.getNetworkProfile()).toBeNull()
    })

    it('clearNetworkProfile removes only the profile', () => {
      configManager.setTheme('monokai')
      configManager.setNetworkProfile(validProfile())
      configManager.clearNetworkProfile()
      expect(configManager.getNetworkProfile()).toBeNull()
      expect(configManager.getTheme()).toBe('monokai')
    })

    it('clearNetworkProfile without a stored profile writes nothing', () => {
      configManager.clearNetworkProfile()
      // No profile to clear → no write → the config file is never created.
      expect(existsSync(join(pathsMock.configDir, 'config.json'))).toBe(false)
    })
  })

  it('swallows write failures and reports them', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    // Point the config dir through a regular file so mkdir/write must fail.
    // The singleton resolves its directory at import time, so re-import.
    const blocker = join(tempDir, 'blocker')
    writeFileSync(blocker, 'not a directory')
    pathsMock.configDir = join(blocker, 'nested')
    vi.resetModules()
    const { configManager: blockedManager } = await import(
      '../../../../src/shared/config/user-config'
    )

    expect(() => blockedManager.setTheme('dracula')).not.toThrow()
    expect(error).toHaveBeenCalledWith('Error writing config:', expect.anything())
  })
})
