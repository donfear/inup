import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import envPaths from 'env-paths'

interface ConfigFile {
  theme?: string
}

class ConfigManager {
  private configDir: string
  private configPath: string

  constructor() {
    // Use env-paths for cross-platform config directory support
    // Mac/Linux: ~/.config/inup, Windows: %APPDATA%/inup
    const paths = envPaths('inup')
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
}

// Export singleton instance
export const configManager = new ConfigManager()
