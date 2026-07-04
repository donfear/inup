import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { PACKAGE_NAME } from './package-meta'

/**
 * Project-level configuration loaded from .inuprc or .inuprc.json
 */
export interface InupProjectConfig {
  /**
   * Packages to ignore during upgrade checks.
   * Supports exact names and glob patterns (e.g., "@babel/*", "eslint-*")
   */
  ignore?: string[]

  /**
   * Exclude directory patterns (regex patterns)
   */
  exclude?: string[]

  /**
   * Directory names to scan even though they are in the default skip list
   * (node_modules, dist, build, coverage, out, lib, es, esm, cjs).
   * Use this when a real package lives under e.g. "lib/".
   */
  scanDirs?: string[]

  /**
   * Show vulnerability badges for peerDependencies in the package list.
   * Defaults to false so peer dependency risk stays hidden unless explicitly enabled.
   */
  showPeerDependencyVulnerabilities?: boolean

  /**
   * Show vulnerability badges for optionalDependencies in the package list.
   * Defaults to false so optional dependency risk stays hidden unless explicitly enabled.
   */
  showOptionalDependencyVulnerabilities?: boolean
}

const CONFIG_FILES = [
  `.${PACKAGE_NAME}rc`,
  `.${PACKAGE_NAME}rc.json`,
  `${PACKAGE_NAME}.config.json`,
]

/**
 * Load project configuration from .inuprc, .inuprc.json, or inup.config.json
 * Searches in the specified directory and parent directories up to root
 */
export function loadProjectConfig(cwd: string): InupProjectConfig {
  let currentDir = cwd

  while (currentDir !== '/') {
    for (const configFile of CONFIG_FILES) {
      const configPath = join(currentDir, configFile)
      if (existsSync(configPath)) {
        try {
          const content = readFileSync(configPath, 'utf-8')
          const config = JSON.parse(content) as InupProjectConfig
          return normalizeConfig(config)
        } catch (error) {
          // Invalid JSON or read error - continue searching
          console.warn(`Warning: Failed to parse ${configPath}: ${error}`)
        }
      }
    }

    // Move to parent directory. The self-parent check only trips on Windows
    // drive roots ('C:\'); on POSIX the loop condition exits at '/' first.
    const parentDir = join(currentDir, '..')
    /* v8 ignore start */
    if (parentDir === currentDir) break
    /* v8 ignore stop */
    currentDir = parentDir
  }

  return {}
}

/**
 * Normalize and validate the config
 */
function normalizeConfig(config: InupProjectConfig): InupProjectConfig {
  const normalized: InupProjectConfig = {}

  if (config.ignore) {
    if (Array.isArray(config.ignore)) {
      normalized.ignore = config.ignore.filter((item) => typeof item === 'string')
    }
  }

  if (config.exclude) {
    if (Array.isArray(config.exclude)) {
      normalized.exclude = config.exclude.filter((item) => typeof item === 'string')
    }
  }

  if (config.scanDirs) {
    if (Array.isArray(config.scanDirs)) {
      normalized.scanDirs = config.scanDirs.filter((item) => typeof item === 'string')
    }
  }

  if (typeof config.showPeerDependencyVulnerabilities === 'boolean') {
    normalized.showPeerDependencyVulnerabilities = config.showPeerDependencyVulnerabilities
  }

  if (typeof config.showOptionalDependencyVulnerabilities === 'boolean') {
    normalized.showOptionalDependencyVulnerabilities = config.showOptionalDependencyVulnerabilities
  }

  return normalized
}

/**
 * Check if a package name matches any of the ignore patterns
 * Supports exact matches and glob patterns (* and ?)
 */
export function isPackageIgnored(packageName: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    if (matchesPattern(packageName, pattern)) {
      return true
    }
  }
  return false
}

/**
 * Match a package name against a pattern
 * Supports:
 * - Exact match: "lodash"
 * - Wildcard: "*" matches any sequence of characters
 * - Single char wildcard: "?" matches single character
 * - Scoped packages: "@babel/*" matches all @babel packages
 */
function matchesPattern(name: string, pattern: string): boolean {
  // Exact match
  if (pattern === name) {
    return true
  }

  // Convert glob pattern to regex
  const regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars except * and ?
    .replace(/\*/g, '.*') // * matches any sequence
    .replace(/\?/g, '.') // ? matches single char

  const regex = new RegExp(`^${regexPattern}$`)
  return regex.test(name)
}
