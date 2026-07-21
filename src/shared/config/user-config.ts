import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import envPaths from 'env-paths'
import type { NetworkProfile, PersistedFilters } from '../types'
import { POOL_CONNECTIONS } from './constants'
import { PACKAGE_NAME } from './package-meta'

interface ConfigFile {
  theme?: string
  filters?: PersistedFilters
  networkProfile?: NetworkProfile
}

// Networks move (travel, VPN, tethering): an old profile is a misleading hint,
// and re-learning costs one run's ramp-up — expiry is the cheap, safe choice.
const NETWORK_PROFILE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

class ConfigManager {
  private configDir: string
  private configPath: string

  constructor() {
    // Use env-paths for cross-platform config directory support
    // Mac/Linux: ~/.config/inup, Windows: %APPDATA%/inup
    const paths = envPaths(PACKAGE_NAME)
    this.configDir = paths.config
    this.configPath = join(this.configDir, 'config.json')
  }

  private ensureConfigDir(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
    }
  }

  private readConfig(): ConfigFile {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8')
        return JSON.parse(content)
      }
    } catch (error) {
      // If there's an error reading the config, return empty object
      console.error('Error reading config:', error)
    }
    return {}
  }

  private writeConfig(config: ConfigFile): void {
    try {
      this.ensureConfigDir()
      writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8')
    } catch (error) {
      console.error('Error writing config:', error)
    }
  }

  getTheme(): string | null {
    const config = this.readConfig()
    return config.theme || null
  }

  setTheme(theme: string): void {
    const config = this.readConfig()
    config.theme = theme
    this.writeConfig(config)
  }

  getFilters(): PersistedFilters | null {
    const config = this.readConfig()
    return config.filters ?? null
  }

  setFilters(filters: PersistedFilters): void {
    const config = this.readConfig()
    config.filters = filters
    this.writeConfig(config)
  }

  /**
   * The learned network profile, or null when absent, malformed (the file is
   * user-editable), from an unknown schema, or older than 7 days.
   */
  getNetworkProfile(): NetworkProfile | null {
    const profile = this.readConfig().networkProfile
    if (profile?.schemaVersion !== 1) return null
    if (
      !Number.isInteger(profile.learnedLimit) ||
      profile.learnedLimit < 1 ||
      profile.learnedLimit > POOL_CONNECTIONS
    ) {
      return null
    }
    if (!Number.isFinite(profile.baselineLatencyMs) || profile.baselineLatencyMs < 0) return null
    const updatedAt = Date.parse(profile.updatedAt)
    if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > NETWORK_PROFILE_MAX_AGE_MS) {
      return null
    }
    return profile
  }

  setNetworkProfile(profile: NetworkProfile): void {
    const config = this.readConfig()
    config.networkProfile = profile
    this.writeConfig(config)
  }

  clearNetworkProfile(): void {
    const config = this.readConfig()
    if (config.networkProfile === undefined) return
    config.networkProfile = undefined
    this.writeConfig(config)
  }
}

// Export singleton instance
export const configManager = new ConfigManager()
